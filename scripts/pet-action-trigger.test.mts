import assert from "node:assert/strict";
import test from "node:test";
import {
  PET_ACTION_TRIGGER_ACTION_BY_REASON,
  PET_ACTION_TRIGGER_REASONS,
  getPetActionTriggerActionType,
  isPetNearWorkAreaEdge,
  parsePetActionTrigger
} from "../src/shared/pet-action-trigger.ts";
import { calculateInitialPetBounds } from "../src/shared/pet-presentation.ts";

test("pet action trigger allowlist only exposes fixed action and reason combinations", () => {
  assert.deepEqual(PET_ACTION_TRIGGER_REASONS, [
    "chat_opened",
    "chat_input_focus",
    "chat_reply_waiting",
    "pet_edge_settled",
    "rapid_touch_combo",
    "chat_reply_sustain"
  ]);
  assert.deepEqual(PET_ACTION_TRIGGER_ACTION_BY_REASON, {
    chat_opened: "listen",
    chat_input_focus: "listen",
    chat_reply_waiting: "replyThinking",
    pet_edge_settled: "edgeGlance",
    rapid_touch_combo: "flusteredGlance",
    chat_reply_sustain: "replySustain"
  });

  for (const reason of PET_ACTION_TRIGGER_REASONS) {
    assert.deepEqual(parsePetActionTrigger({ reason }), { reason });
    assert.equal(getPetActionTriggerActionType(reason), PET_ACTION_TRIGGER_ACTION_BY_REASON[reason]);
  }
});

test("pet action trigger parser rejects arbitrary action payloads and unsafe reasons", () => {
  assert.equal(parsePetActionTrigger({ reason: "click_body", type: "headPat" }), null);
  assert.equal(parsePetActionTrigger({ reason: "chat_opened", type: "headPat" })?.reason, "chat_opened");
  assert.equal(parsePetActionTrigger({ action: "replyThinking" }), null);
  assert.equal(parsePetActionTrigger(null), null);
});

test("pet edge helper detects settled visible edges without exposing bounds", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const initial = calculateInitialPetBounds(1, workArea);

  assert.equal(isPetNearWorkAreaEdge(initial, workArea), true);
  assert.equal(isPetNearWorkAreaEdge({ x: 720, y: 240, width: 420, height: 600 }, workArea), false);
  assert.equal(isPetNearWorkAreaEdge({ x: -42, y: 240, width: 420, height: 600 }, workArea), true);
  assert.equal(isPetNearWorkAreaEdge({ x: 1542, y: 240, width: 420, height: 600 }, workArea), true);
  assert.equal(isPetNearWorkAreaEdge({ x: 720, y: -60, width: 420, height: 600 }, workArea), true);
  assert.equal(isPetNearWorkAreaEdge({ x: 720, y: 741, width: 420, height: 600 }, workArea), true);
  assert.equal(isPetNearWorkAreaEdge({ x: Number.NaN, y: 0, width: 420, height: 600 }, workArea), false);
});
