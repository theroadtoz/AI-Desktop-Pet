import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createP285AcceptanceScenarioController,
  isP285AcceptanceObservation,
  isP285AcceptanceRejectionReason,
  runP285AcceptanceScenario
} = require(
  "../dist/main/services/companion-context/p2-85-acceptance-scenarios.js"
) as typeof import("../src/main/services/companion-context/p2-85-acceptance-scenarios");
const { validateScenarioObservation } = await import("./p2-85-context-emotion-proactive-real-ui.mjs");
const scenarioSource = readFileSync(
  "src/main/services/companion-context/p2-85-acceptance-scenarios.ts",
  "utf8"
);

const liveScenarioIds = [
  "chat_opened_replace_active",
  "reply_visible_generic_once",
  "explicit_game_single_presentation"
] as const;

const forbiddenKey = /(?:^|_)(?:text|body|content|prompt|raw|raw_snapshot|raw_environment|environment_snapshot|window|window_title|process|process_name|path|url|query|kind|affect_kind|emotion_kind)(?:$|_)/iu;

function assertNoForbiddenFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenFields(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.replace(/([a-z])([A-Z])/gu, "$1_$2").toLowerCase();
    assert.equal(forbiddenKey.test(normalizedKey), false, `forbidden observation key: ${key}`);
    assertNoForbiddenFields(nested);
  }
}

test("P2-85 module refuses scenarios that require live app coordinators or renderer", () => {
  for (const scenarioId of liveScenarioIds) {
    assert.throws(
      () => runP285AcceptanceScenario(scenarioId),
      /p2_85_live_scenario_requires_app_runtime/u
    );
  }
});

test("P2-85 deterministic module advances beyond the original TTL and derives one defer", () => {
  const result = runP285AcceptanceScenario("proactive_suppress_single_defer");
  const observation = result.observation;

  assert.deepEqual(Object.keys(result), ["observation"]);
  assert.equal(observation.runtimeBoundary, "deterministic_main_module_contract");
  assert.equal(observation.suppressedTerminal, true);
  assert.equal(observation.deferredOnce, true);
  assert.equal(observation.deferredReplayed, false);
  assert.equal(
    observation.ttlExtended,
    (observation.terminalAtMs ?? Number.POSITIVE_INFINITY) >
      (observation.firstBeyondOriginalTtlTickAtMs ?? Number.POSITIVE_INFINITY)
  );
  assert.equal(observation.actionAttempted, false);
  assert.ok((observation.tickCount ?? 0) >= 4);
  assert.ok((observation.originalExpiresAtMs ?? 0) > (observation.deferQueuedAtMs ?? 0));
  assert.ok(
    (observation.firstBeyondOriginalTtlTickAtMs ?? 0) >
      (observation.originalExpiresAtMs ?? Number.POSITIVE_INFINITY)
  );
  assert.equal(observation.terminalAtMs, observation.firstBeyondOriginalTtlTickAtMs);
  assert.deepEqual(validateScenarioObservation(
    "proactive_suppress_single_defer",
    observation,
    []
  ), {
    ok: true,
    reason: null
  });
  assertNoForbiddenFields(result);
});

test("P2-85 controller admits two complete scenario rounds only when each baseline closes live state", async () => {
  let active: { requestId: string; reason: string } | null = null;
  let requestSequence = 0;
  let baselineResetCount = 0;
  const observations: unknown[] = [];
  const nextRequest = (reason: string) => {
    requestSequence += 1;
    return { requestId: requestSequence.toString(16).padStart(32, "0"), reason };
  };
  const controller = createP285AcceptanceScenarioController({
    dispatchAction(reason: string) {
      if (active) return { accepted: false, reason: "busy" };
      active = nextRequest(reason);
      return { accepted: true, requestId: active.requestId };
    },
    cancelAction() {
      active = null;
    },
    getActiveMainRequest() {
      return active;
    },
    openChatWindow() {
      active = nextRequest("chat_opened");
    },
    async resetLiveBaseline() {
      baselineResetCount += 1;
      active = null;
      return true;
    },
    clearProactiveCandidate() {},
    queueExplicitGameCandidate() {},
    resolveArbitration(input: { channel: string }) {
      return {
        decision: input.channel === "affect-action" ? "suppress" : "allow",
        reason: "allowed",
        replay: "never",
        actionIntent: "none",
        priority: 0
      };
    },
    reportObservation(observation: unknown) {
      observations.push(observation);
    }
  });

  for (let round = 0; round < 2; round += 1) {
    for (const scenarioId of [...liveScenarioIds, "proactive_suppress_single_defer"] as const) {
      assert.equal((await controller.resetBaseline()).accepted, true);
      assert.equal(controller.runScenario(scenarioId).accepted, true);
      if (scenarioId === "chat_opened_replace_active") {
        const replacement = active;
        assert.ok(replacement);
        const replacedRequestId = (requestSequence - 1).toString(16).padStart(32, "0");
        controller.observeRendererActionLifecycle("skipped", "state_listen", replacedRequestId, "ignored");
        controller.observeRendererActionLifecycle("finished", "chat_opened", replacement.requestId, "main_terminal");
      } else if (scenarioId === "reply_visible_generic_once") {
        assert.ok(active);
        controller.observeRendererActionLifecycle("finished", "chat_reply_completed", active.requestId, "main_terminal");
      } else if (scenarioId === "explicit_game_single_presentation") {
        controller.observeProactiveDecision({ candidateId: "explicit_game_started", state: "queued" });
        controller.observeProactiveDecision({ candidateId: "explicit_game_started", state: "skipped" });
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }

  assert.equal(baselineResetCount, 8);
  assert.equal(observations.length, 8);
  controller.dispose();
});

test("P2-85 baseline acknowledgement blocks scenarios until the close-and-recheck adapter resolves", async () => {
  let resolveBaseline: ((value: boolean) => void) | undefined;
  const controller = createP285AcceptanceScenarioController({
    dispatchAction() {
      return { accepted: true, requestId: "00000000000000000000000000000001" };
    },
    cancelAction() {},
    getActiveMainRequest() {
      return null;
    },
    openChatWindow() {},
    resetLiveBaseline() {
      return new Promise<boolean>((resolve) => {
        resolveBaseline = resolve;
      });
    },
    clearProactiveCandidate() {},
    queueExplicitGameCandidate() {},
    resolveArbitration() {
      return { decision: "allow", reason: "allowed", replay: "never", actionIntent: "none", priority: 0 };
    },
    reportObservation() {}
  });

  const reset = controller.resetBaseline();
  assert.deepEqual(controller.runScenario("reply_visible_generic_once"), {
    accepted: false,
    rejectionReason: "baseline_pending"
  });
  assert.ok(resolveBaseline);
  resolveBaseline(true);
  assert.deepEqual(await reset, { accepted: true, rejectionReason: null });
  controller.dispose();
});

test("P2-86 atomic baseline-and-scenario operation dispatches without a renderer IPC gap", async () => {
  let resolveBaseline: ((value: boolean) => void) | undefined;
  let active = false;
  const executionOrder: string[] = [];
  const controller = createP285AcceptanceScenarioController({
    dispatchAction() {
      executionOrder.push("dispatch");
      if (active) return { accepted: false, reason: "busy" };
      active = true;
      return { accepted: true, requestId: "00000000000000000000000000000001" };
    },
    cancelAction() {
      active = false;
    },
    getActiveMainRequest() {
      return null;
    },
    openChatWindow() {},
    resetLiveBaseline() {
      executionOrder.push("reset");
      return new Promise<boolean>((resolve) => {
        resolveBaseline = resolve;
      });
    },
    clearProactiveCandidate() {},
    queueExplicitGameCandidate() {},
    resolveArbitration(input: { channel: string }) {
      return {
        decision: input.channel === "affect-action" ? "suppress" : "allow",
        reason: "allowed",
        replay: "never",
        actionIntent: "none",
        priority: 0
      };
    },
    reportObservation() {}
  });

  const operation = controller.resetBaselineAndRunScenario("reply_visible_generic_once");
  assert.deepEqual(controller.runScenario("reply_visible_generic_once"), {
    accepted: false,
    rejectionReason: "baseline_pending"
  });
  assert.ok(resolveBaseline);
  resolveBaseline(true);
  assert.deepEqual(await operation, { accepted: true, rejectionReason: null });
  assert.deepEqual(executionOrder, ["reset", "dispatch"]);
  assert.deepEqual(controller.runScenario("reply_visible_generic_once"), {
    accepted: false,
    rejectionReason: "pending_observation"
  });
  controller.dispose();
});

test("P2-86 baseline failures are closed and always release the pending gate", async () => {
  let cancelThrows = true;
  const controller = createP285AcceptanceScenarioController({
    dispatchAction() {
      return { accepted: true, requestId: "00000000000000000000000000000001" };
    },
    cancelAction() {
      if (cancelThrows) throw new Error("private cancel failure");
    },
    getActiveMainRequest() {
      return null;
    },
    openChatWindow() {},
    async resetLiveBaseline() {
      throw new Error("private adapter failure");
    },
    clearProactiveCandidate() {},
    queueExplicitGameCandidate() {},
    resolveArbitration(input: { channel: string }) {
      return { decision: input.channel === "affect-action" ? "suppress" : "allow", reason: "allowed", replay: "never", actionIntent: "none", priority: 0 };
    },
    reportObservation() {}
  });

  assert.equal(controller.runScenario("reply_visible_generic_once").accepted, true);
  assert.deepEqual(await controller.resetBaseline(), {
    accepted: false,
    rejectionReason: "baseline_reset_failed"
  });
  cancelThrows = false;
  assert.equal(controller.runScenario("reply_visible_generic_once").accepted, true);
  assert.deepEqual(await controller.resetBaseline(), {
    accepted: false,
    rejectionReason: "baseline_reset_failed"
  });
  assert.equal(controller.runScenario("reply_visible_generic_once").accepted, true);
  controller.dispose();
});

test("P2-86 acceptance telemetry guards accept only exact P2-85 payload schemas", () => {
  const chatObservation = {
    scenarioId: "chat_opened_replace_active",
    runtimeBoundary: "live_renderer_chain",
    actionAttempted: true,
    requestId: "00000000000000000000000000000001",
    replacedRequestId: "00000000000000000000000000000002",
    replacementAccepted: true,
    lateLifecycleIgnored: true,
    terminalObserved: true
  };
  assert.equal(isP285AcceptanceObservation(chatObservation), true);
  assert.equal(isP285AcceptanceObservation({ ...chatObservation, debugMeta: {} }), false);
  assert.equal(isP285AcceptanceObservation({ ...chatObservation, requestId: "not-a-request-id" }), false);
  assert.equal(isP285AcceptanceObservation({ ...chatObservation, actionRequestCount: Number.NaN }), false);
  assert.equal(isP285AcceptanceRejectionReason("baseline_reset_failed"), true);
  assert.equal(isP285AcceptanceRejectionReason("private failure"), false);
});

test("P2-85 scenario rejections stay in the closed safe reason set", () => {
  const controller = createP285AcceptanceScenarioController({
    dispatchAction() {
      return { accepted: false, reason: "busy" };
    },
    cancelAction() {},
    getActiveMainRequest() {
      return null;
    },
    openChatWindow() {},
    async resetLiveBaseline() {
      return false;
    },
    clearProactiveCandidate() {},
    queueExplicitGameCandidate() {},
    resolveArbitration(input: { channel: string }) {
      return {
        decision: input.channel === "affect-action" ? "suppress" : "allow",
        reason: "allowed",
        replay: "never",
        actionIntent: "none",
        priority: 0
      };
    },
    reportObservation() {}
  });

  assert.deepEqual(controller.runScenario("reply_visible_generic_once"), {
    accepted: false,
    rejectionReason: "reply_dispatch_rejected"
  });
  controller.dispose();
});

test("P2-85 module cannot reintroduce the reviewed false-pass patterns", () => {
  assert.doesNotMatch(scenarioSource, /new Set\s*\(/u);
  assert.doesNotMatch(scenarioSource, /ttlExtended\s*:\s*false/u);
  assert.doesNotMatch(scenarioSource, /terminalEvent/u);
  assert.doesNotMatch(scenarioSource, /lifecycleEvents/u);
  assert.doesNotMatch(scenarioSource, /logTelemetry\(/u);
  assert.doesNotMatch(scenarioSource, /createPetActionDispatchCoordinator/u);
  assert.match(scenarioSource, /tickAt\(originalExpiresAtMs \+ 1\)/u);
  assert.match(scenarioSource, /explicitTerminal\.atMs > firstBeyondOriginalTtlTickAtMs/u);
  assert.match(scenarioSource, /async resetBaselineAndRunScenario\(scenarioId\)/u);
  const atomicStart = scenarioSource.indexOf("async resetBaselineAndRunScenario(scenarioId)");
  const atomicEnd = scenarioSource.indexOf("observeRendererActionLifecycle", atomicStart);
  const atomicOperation = scenarioSource.slice(atomicStart, atomicEnd);
  assert.match(atomicOperation, /await resetBaseline\(\)/u);
  assert.match(atomicOperation, /runScenario\(scenarioId\)/u);
  assert.doesNotMatch(atomicOperation, /setTimeout|retry|sleep/u);
});
