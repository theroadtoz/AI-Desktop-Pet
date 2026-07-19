import assert from "node:assert/strict";
import test from "node:test";
import { runP265ReactionMotionTechnicalPlayback } from "./p2-65-reaction-motion-technical-playback.mts";

test("P2-77 technical playback verifies all 14 registered production assets and releases runtime state", async () => {
  const summary = await runP265ReactionMotionTechnicalPlayback();

  assert.equal(summary.ok, true);
  assert.equal(summary.safeSummaryOnly, true);
  assert.deepEqual(
    summary.cases,
    [
      { actionType: "doze", motionPresetId: "yawn-once", verificationMode: "production-action", registrationStatus: "registered", loadStatus: "loaded", startStatus: "started", completionStatus: "completed", restoreStatus: "restored", cleanupStatus: "released" },
      { actionType: "appearance", motionPresetId: "surprised-small", verificationMode: "production-action", registrationStatus: "registered", loadStatus: "loaded", startStatus: "started", completionStatus: "completed", restoreStatus: "restored", cleanupStatus: "released" },
      { actionType: "softSmile", motionPresetId: "happy-small", verificationMode: "production-action", registrationStatus: "registered", loadStatus: "loaded", startStatus: "started", completionStatus: "completed", restoreStatus: "restored", cleanupStatus: "released" },
      { actionType: "flusteredGlance", motionPresetId: "flustered-small", verificationMode: "production-action", registrationStatus: "registered", loadStatus: "loaded", startStatus: "started", completionStatus: "completed", restoreStatus: "restored", cleanupStatus: "released" },
      { actionType: "headPat", motionPresetId: "head-pat-linger", verificationMode: "production-action", registrationStatus: "registered", loadStatus: "loaded", startStatus: "started", completionStatus: "completed", restoreStatus: "restored", cleanupStatus: "released" },
      ...[
        ["bodyAttentionTurn", "body-attention-turn"],
        ["dialogueOpenWelcome", "dialogue-open-welcome"],
        ["replyWarmSettle", "reply-warm-settle"],
        ["musicListenSway", "music-listen-sway"],
        ["gamePresenceGlance", "game-presence-glance"],
        ["searchNoteSettle", "search-note-settle"],
        ["returnFromIdle", "return-from-idle"],
        ["eveningWindowGlance", "evening-window-glance"],
        ["longWorkRecovery", "long-work-recovery"]
      ].map(([actionType, motionPresetId]) => ({ actionType, motionPresetId, verificationMode: "production-action", registrationStatus: "registered", loadStatus: "loaded", startStatus: "started", completionStatus: "completed", restoreStatus: "restored", cleanupStatus: "released" }))
    ]
  );
  assert.deepEqual(summary.unmappedRegisteredPresetIds, []);
  assert.deepEqual(summary.cubismParsePresetIds, [
    "yawn-once",
    "happy-small",
    "surprised-small",
    "flustered-small",
    "head-pat-linger",
    "body-attention-turn",
    "dialogue-open-welcome",
    "reply-warm-settle",
    "music-listen-sway",
    "game-presence-glance",
    "search-note-settle",
    "return-from-idle",
    "evening-window-glance",
    "long-work-recovery"
  ]);
});
