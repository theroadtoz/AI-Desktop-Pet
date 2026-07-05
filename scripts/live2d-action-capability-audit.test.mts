import assert from "node:assert/strict";
import test from "node:test";
import { PET_INTERACTION_ACTION_TYPES } from "../src/renderer/pet/interaction-actions.ts";
import { auditWitchActionCapabilities } from "./live2d-action-capability-audit.mts";

test("action capability audit covers every catalog action", () => {
  const audit = auditWitchActionCapabilities();

  assert.equal(audit.auditVersion, 1);
  assert.deepEqual(
    audit.targetActions.map((entry) => entry.action).sort(),
    [...PET_INTERACTION_ACTION_TYPES].sort()
  );
});

test("action capability audit records that the current model has no native semantic motions", () => {
  const audit = auditWitchActionCapabilities();

  assert.deepEqual(audit.model3DeclaredMotionGroups, []);
  assert.deepEqual(audit.physicalMotionFiles, ["model/Scene1.motion3.json"]);
  assert.equal(audit.idleMotion.loop, true);
  assert.equal(audit.semanticMotionPresetCount, 0);
  assert.deepEqual(audit.motionSafeSkip, {
    status: "expected-safe-skip",
    reason: "no-semantic-motion-presets"
  });
  assert.equal(audit.targetActions.every((entry) => entry.supportLevel !== "native-motion"), true);
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
