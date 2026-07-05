import assert from "node:assert/strict";
import test from "node:test";
import { PET_MOTION_PRESET_IDS } from "../src/shared/pet-motion-presets.ts";
import { auditWitchMotionAssets, validateMotionPresetPath } from "./live2d-motion-asset-audit.mts";

test("motion asset audit reports the current model has only idle motion", () => {
  const audit = auditWitchMotionAssets();

  assert.equal(audit.auditVersion, 1);
  assert.deepEqual(audit.model3DeclaredMotionGroups, []);
  assert.deepEqual(audit.physicalMotionFiles, ["model/Scene1.motion3.json"]);
  assert.equal(audit.idleMotion.path, "model/Scene1.motion3.json");
  assert.equal(audit.idleMotion.loop, true);
  assert.equal(audit.idleMotion.semanticAllowed, false);
  assert.equal(audit.semanticMotionPresetCount, 0);
  assert.deepEqual(audit.semanticMotionPresets, []);
  assert.deepEqual(audit.safeSkip, {
    status: "expected-safe-skip",
    reason: "no-semantic-motion-presets"
  });
});

test("motion preset whitelist is empty until model-specific semantic motions are added", () => {
  assert.deepEqual(PET_MOTION_PRESET_IDS, []);
});

test("motion preset paths reject raw paths and non motion files", () => {
  assert.equal(validateMotionPresetPath("motions/wave.motion3.json"), "motions/wave.motion3.json");
  assert.throws(() => validateMotionPresetPath("C:/private/wave.motion3.json"), /POSIX 相对路径/);
  assert.throws(() => validateMotionPresetPath("..\/wave.motion3.json"), /安全的 \.motion3\.json/);
  assert.throws(() => validateMotionPresetPath("motions\\wave.motion3.json"), /POSIX 相对路径/);
  assert.throws(() => validateMotionPresetPath("motions/wave.exp3.json"), /安全的 \.motion3\.json/);
});

test("motion audit safe output does not expose absolute local paths or raw motion json", () => {
  const auditText = JSON.stringify(auditWitchMotionAssets());

  assert.equal(auditText.includes("E:\\\\"), false);
  assert.equal(auditText.includes("Curves"), false);
  assert.equal(auditText.includes("Segments"), false);
});
