import assert from "node:assert/strict";
import test from "node:test";
import {
  PET_INTERACTION_ACTIONS,
  PET_INTERACTION_ACTION_TYPES
} from "../src/renderer/pet/interaction-actions.ts";
import { APPROVED_MOTION_PRESETS } from "../src/shared/approved-motion-presets.ts";
import { auditWitchActionCapabilities } from "./live2d-action-capability-audit.mts";

const ISOLATED_YAWN_CANDIDATE_PATH = "model/yawn-once.motion3.json";

test("action capability audit covers every catalog action", () => {
  const audit = auditWitchActionCapabilities();

  assert.equal(audit.auditVersion, 1);
  assert.deepEqual(
    audit.targetActions.map((entry) => entry.action).sort(),
    [...PET_INTERACTION_ACTION_TYPES].sort()
  );
});

test("action capability audit reports the approved motion catalog without crossing the idle or legacy source boundary", () => {
  const audit = auditWitchActionCapabilities();
  const approvedMotionPresetsById = new Map(
    APPROVED_MOTION_PRESETS.map((preset) => [preset.id, preset] as const)
  );
  const expectedNativeMotionsByAction = PET_INTERACTION_ACTIONS.flatMap((action) => {
    if (!action.motionPresetId) {
      return [];
    }

    const preset = approvedMotionPresetsById.get(action.motionPresetId);
    if (!preset) {
      throw new Error(`正式动作目录引用了未批准的 motion preset：${action.motionPresetId}`);
    }

    return [[
      action.type,
      [{ id: preset.id, path: `resources/models/witch/${preset.path}` }]
    ] as const];
  });
  const nativeMotionsByAction = new Map(
    audit.targetActions.map((entry) => [
      entry.action,
      entry.nativeMotions.map((motion) => ({
        id: motion.id,
        path: motion.path
      }))
    ])
  );

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
  // P2-77 maps the ten user-approved long motions to explicit interaction actions.
  assert.equal(audit.semanticMotionPresetCount, APPROVED_MOTION_PRESETS.length);
  assert.equal(audit.motionSafeSkip, null);
  assert.deepEqual(
    [...nativeMotionsByAction.entries()].filter(([, motions]) => motions.length > 0),
    expectedNativeMotionsByAction
  );
  assert.equal(
    audit.targetActions.filter((entry) => entry.supportLevel === "native-motion").length,
    expectedNativeMotionsByAction.length
  );
  assert.equal(
    audit.targetActions.some((entry) => entry.nativeMotions.some((motion) => motion.path === "model/yawn.motion3.json")),
    false
  );
  assert.equal(
    audit.targetActions.some((entry) =>
      entry.nativeMotions.some((motion) => motion.path === ISOLATED_YAWN_CANDIDATE_PATH)
    ),
    false
  );
  assert.equal(
    audit.targetActions.some((entry) => entry.nativeMotions.some((motion) => motion.path === "model/Scene1.motion3.json")),
    false
  );
});

test("action capability audit captures accessory-backed candidates for later phases", () => {
  const audit = auditWitchActionCapabilities();
  const byAction = new Map(audit.targetActions.map((entry) => [entry.action, entry]));

  for (const action of ["curiousTilt", "quietNod", "shySmile", "readingThink", "gameCheerLite", "sleepySettle"] as const) {
    assert.equal(byAction.has(action), true);
    assert.deepEqual(byAction.get(action)?.nativeMotions, []);
  }

  assert.equal(byAction.get("reading")?.expressions.some((entry) => entry.name === "glasses"), true);
  assert.equal(byAction.get("readingThink")?.expressions.some((entry) => entry.name === "glasses"), true);
  assert.equal(byAction.get("reading")?.parts.some((entry) => entry.name.includes("眼镜")), true);
  assert.equal(byAction.get("playGame")?.expressions.some((entry) => entry.name === "gestureGame"), true);
  assert.equal(byAction.get("gameCheerLite")?.expressions.some((entry) => entry.name === "gestureGame"), true);
  assert.equal(byAction.get("playGame")?.parts.some((entry) => entry.name.includes("手柄")), true);
  assert.equal(byAction.get("shySmile")?.expressions.some((entry) => entry.name === "happy"), true);
  assert.equal(byAction.get("headPat")?.hitAreas.some((entry) => entry.name === "head"), true);
  assert.equal(byAction.get("sleepySettle")?.supportLevel, "expression-parameter-composition");
});
