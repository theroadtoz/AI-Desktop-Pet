import assert from "node:assert/strict";
import test from "node:test";
import { PET_INTERACTION_ACTION_TYPES } from "../src/renderer/pet/interaction-actions.ts";
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
  assert.equal(audit.semanticMotionPresetCount, 4);
  assert.equal(audit.motionSafeSkip, null);
  assert.deepEqual(
    [...nativeMotionsByAction.entries()].filter(([, motions]) => motions.length > 0),
    [
      ["appearance", [{ id: "surprised-small", path: "resources/models/witch/motions/surprised-small.motion3.json" }]],
      ["headPat", [{ id: "happy-small", path: "resources/models/witch/motions/happy-small.motion3.json" }]],
      ["doze", [{ id: "yawn-once", path: "resources/models/witch/motions/yawn-once.motion3.json" }]],
      ["flusteredGlance", [{ id: "flustered-small", path: "resources/models/witch/motions/flustered-small.motion3.json" }]]
    ]
  );
  assert.equal(audit.targetActions.filter((entry) => entry.supportLevel === "native-motion").length, 4);
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
