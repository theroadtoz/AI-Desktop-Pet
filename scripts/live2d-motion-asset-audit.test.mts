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

const PRODUCT_MOTION_EXPECTATIONS = [
  ["yawn-once", "motions/yawn-once.motion3.json", "sleep", 5.1, "eca4ad06bb4665c3d4ae2a619a1d6528360044935508d08b06310ea3125b52b4"],
  ["happy-small", "motions/happy-small.motion3.json", "reaction", 3, "97d79427989bb80aa93cfa94912533fca710839f27dc1a1f367ff486c4b4a6fd"],
  ["surprised-small", "motions/surprised-small.motion3.json", "reaction", 2.6, "73d7821b635a5819a359a3b84d1bc989027194383fa131e81b448552387c98e2"],
  ["flustered-small", "motions/flustered-small.motion3.json", "reaction", 3.2, "dcf7f1b0e0dd87cdd441529c752772f4e2f4f2a12b74e26dfded0fdd62e2e35a"],
  ["head-pat-linger", "motions/head-pat-linger.motion3.json", "reaction", 6.4, "a99a9e1b9436c7d8cb7eb11907cc2ea05b7487a557e7cc909478f9f2f51c83f3"],
  ["body-attention-turn", "motions/body-attention-turn.motion3.json", "reaction", 6.2, "7081bc2adfaceb32de9882797eb564694848a2ae1a353da7bb44ee16e1b5cbf7"],
  ["dialogue-open-welcome", "motions/dialogue-open-welcome.motion3.json", "greeting", 6.4, "61633dcc1be9de90dd0eb46b4715cc81c8d1d947bbf55c5e4a1064d5ab3ab565"],
  ["reply-warm-settle", "motions/reply-warm-settle.motion3.json", "transition", 6.2, "548c3f2b1bfef81f97691895d51c1874f5fb4a042b3d4cf884b2815f77581b2c"],
  ["music-listen-sway", "motions/music-listen-sway.motion3.json", "idle", 8.4, "6ed6a61530e654bfec1bc9c61742eea0d452adaaa7399b04c60b68a32b24e833"],
  ["game-presence-glance", "motions/game-presence-glance.motion3.json", "game", 7.2, "cc14092a2bc9e438a35de555af75bb54d2f01babc1a8a48f98514eac5273bf94"],
  ["search-note-settle", "motions/search-note-settle.motion3.json", "reading", 6.4, "5d2ab761f9d0a5ac3b124464645f216ecd76ffc6e2bb5b555725de48e55ee2cf"],
  ["return-from-idle", "motions/return-from-idle.motion3.json", "greeting", 6.6, "e197e7f4fb2e52259f27507a651da22dd1232537ceadba6d33c68f6b656e7594"],
  ["evening-window-glance", "motions/evening-window-glance.motion3.json", "idle", 7.8, "3afa6027b072f53e23d7552eb05fd7a82de722c4a4b9e7c942b52ce011173cc1"],
  ["long-work-recovery", "motions/long-work-recovery.motion3.json", "transition", 7.6, "559022f1808b3cad7d09de93c8d42aa72f110f44f93e2110dc18b8bd2c9a9566"]
] as const;

const P2_77_PRESET_IDS = PRODUCT_MOTION_EXPECTATIONS.slice(4).map(([id]) => id);

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("motion asset audit verifies all 14 production presets, target hashes, metadata, and runtime catalog", () => {
  const audit = auditWitchMotionAssets();
  const productionManifest = JSON.parse(readFileSync(audit.manifestPath, "utf8"));
  const metadataPath = "resources/models/witch/motion-intake-metadata.json";
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));

  assert.equal(audit.auditVersion, 1);
  assert.deepEqual(audit.model3DeclaredMotionGroups, []);
  assert.deepEqual(
    audit.physicalMotionFiles,
    [
      "model/Scene1.motion3.json",
      "model/yawn-once.motion3.json",
      "model/yawn.motion3.json",
      ...PRODUCT_MOTION_EXPECTATIONS.map(([, path]) => `resources/models/witch/${path}`)
    ].sort()
  );
  assert.equal(audit.idleMotion.path, "model/Scene1.motion3.json");
  assert.equal(audit.idleMotion.loop, true);
  assert.equal(audit.idleMotion.semanticAllowed, false);
  assert.deepEqual(
    productionManifest.motionPresets.map((preset: { id: string; path: string }) => [preset.id, preset.path]),
    PRODUCT_MOTION_EXPECTATIONS.map(([id, path]) => [id, path])
  );
  assert.deepEqual(PET_MOTION_PRESET_IDS, PRODUCT_MOTION_EXPECTATIONS.map(([id]) => id));
  assert.deepEqual(PET_MOTION_PRESETS, productionManifest.motionPresets);
  assert.deepEqual(
    audit.semanticMotionPresets.map((preset) => [preset.id, preset.semanticKind, preset.durationSeconds, preset.status]),
    PRODUCT_MOTION_EXPECTATIONS.map(([id, , semanticKind, durationSeconds]) => [id, semanticKind, durationSeconds, "ready"])
  );
  assert.equal(audit.semanticMotionPresetCount, 14);
  assert.equal(audit.safeSkip, null);

  for (const [, path, , , expectedHash] of PRODUCT_MOTION_EXPECTATIONS) {
    assert.equal(sha256(`resources/models/witch/${path}`), expectedHash);
  }
  assert.deepEqual(readFileSync("resources/models/witch/motions/yawn-once.motion3.json"), readFileSync("model/yawn-once.motion3.json"));

  const metadataByPreset = new Map(metadata.entries.map((entry: { presetId: string }) => [entry.presetId, entry]));
  for (const [id, path, , , expectedHash] of PRODUCT_MOTION_EXPECTATIONS.slice(4)) {
    const entry = metadataByPreset.get(id) as Record<string, unknown> | undefined;
    assert.deepEqual(entry && {
      presetId: entry.presetId,
      targetPath: entry.targetPath,
      sourceHashPrefix: entry.sourceHashPrefix,
      intakeStatus: entry.intakeStatus,
      userVisualReview: entry.userVisualReview,
      technicalReadback: entry.technicalReadback,
      cubismRefined: entry.cubismRefined,
      runtimeEnabled: entry.runtimeEnabled
    }, {
      presetId: id,
      targetPath: path,
      sourceHashPrefix: expectedHash.slice(0, 12),
      intakeStatus: "user-authorized-vts-draft",
      userVisualReview: "passed",
      technicalReadback: "passed",
      cubismRefined: false,
      runtimeEnabled: true
    });
  }
  assert.deepEqual(P2_77_PRESET_IDS, metadata.entries.slice(-10).map((entry: { presetId: string }) => entry.presetId));
});

test("motion preset paths reject raw paths and non motion files", () => {
  assert.equal(validateMotionPresetPath("motions/wave.motion3.json"), "motions/wave.motion3.json");
  assert.throws(() => validateMotionPresetPath("motions/../wave.motion3.json"), /安全的 \.motion3\.json/);
  assert.throws(() => validateMotionPresetPath("C:/private/wave.motion3.json"), /POSIX 相对路径/);
  assert.throws(() => validateMotionPresetPath("..\\/wave.motion3.json"), /POSIX 相对路径/);
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
