import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PET_TELEMETRY_ALLOWED_FIELDS,
  PET_TELEMETRY_EVENT_TYPES,
  isPetRendererTelemetryEventType,
  isPetTelemetryEventType,
  parsePetRendererTelemetryEvent,
  parsePetTelemetryEvent,
  sanitizePetTelemetryEvent
} from "../src/shared/pet-telemetry-contract.ts";

const REQUIRED_EVENT_TYPES = [
  "pet_interaction_action_started",
  "pet_interaction_action_finished",
  "pet_interaction_action_skipped",
  "pet_window_motion_detected",
  "pet_window_motion_feedback",
  "pet_health",
  "renderer_process_gone",
  "child_process_gone",
  "webgl_context_lost",
  "webgl_context_restored",
  "recovery_started",
  "recovery_succeeded",
  "recovery_failed",
  "pet_scale_adjusted",
  "pet_performance_sample",
  "pet_presentation_intent_applied"
] as const;

const FORBIDDEN_KEYS = [
  "apiKey",
  "systemPrompt",
  "prompt",
  "providerRequestBody",
  "messages",
  "content",
  "reply",
  "factCardBody",
  "envLocal",
  "rawMouseTrajectory",
  "bounds",
  "windowBounds",
  "windowTitle",
  "foregroundApp",
  "url",
  "query",
  "title",
  "snippet",
  "rawResult",
  "text",
  "bubbleText",
  "path",
  "request",
  "response",
  "expressionName",
  "expressionPath",
  "resourcePath",
  "motion",
  "partId",
  "payload"
] as const;

function assertNoForbiddenKeys(payload: Record<string, unknown> | undefined): void {
  const keys = Object.keys(payload ?? {});
  for (const key of FORBIDDEN_KEYS) {
    assert.equal(keys.includes(key), false, `${key} should be stripped`);
  }
  for (const key of keys) {
    assert.equal(PET_TELEMETRY_ALLOWED_FIELDS.includes(key as never), true, `${key} should be listed as allowed`);
  }
}

test("pet telemetry contract covers current real UI event dependencies", () => {
  for (const eventType of REQUIRED_EVENT_TYPES) {
    assert.equal(isPetTelemetryEventType(eventType), true);
    assert.equal(PET_TELEMETRY_EVENT_TYPES.includes(eventType), true);
  }

  assert.equal(isPetRendererTelemetryEventType("pet_interaction_action_started"), true);
  assert.equal(isPetRendererTelemetryEventType("pet_window_motion_feedback"), true);
  assert.equal(isPetRendererTelemetryEventType("pet_health"), false);
  assert.equal(isPetRendererTelemetryEventType("pet_scale_adjusted"), false);
});

test("unknown telemetry events are rejected", () => {
  assert.equal(parsePetTelemetryEvent({ type: "pet_unknown", payload: { reason: "x" } }), null);
  assert.equal(parsePetRendererTelemetryEvent({ type: "pet_health", payload: { renderer: "live2d" } }), null);
});

test("pet interaction action started keeps only safe action summary fields", () => {
  const event = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "thinking",
      reason: "click_body",
      durationMs: 1400,
      stateId: "work",
      modeId: "work",
      presenceModeId: "quiet",
      candidateActionTypes: ["thinking", "focus"],
      selectedActionType: "thinking",
      expressionPresetId: "happy",
      expressionName: "happy",
      expressionPath: "resources/models/witch/happy.exp3.json",
      apiKey: "sentinel",
      content: "sentinel",
      prompt: "sentinel",
      bounds: [{ x: 1, y: 2 }],
      url: "https://example.invalid/private",
      path: "C:\\private\\file.txt",
      request: { body: "provider request body" }
    }
  });

  assert.deepEqual(event, {
      type: "pet_interaction_action_started",
      payload: {
        type: "thinking",
        reason: "click_body",
        durationMs: 1400,
        stateId: "work",
        modeId: "work",
        presenceModeId: "quiet",
        candidateActionTypes: ["thinking", "focus"],
        selectedActionType: "thinking",
        expressionPresetId: "happy"
    }
  });
  assertNoForbiddenKeys(event?.payload);
});

test("native action terminal telemetry keeps only safe preset and terminal enums", () => {
  const event = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_finished",
    payload: {
      type: "doze",
      reason: "state_sleep",
      motionPresetId: "yawn-once",
      terminalStatus: "interrupted",
      restoredAccessoryPresetId: "none",
      path: "C:\\private\\yawn-once.motion3.json",
      motion: { Curves: ["sentinel"] }
    }
  });
  const unsafeStatus = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_finished",
    payload: {
      type: "doze",
      reason: "state_sleep",
      motionPresetId: "C:\\private\\yawn-once.motion3.json",
      terminalStatus: "disposed"
    }
  });

  assert.deepEqual(event, {
    type: "pet_interaction_action_finished",
    payload: {
      type: "doze",
      reason: "state_sleep",
      motionPresetId: "yawn-once",
      terminalStatus: "interrupted",
      restoredAccessoryPresetId: "none"
    }
  });
  assert.deepEqual(unsafeStatus, {
    type: "pet_interaction_action_finished",
    payload: {
      type: "doze",
      reason: "state_sleep"
    }
  });
  assertNoForbiddenKeys(event?.payload);
  assertNoForbiddenKeys(unsafeStatus?.payload);
});

test("action trigger telemetry keeps only fixed safe trigger reasons", () => {
  const event = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "edgeGlance",
      reason: "pet_edge_settled",
      durationMs: 1250,
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      windowBounds: [{ x: 1, y: 2, width: 3, height: 4 }],
      content: "sentinel",
      request: { body: "sentinel" }
    }
  });
  const unsafeReason = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "replyThinking",
      reason: "provider_payload_selected_action",
      durationMs: 1250
    }
  });
  const rapidTouchCombo = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "flusteredGlance",
      reason: "rapid_touch_combo",
      durationMs: 1200,
      motion: "sentinel",
      actionPayload: { type: "unsafe" },
      content: "sentinel"
    }
  });
  const replySustain = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "replySustain",
      reason: "chat_reply_sustain",
      durationMs: 1100,
      providerRequestBody: "sentinel",
      messages: ["sentinel"]
    }
  });
  const expressionPresetAction = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "gameCheerLite",
      reason: "click_body",
      durationMs: 1300,
      modeId: "game",
      candidateActionTypes: ["gameReady", "gameCheerLite"],
      selectedActionType: "gameCheerLite",
      expressionPresetId: "gestureGame",
      expressionName: "gestureGame",
      partId: "Part17",
      path: "C:\\private\\gestureGame.exp3.json",
      motion: "unsafe.motion3.json",
      motionPresetId: "C:\\private\\wave.motion3.json",
      content: "sentinel"
    }
  });
  const unsafeExpressionPreset = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "shySmile",
      reason: "click_body",
      durationMs: 1200,
      expressionPresetId: "C:\\private\\happy.exp3.json",
      expressionName: "happy"
    }
  });
  const stateWork = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "workFocus",
      reason: "state_work",
      stateId: "work",
      durationMs: 1600,
      modeId: "work",
      presenceModeId: "focus",
      prompt: "sentinel",
      providerRequestBody: "sentinel",
      factCardBody: "sentinel"
    }
  });
  const unsafeStateId = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "replyThinking",
      reason: "state_local_model_busy",
      stateId: "C:\\private\\model.gguf",
      durationMs: 1250,
      content: "sentinel"
    }
  });
  const memoryInjected = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "quietNod",
      reason: "state_memory_injected",
      stateId: "memory-injected",
      durationMs: 1050,
      expressionPresetId: "happy",
      count: 3,
      cards: ["sentinel"],
      factCardBody: "sentinel",
      content: "sentinel"
    }
  });
  const memorySkipped = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "quietNod",
      reason: "state_memory_skipped",
      stateId: "memory-skipped",
      durationMs: 1050,
      skippedReason: "sensitive",
      payload: { text: "sentinel" },
      messages: ["sentinel"],
      prompt: "sentinel"
    }
  });
  const searchCited = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "readingIdle",
      reason: "state_search_cited",
      stateId: "search-cited",
      durationMs: 1600,
      expressionPresetId: "glasses",
      query: "sentinel",
      url: "https://example.invalid/private",
      title: "sentinel",
      snippet: "sentinel",
      rawResult: { content: "sentinel" },
      content: "sentinel"
    }
  });
  const proactiveBubbleVisible = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "softSmile",
      reason: "state_proactive_bubble_visible",
      stateId: "proactive-bubble-visible",
      durationMs: 1300,
      expressionPresetId: "happy",
      text: "sentinel",
      bubbleText: "sentinel",
      content: "sentinel",
      prompt: "sentinel"
    }
  });
  const unsafeAction = parsePetRendererTelemetryEvent({
    type: "pet_interaction_action_started",
    payload: {
      type: "providerSelectedMotion",
      reason: "rapid_touch_combo",
      durationMs: 1200
    }
  });

  assert.deepEqual(event, {
    type: "pet_interaction_action_started",
    payload: {
      type: "edgeGlance",
      reason: "pet_edge_settled",
      durationMs: 1250
    }
  });
  assert.deepEqual(unsafeReason, {
    type: "pet_interaction_action_started",
    payload: {
      type: "replyThinking",
      durationMs: 1250
    }
  });
  assert.deepEqual(rapidTouchCombo, {
    type: "pet_interaction_action_started",
    payload: {
      type: "flusteredGlance",
      reason: "rapid_touch_combo",
      durationMs: 1200
    }
  });
  assert.deepEqual(replySustain, {
    type: "pet_interaction_action_started",
    payload: {
      type: "replySustain",
      reason: "chat_reply_sustain",
      durationMs: 1100
    }
  });
  assert.deepEqual(expressionPresetAction, {
    type: "pet_interaction_action_started",
    payload: {
      type: "gameCheerLite",
      reason: "click_body",
      durationMs: 1300,
      modeId: "game",
      candidateActionTypes: ["gameReady", "gameCheerLite"],
      selectedActionType: "gameCheerLite",
      expressionPresetId: "gestureGame"
    }
  });
  assert.deepEqual(unsafeExpressionPreset, {
    type: "pet_interaction_action_started",
    payload: {
      type: "shySmile",
      reason: "click_body",
      durationMs: 1200
    }
  });
  assert.deepEqual(stateWork, {
    type: "pet_interaction_action_started",
    payload: {
      type: "workFocus",
      reason: "state_work",
      stateId: "work",
      durationMs: 1600,
      modeId: "work",
      presenceModeId: "focus"
    }
  });
  assert.deepEqual(unsafeStateId, {
    type: "pet_interaction_action_started",
    payload: {
      type: "replyThinking",
      reason: "state_local_model_busy",
      durationMs: 1250
    }
  });
  assert.deepEqual(memoryInjected, {
    type: "pet_interaction_action_started",
    payload: {
      type: "quietNod",
      reason: "state_memory_injected",
      stateId: "memory-injected",
      durationMs: 1050,
      expressionPresetId: "happy"
    }
  });
  assert.deepEqual(memorySkipped, {
    type: "pet_interaction_action_started",
    payload: {
      type: "quietNod",
      reason: "state_memory_skipped",
      stateId: "memory-skipped",
      durationMs: 1050
    }
  });
  assert.deepEqual(searchCited, {
    type: "pet_interaction_action_started",
    payload: {
      type: "readingIdle",
      reason: "state_search_cited",
      stateId: "search-cited",
      durationMs: 1600,
      expressionPresetId: "glasses"
    }
  });
  assert.deepEqual(proactiveBubbleVisible, {
    type: "pet_interaction_action_started",
    payload: {
      type: "softSmile",
      reason: "state_proactive_bubble_visible",
      stateId: "proactive-bubble-visible",
      durationMs: 1300,
      expressionPresetId: "happy"
    }
  });
  assert.deepEqual(unsafeAction, {
    type: "pet_interaction_action_started",
    payload: {
      reason: "rapid_touch_combo",
      durationMs: 1200
    }
  });
  assertNoForbiddenKeys(event?.payload);
  assertNoForbiddenKeys(unsafeReason?.payload);
  assertNoForbiddenKeys(rapidTouchCombo?.payload);
  assertNoForbiddenKeys(replySustain?.payload);
  assertNoForbiddenKeys(expressionPresetAction?.payload);
  assertNoForbiddenKeys(unsafeExpressionPreset?.payload);
  assertNoForbiddenKeys(stateWork?.payload);
  assertNoForbiddenKeys(unsafeStateId?.payload);
  assertNoForbiddenKeys(memoryInjected?.payload);
  assertNoForbiddenKeys(memorySkipped?.payload);
  assertNoForbiddenKeys(searchCited?.payload);
  assertNoForbiddenKeys(proactiveBubbleVisible?.payload);
  assertNoForbiddenKeys(unsafeAction?.payload);
});

test("performance telemetry keeps presence budget mode only as safe enum", () => {
  const event = parsePetRendererTelemetryEvent({
    type: "pet_performance_sample",
    payload: {
      mode: "idle",
      presenceModeId: "sleep",
      targetFramesPerSecond: 12,
      rafCallbacks: 300,
      renderedFramesPerSecond: 12,
      prompt: "sentinel",
      request: { body: "sentinel" }
    }
  });

  assert.deepEqual(event, {
    type: "pet_performance_sample",
    payload: {
      mode: "idle",
      presenceModeId: "sleep",
      targetFramesPerSecond: 12,
      rafCallbacks: 300,
      renderedFramesPerSecond: 12
    }
  });
  assertNoForbiddenKeys(event?.payload);
});

test("pet window motion feedback keeps only safe feedback summary fields", () => {
  const event = parsePetRendererTelemetryEvent({
    type: "pet_window_motion_feedback",
    payload: {
      eventType: "window_shake_candidate",
      reason: "window_shake_feedback",
      feedbackType: "shake_light_feedback",
      result: "started",
      cooldownState: "available",
      durationMs: 1400,
      rawMouseTrajectory: [{ x: 1, y: 2 }, { x: 4, y: 8 }],
      windowBounds: [{ x: 0, y: 0, width: 420, height: 600 }],
      foregroundApp: "private app",
      windowTitle: "private title"
    }
  });

  assert.deepEqual(event, {
    type: "pet_window_motion_feedback",
    payload: {
      eventType: "window_shake_candidate",
      reason: "window_shake_feedback",
      feedbackType: "shake_light_feedback",
      result: "started",
      cooldownState: "available",
      durationMs: 1400
    }
  });
  assertNoForbiddenKeys(event?.payload);
});

test("health and recovery telemetry drop text bodies and unsafe context", () => {
  const health = sanitizePetTelemetryEvent({
    type: "pet_health",
    payload: {
      renderer: "live2d",
      framesPerSecond: 60,
      isContextLost: false,
      canvasWidth: 420,
      canvasHeight: 600,
      rendererTimestamp: 123456,
      message: "C:\\private\\model.json failed",
      path: "C:\\private\\model.json"
    }
  });
  const recoveryFailed = parsePetRendererTelemetryEvent({
    type: "recovery_failed",
    payload: {
      source: "webgl_context_restored",
      renderer: "placeholder",
      recoveryCount: 2,
      message: "sentinel",
      response: "sentinel"
    }
  });

  assert.deepEqual(health, {
    type: "pet_health",
    payload: {
      renderer: "live2d",
      framesPerSecond: 60,
      isContextLost: false,
      canvasWidth: 420,
      canvasHeight: 600,
      rendererTimestamp: 123456
    }
  });
  assert.deepEqual(recoveryFailed, {
    type: "recovery_failed",
    payload: {
      source: "webgl_context_restored",
      renderer: "placeholder",
      recoveryCount: 2
    }
  });
  assertNoForbiddenKeys(health.payload);
  assertNoForbiddenKeys(recoveryFailed?.payload);
});

test("presentation telemetry lists every safe retained field", () => {
  const event = parsePetRendererTelemetryEvent({
    type: "pet_presentation_intent_applied",
    payload: {
      state: "thinking",
      requestVersion: 7,
      emotion: "happy",
      intensity: "medium",
      mode: "micro",
      recovery: "safe-neutral",
      allowMicroExpression: true,
      allowEmphasisExpression: false,
      prompt: "sentinel",
      content: "sentinel"
    }
  });

  assert.deepEqual(event, {
    type: "pet_presentation_intent_applied",
    payload: {
      state: "thinking",
      requestVersion: 7,
      emotion: "happy",
      intensity: "medium",
      mode: "micro",
      recovery: "safe-neutral",
      allowMicroExpression: true,
      allowEmphasisExpression: false
    }
  });
  assertNoForbiddenKeys(event?.payload);
});

test("main pet telemetry path uses the shared contract parser and sanitizer", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");

  assert.match(source, /parsePetRendererTelemetryEvent/);
  assert.match(source, /sanitizePetTelemetryEvent/);
  assert.doesNotMatch(source, /RENDERER_TELEMETRY_TYPES/);
  assert.doesNotMatch(source, /function sanitizeRendererTelemetry/);
  assert.doesNotMatch(source, /console\.info\("\[pet\] health", state\)/);
});
