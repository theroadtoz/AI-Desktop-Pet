import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PET_MOTION_PRESET_IDS, PET_MOTION_PRESETS } from "../src/shared/pet-motion-presets.ts";
import {
  auditWitchMotionAssets,
  isProductionReadyMotionAssetLicenseStatus,
  validateMotionPresetPath
} from "./live2d-motion-asset-audit.mts";

const YAWN_LOCAL_ONLY_INTAKE = {
  intakeVersion: 1,
  preset: {
    id: "yawn",
    path: "yawn.motion3.json",
    assetLicenseStatus: "blocked-missing-license"
  }
} as const;

const ISOLATED_YAWN_CANDIDATE_PATH = "model/yawn-once.motion3.json";

test("motion asset audit reports idle plus a blocked local-only yawn candidate", () => {
  const audit = auditWitchMotionAssets();

  assert.equal(audit.auditVersion, 1);
  assert.deepEqual(audit.model3DeclaredMotionGroups, []);
  assert.deepEqual(audit.physicalMotionFiles.filter((path) => path !== ISOLATED_YAWN_CANDIDATE_PATH), [
    "model/Scene1.motion3.json",
    "model/yawn.motion3.json"
  ]);
  assert.equal(
    audit.physicalMotionFiles.filter((path) => path === ISOLATED_YAWN_CANDIDATE_PATH).length <= 1,
    true
  );
  assert.equal(audit.idleMotion.path, "model/Scene1.motion3.json");
  assert.equal(audit.idleMotion.loop, true);
  assert.equal(audit.idleMotion.semanticAllowed, false);
  assert.equal(YAWN_LOCAL_ONLY_INTAKE.intakeVersion, 1);
  assert.equal(YAWN_LOCAL_ONLY_INTAKE.preset.path, "yawn.motion3.json");
  assert.equal(YAWN_LOCAL_ONLY_INTAKE.preset.assetLicenseStatus, "blocked-missing-license");
  assert.equal(isProductionReadyMotionAssetLicenseStatus(YAWN_LOCAL_ONLY_INTAKE.preset.assetLicenseStatus), false);
  assert.equal(audit.semanticMotionPresetCount, 0);
  assert.deepEqual(audit.semanticMotionPresets, []);
  assert.equal(
    audit.semanticMotionPresets.some((preset) => preset.id === YAWN_LOCAL_ONLY_INTAKE.preset.id),
    false
  );
  assert.equal(
    (PET_MOTION_PRESET_IDS as readonly string[]).includes(YAWN_LOCAL_ONLY_INTAKE.preset.id),
    false
  );
  assert.equal(readFileSync(audit.model3Path, "utf8").includes("yawn-once.motion3.json"), false);
  const productionManifest = JSON.parse(readFileSync(audit.manifestPath, "utf8"));
  assert.equal(
    productionManifest.motionPresets.some((preset: { id?: string; path?: string }) =>
      preset.id === "yawn-once" || preset.path === "yawn-once.motion3.json"
    ),
    false
  );
  assert.equal(
    PET_MOTION_PRESETS.some((preset) => preset.id === "yawn-once" || preset.path === "yawn-once.motion3.json"),
    false
  );
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

test("motion intake boundary rejects reference-only or missing-license assets as production-ready", () => {
  assert.equal(isProductionReadyMotionAssetLicenseStatus("project-owned"), true);
  assert.equal(isProductionReadyMotionAssetLicenseStatus("user-provided"), true);
  assert.equal(isProductionReadyMotionAssetLicenseStatus("official-sample-reference-only"), false);
  assert.equal(isProductionReadyMotionAssetLicenseStatus("blocked-missing-license"), false);
});

test("motion audit safe output does not expose absolute local paths or raw motion json", () => {
  const auditText = JSON.stringify(auditWitchMotionAssets());

  assert.equal(auditText.includes("E:\\\\"), false);
  assert.equal(auditText.includes("Curves"), false);
  assert.equal(auditText.includes("Segments"), false);
});
