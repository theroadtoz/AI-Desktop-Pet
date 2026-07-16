import assert from "node:assert/strict";
import test from "node:test";
import { runP265ReactionMotionTechnicalPlayback } from "./p2-65-reaction-motion-technical-playback.mts";

test("P2-65 technical playback verifies each registered reaction asset once and releases runtime state", async () => {
  const summary = await runP265ReactionMotionTechnicalPlayback();

  assert.equal(summary.ok, true);
  assert.equal(summary.safeSummaryOnly, true);
  assert.deepEqual(
    summary.cases,
    [
      { actionType: "headPat", motionPresetId: "happy-small", registrationStatus: "registered", loadStatus: "loaded", startStatus: "started", completionStatus: "completed", restoreStatus: "restored", cleanupStatus: "released" },
      { actionType: "appearance", motionPresetId: "surprised-small", registrationStatus: "registered", loadStatus: "loaded", startStatus: "started", completionStatus: "completed", restoreStatus: "restored", cleanupStatus: "released" },
      { actionType: "flusteredGlance", motionPresetId: "flustered-small", registrationStatus: "registered", loadStatus: "loaded", startStatus: "started", completionStatus: "completed", restoreStatus: "restored", cleanupStatus: "released" }
    ]
  );
});
