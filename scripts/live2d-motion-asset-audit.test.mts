import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PET_MOTION_PRESET_IDS, PET_MOTION_PRESETS } from "../src/shared/pet-motion-presets.ts";
import {
  auditWitchMotionAssets,
  isProductionReadyMotionAssetLicenseStatus,
  validateMotionPresetPath
} from "./live2d-motion-asset-audit.mts";

const YAWN_ONCE_PRESET = {
  id: "yawn-once",
  path: "motions/yawn-once.motion3.json",
  semanticKind: "sleep",
  loop: false,
  fadeInSeconds: 0.2,
  fadeOutSeconds: 0.2,
  durationHintSeconds: 5.1,
  priority: 50,
  cooldownMs: 2_000,
  restorePolicy: "restore-current-state",
  allowedStates: ["sleep"],
  allowedPresenceModes: ["sleep"],
  allowedDialogueModes: ["default"],
  visualRisk: "needs-visual-check",
  assetLicenseStatus: "user-provided"
} as const;

const YAWN_ONCE_SHA256 = "eca4ad06bb4665c3d4ae2a619a1d6528360044935508d08b06310ea3125b52b4";
const YAWN_ONCE_RUNTIME_PATH = "resources/models/witch/motions/yawn-once.motion3.json";

test("motion asset audit reports the production yawn-once registration", () => {
  const audit = auditWitchMotionAssets();

  assert.equal(audit.auditVersion, 1);
  assert.deepEqual(audit.model3DeclaredMotionGroups, []);
  assert.deepEqual(audit.physicalMotionFiles, [
    "model/Scene1.motion3.json",
    "model/yawn-once.motion3.json",
    "model/yawn.motion3.json",
    YAWN_ONCE_RUNTIME_PATH
  ]);
  assert.equal(audit.idleMotion.path, "model/Scene1.motion3.json");
  assert.equal(audit.idleMotion.loop, true);
  assert.equal(audit.idleMotion.semanticAllowed, false);
  const productionManifest = JSON.parse(readFileSync(audit.manifestPath, "utf8"));
  assert.deepEqual(productionManifest.motionPresets, [YAWN_ONCE_PRESET]);
  assert.deepEqual(PET_MOTION_PRESET_IDS, [YAWN_ONCE_PRESET.id]);
  assert.deepEqual(PET_MOTION_PRESETS, productionManifest.motionPresets);
  assert.deepEqual(audit.semanticMotionPresets, [
    {
      id: YAWN_ONCE_PRESET.id,
      path: YAWN_ONCE_RUNTIME_PATH,
      semanticKind: YAWN_ONCE_PRESET.semanticKind,
      loop: false,
      metaLoop: false,
      durationSeconds: 5.1,
      durationHintSeconds: 5.1,
      priority: 50,
      cooldownMs: 2_000,
      restorePolicy: "restore-current-state",
      allowedStates: ["sleep"],
      visualRisk: "needs-visual-check",
      assetLicenseStatus: "user-provided",
      productionReady: true,
      parameterIds: ["ParamAngleX", "ParamAngleY", "ParamAngleZ", "ParamBrowLForm", "ParamBrowLY", "ParamEyeLOpen", "ParamEyeROpen", "ParamMouthForm", "ParamMouthOpenY"],
      status: "ready"
    }
  ]);
  assert.equal(audit.semanticMotionPresetCount, 1);
  assert.equal(audit.safeSkip, null);

  const runtimeMotion = readFileSync(YAWN_ONCE_RUNTIME_PATH);
  assert.deepEqual(runtimeMotion, readFileSync("model/yawn-once.motion3.json"));
  assert.equal(createHash("sha256").update(runtimeMotion).digest("hex"), YAWN_ONCE_SHA256);
  const motion = JSON.parse(runtimeMotion.toString("utf8"));
  assert.equal(motion.Version, 3);
  assert.equal(motion.Meta.Loop, false);
});

test("motion preset whitelist exposes only yawn-once", () => {
  assert.deepEqual(PET_MOTION_PRESET_IDS, [YAWN_ONCE_PRESET.id]);
});

test("motion preset paths reject raw paths and non motion files", () => {
  assert.equal(validateMotionPresetPath("motions/wave.motion3.json"), "motions/wave.motion3.json");
  assert.throws(() => validateMotionPresetPath("motions/../wave.motion3.json"), /安全的 \.motion3\.json/);
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
