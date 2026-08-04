import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ATTENTION_MICRO_CUE_CANCEL_COMMAND,
  ATTENTION_MICRO_CUE_START_COMMAND,
  parseAttentionMicroCueCommand
} from "../src/shared/attention-micro-cue.ts";
import {
  APPROVED_ATTENTION_MICRO_CUE_PROFILE
} from "../src/renderer/pet/attention-micro-cue-profile.ts";
import { CURIOUS_FOCUS_PULSE_PROFILE } from "../src/renderer/pet/p2-88d-curious-low-preview-profile.ts";
import { createAttentionMicroCueController } from "../src/renderer/pet/attention-micro-cue-controller.ts";

test("P2-88E accepts only exact low attention micro-cue start and no-payload cancel commands", () => {
  assert.deepEqual(
    parseAttentionMicroCueCommand({
      operation: "start",
      kind: "attention-micro-cue",
      intensity: "low"
    }),
    {
      operation: "start",
      kind: "attention-micro-cue",
      intensity: "low"
    }
  );
  assert.deepEqual(parseAttentionMicroCueCommand({ operation: "cancel" }), {
    operation: "cancel"
  });

  for (const invalid of [
    null,
    [],
    { operation: "start", kind: "attention-micro-cue", intensity: "medium" },
    { operation: "start", kind: "curious", intensity: "low" },
    { operation: "start", kind: "attention-micro-cue", intensity: "low", requestId: "unsafe" },
    { operation: "cancel", reason: "user body" }
  ]) {
    assert.equal(parseAttentionMicroCueCommand(invalid), null);
  }
});

test("P2-88E plays one exact low cue and drops repeats without restarting", () => {
  const calls: Array<[number, number]> = [];
  const scheduled = new Map<number, () => void>();
  let sequence = 0;
  const controller = createAttentionMicroCueController({
    isRendererStable: () => true,
    isVisible: () => true,
    isInteractionActionActive: () => false,
    isRecoveringContext: () => false,
    setLookTarget: (x, y) => calls.push([x, y]),
    releaseLookTarget: () => calls.push([0, 0]),
    scheduleTimeout: (callback, delayMs) => {
      scheduled.set(delayMs, callback);
      return ++sequence;
    },
    clearScheduledTimeout: () => undefined
  });

  assert.deepEqual(controller.handle(ATTENTION_MICRO_CUE_START_COMMAND), {
    accepted: true,
    reason: "started"
  });
  assert.deepEqual(controller.handle(ATTENTION_MICRO_CUE_START_COMMAND), {
    accepted: false,
    reason: "active"
  });
  assert.deepEqual([...scheduled.keys()], [160, 620, 1150]);
  scheduled.get(160)!();
  scheduled.get(620)!();
  scheduled.get(1150)!();

  assert.deepEqual(calls, [[0, 0], [0.18, 0.1], [0.05, 0.03], [0, 0]]);
  assert.equal(controller.isActive(), false);
});

test("P2-88E distinguishes natural release from an explicit idempotent cancel", () => {
  const results: string[] = [];
  const scheduled = new Map<number, () => void>();
  const controller = createAttentionMicroCueController({
    isRendererStable: () => true,
    isVisible: () => true,
    isInteractionActionActive: () => false,
    isRecoveringContext: () => false,
    setLookTarget: () => undefined,
    releaseLookTarget: () => undefined,
    scheduleTimeout: (callback, delayMs) => {
      scheduled.set(delayMs, callback);
      return delayMs;
    },
    clearScheduledTimeout: () => undefined,
    reportResult: ({ reason }) => results.push(reason)
  });

  controller.handle(ATTENTION_MICRO_CUE_START_COMMAND);
  scheduled.get(1150)!();
  assert.equal(results.at(-1), "released");

  controller.handle(ATTENTION_MICRO_CUE_START_COMMAND);
  assert.deepEqual(controller.handle(ATTENTION_MICRO_CUE_CANCEL_COMMAND), {
    accepted: true,
    reason: "cancelled"
  });
  assert.deepEqual(controller.handle(ATTENTION_MICRO_CUE_CANCEL_COMMAND), {
    accepted: false,
    reason: "idle"
  });
});

test("P2-88E carries only validated commands from main through preload into the dedicated renderer cue", () => {
  const contract = readFileSync("src/shared/ipc-contract.ts", "utf8");
  const preload = readFileSync("src/preload/pet-preload.ts", "utf8");
  const renderer = readFileSync("src/renderer/pet/main.ts", "utf8");

  assert.match(contract, /onAttentionMicroCue\(handler: \(command: AttentionMicroCueCommand\) => void\)/);
  assert.match(preload, /parseAttentionMicroCueCommand\(value\)/);
  assert.match(preload, /ipcRenderer\.on\(ATTENTION_MICRO_CUE_CHANNEL, listener\)/);
  assert.match(renderer, /createAttentionMicroCueController\(/);
  assert.match(renderer, /onAttentionMicroCue\(\(command\) =>/);
  assert.match(renderer, /attentionMicroCueController\.handle\(command\)/);
});

test("P2-91B production wiring makes P2-88E default-on with dialogue-affect and main-owner gates", () => {
  const appSource = readFileSync("src/main/app.ts", "utf8");
  const observationStart = appSource.indexOf(
    "const shadowObservation = createDeterministicXitaInteractionCueShadowObservation"
  );
  const affectResolutionStart = appSource.indexOf(
    "affectTurnResolution = resolveDialogueAffectForMessage",
    observationStart
  );
  const acceptedRequestSlice = appSource.slice(observationStart, affectResolutionStart);
  const settingsStart = appSource.indexOf('ipcMain.handle("dialogueAffect:set-settings"');
  const settingsEnd = appSource.indexOf('ipcMain.handle("localRuntime:diagnose-local-model"', settingsStart);
  const settingsSlice = appSource.slice(settingsStart, settingsEnd);
  const senderStart = appSource.indexOf("function sendAttentionMicroCueCommand");
  const senderEnd = appSource.indexOf("function getProactiveBubbleRuntimeGates", senderStart);
  const senderSlice = appSource.slice(senderStart, senderEnd);

  assert.match(
    appSource,
    /const isAttentionMicroCueRolloutEnabled = readAttentionMicroCueRolloutEnabled\(\s*process\.env\.AI_DESKTOP_PET_ATTENTION_MICRO_CUE_ROLLOUT\s*\)/
  );
  assert.match(
    acceptedRequestSlice,
    /shadowObservation[\s\S]*isAttentionMicroCueRolloutEnabled[\s\S]*currentDialogueAffectSettings\.enabled[\s\S]*sendAttentionMicroCueCommand\(ATTENTION_MICRO_CUE_START_COMMAND\)/
  );
  assert.doesNotMatch(acceptedRequestSlice, /requestPetActionTrigger|sendPetActionTrigger/);
  assert.match(senderSlice, /try \{[\s\S]*canStartAttentionMicroCueSafely\(\(\) => \(\{/);
  assert.match(senderSlice, /catch \{[\s\S]*return false/);
  assert.match(senderSlice, /affectEnabled: currentDialogueAffectSettings\.enabled/);
  assert.match(senderSlice, /petReady: hasPetFirstFrame/);
  assert.match(senderSlice, /petWindow\.isVisible\(\)/);
  assert.match(senderSlice, /presentationBusy: petActionDispatchCoordinator\?\.getState\(\)\.busy \?\? true/);
  assert.match(
    settingsSlice,
    /!currentDialogueAffectSettings\.enabled[\s\S]*sendAttentionMicroCueCommand\(ATTENTION_MICRO_CUE_CANCEL_COMMAND\)/
  );
});

test("P2-88E drops for an action owner and never resets look after a later owner takes control", () => {
  const calls: Array<[number, number]> = [];
  const results: string[] = [];
  const scheduled = new Map<number, () => void>();
  let ownerActive = true;
  const controller = createAttentionMicroCueController({
    isRendererStable: () => true,
    isVisible: () => true,
    isInteractionActionActive: () => ownerActive,
    isRecoveringContext: () => false,
    setLookTarget: (x, y) => calls.push([x, y]),
    releaseLookTarget: () => calls.push([0, 0]),
    scheduleTimeout: (callback, delayMs) => {
      scheduled.set(delayMs, callback);
      return delayMs;
    },
    clearScheduledTimeout: () => undefined,
    reportResult: ({ reason }) => results.push(reason)
  });

  assert.deepEqual(controller.handle(ATTENTION_MICRO_CUE_START_COMMAND), {
    accepted: false,
    reason: "owner-active"
  });
  ownerActive = false;
  controller.handle(ATTENTION_MICRO_CUE_START_COMMAND);
  scheduled.get(160)!();
  ownerActive = true;
  calls.push([-0.6, 0.4]);
  scheduled.get(620)!();

  assert.equal(controller.isActive(), false);
  assert.equal(results.at(-1), "owner-active");
  assert.deepEqual(calls, [[0, 0], [0.18, 0.1], [-0.6, 0.4]]);
});

test("P2-88E treats an owner getter failure as unknown ownership without resetting the new owner look", () => {
  const calls: Array<[number, number]> = [];
  const results: string[] = [];
  const scheduled = new Map<number, () => void>();
  let ownerGetterThrows = false;
  const controller = createAttentionMicroCueController({
    isRendererStable: () => true,
    isVisible: () => true,
    isInteractionActionActive: () => {
      if (ownerGetterThrows) throw new Error("owner unavailable");
      return false;
    },
    isRecoveringContext: () => false,
    setLookTarget: (x, y) => calls.push([x, y]),
    releaseLookTarget: () => calls.push([0, 0]),
    scheduleTimeout: (callback, delayMs) => {
      scheduled.set(delayMs, callback);
      return delayMs;
    },
    clearScheduledTimeout: () => undefined,
    reportResult: ({ reason }) => results.push(reason)
  });

  controller.handle(ATTENTION_MICRO_CUE_START_COMMAND);
  ownerGetterThrows = true;
  calls.push([-0.6, 0.4]);
  scheduled.get(160)!();

  assert.equal(controller.isActive(), false);
  assert.equal(results.at(-1), "owner-unknown");
  assert.deepEqual(calls, [[0, 0], [-0.6, 0.4]]);
});

test("P2-88E reports failed and releases its look when a mid-curve write throws", () => {
  const calls: Array<[number, number]> = [];
  const results: string[] = [];
  const scheduled = new Map<number, () => void>();
  let throwOnWrite = false;
  const controller = createAttentionMicroCueController({
    isRendererStable: () => true,
    isVisible: () => true,
    isInteractionActionActive: () => false,
    isRecoveringContext: () => false,
    setLookTarget: (x, y) => {
      if (throwOnWrite) throw new Error("look write failed");
      calls.push([x, y]);
    },
    releaseLookTarget: () => calls.push([0, 0]),
    scheduleTimeout: (callback, delayMs) => {
      scheduled.set(delayMs, callback);
      return delayMs;
    },
    clearScheduledTimeout: () => undefined,
    reportResult: ({ reason }) => results.push(reason)
  });

  controller.handle(ATTENTION_MICRO_CUE_START_COMMAND);
  throwOnWrite = true;
  scheduled.get(160)!();

  assert.equal(controller.isActive(), false);
  assert.equal(results.at(-1), "failed");
  assert.deepEqual(calls, [[0, 0], [0, 0]]);
});

test("P2-88E cleanup remains idempotent when timer cancellation fails", () => {
  let releases = 0;
  const controller = createAttentionMicroCueController({
    isRendererStable: () => true,
    isVisible: () => true,
    isInteractionActionActive: () => false,
    isRecoveringContext: () => false,
    setLookTarget: () => undefined,
    releaseLookTarget: () => {
      releases += 1;
    },
    scheduleTimeout: (_callback, delayMs) => delayMs,
    clearScheduledTimeout: () => {
      throw new Error("timer cleanup failed");
    }
  });

  controller.handle(ATTENTION_MICRO_CUE_START_COMMAND);
  assert.doesNotThrow(() => controller.handle(ATTENTION_MICRO_CUE_CANCEL_COMMAND));
  assert.equal(controller.isActive(), false);
  assert.equal(releases, 1);
  assert.doesNotThrow(() => controller.dispose());
  assert.equal(releases, 1);
});

test("P2-88E closes on recovery without replaying after recovery", () => {
  const results: string[] = [];
  const scheduled = new Map<number, () => void>();
  let recovering = false;
  let releases = 0;
  const controller = createAttentionMicroCueController({
    isRendererStable: () => true,
    isVisible: () => true,
    isInteractionActionActive: () => false,
    isRecoveringContext: () => recovering,
    setLookTarget: () => undefined,
    releaseLookTarget: () => {
      releases += 1;
    },
    scheduleTimeout: (callback, delayMs) => {
      scheduled.set(delayMs, callback);
      return delayMs;
    },
    clearScheduledTimeout: () => undefined,
    reportResult: ({ reason }) => results.push(reason)
  });

  controller.handle(ATTENTION_MICRO_CUE_START_COMMAND);
  recovering = true;
  scheduled.get(160)!();
  assert.equal(controller.isActive(), false);
  assert.equal(results.at(-1), "recovering");
  assert.equal(releases, 1);

  recovering = false;
  assert.equal(controller.isActive(), false);
  assert.equal(releases, 1);
});

test("P2-88E fails closed before ownership when renderer, visibility, or recovery is unsafe", () => {
  const calls: Array<[number, number]> = [];
  let rendererStable = false;
  let visible = true;
  let recovering = false;
  const controller = createAttentionMicroCueController({
    isRendererStable: () => rendererStable,
    isVisible: () => visible,
    isInteractionActionActive: () => false,
    isRecoveringContext: () => recovering,
    setLookTarget: (x, y) => calls.push([x, y]),
    releaseLookTarget: () => calls.push([0, 0]),
    scheduleTimeout: () => 1,
    clearScheduledTimeout: () => undefined
  });

  assert.equal(controller.handle(ATTENTION_MICRO_CUE_START_COMMAND).reason, "renderer-unavailable");
  rendererStable = true;
  visible = false;
  assert.equal(controller.handle(ATTENTION_MICRO_CUE_START_COMMAND).reason, "hidden");
  visible = true;
  recovering = true;
  assert.equal(controller.handle(ATTENTION_MICRO_CUE_START_COMMAND).reason, "recovering");
  assert.deepEqual(calls, []);

  controller.dispose();
  recovering = false;
  assert.equal(controller.handle(ATTENTION_MICRO_CUE_START_COMMAND).reason, "disposed");
  assert.deepEqual(calls, []);
});

test("P2-88E cue contract contains no content, prompt, request identity, path, or affect escalation", () => {
  const ownedSources = [
    "src/shared/attention-micro-cue.ts",
    "src/renderer/pet/attention-micro-cue-profile.ts",
    "src/renderer/pet/attention-micro-cue-controller.ts"
  ].map((path) => readFileSync(path, "utf8")).join("\n");

  assert.doesNotMatch(
    ownedSources,
    /\b(?:content|prompt|requestId|conversationId|absolutePath|resourcePath|state_curious|medium|high)\b/
  );
});

test("P2-88E approved registry reuses the exact owner-approved P2-88D look profile", () => {
  assert.deepEqual(APPROVED_ATTENTION_MICRO_CUE_PROFILE, {
    schemaVersion: 1,
    id: "attention-micro-cue-v1",
    status: "approved",
    sourceProfileId: "curious-focus-pulse-v1",
    sourceProfileDigest: "64bf0f937bcc34876cc86565bd4c9b5e5619ad6d7ce84fc203b6a883bd02dd22",
    durationMs: 1150,
    lookTarget: CURIOUS_FOCUS_PULSE_PROFILE.lookTarget
  });
  assert.equal(
    APPROVED_ATTENTION_MICRO_CUE_PROFILE.lookTarget,
    CURIOUS_FOCUS_PULSE_PROFILE.lookTarget
  );
});
