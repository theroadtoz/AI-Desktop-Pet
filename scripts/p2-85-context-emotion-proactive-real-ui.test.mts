import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  P2_85_SCENARIO_IDS,
  P2_85_EVIDENCE_BOUNDARY_SUMMARY,
  P2_85_RENDER_MODES,
  P2_85_RUNTIME_BOUNDARIES,
  REQUIRED_ACCEPTANCE_HOOKS,
  assertSafeP285Observation,
  assertSafeP285AcceptanceTelemetryEvent,
  createP285FailureDiagnostics,
  getP285AcceptanceEnvironment,
  getP285ElectronArgs,
  inspectP285AcceptanceHooks,
  readP285SafeRejection,
  resolveP285RenderMode,
  runP285WithCleanup,
  selectP285EvidenceEvents,
  validateScenarioObservation
} from "./p2-85-context-emotion-proactive-real-ui.mjs";

const source = readFileSync("scripts/p2-85-context-emotion-proactive-real-ui.mjs", "utf8");
const runId = "123e4567-e89b-42d3-a456-426614174000";
const evidence = (type, payload) => ({ runId, suite: "p2-85", type, payload });

test("P2-85 runner names only closed production scenarios and its evidence boundary", () => {
  assert.deepEqual(P2_85_SCENARIO_IDS, [
    "chat_opened_replace_active",
    "reply_visible_generic_once",
    "explicit_game_single_presentation",
    "proactive_suppress_single_defer"
  ]);
  assert.match(source, /production_electron/);
  assert.equal(P2_85_RUNTIME_BOUNDARIES.chat_opened_replace_active, "live_renderer_chain");
  assert.equal(P2_85_RUNTIME_BOUNDARIES.reply_visible_generic_once, "live_renderer_chain");
  assert.equal(P2_85_RUNTIME_BOUNDARIES.explicit_game_single_presentation, "live_global_p2_83a_fixture");
  assert.equal(P2_85_RUNTIME_BOUNDARIES.proactive_suppress_single_defer, "deterministic_main_module_contract");
  assert.match(P2_85_EVIDENCE_BOUNDARY_SUMMARY, /chat_opened_replace_active=live_renderer_chain/u);
  assert.match(P2_85_EVIDENCE_BOUNDARY_SUMMARY, /explicit_game_single_presentation=live_global_p2_83a_fixture/u);
  assert.match(P2_85_EVIDENCE_BOUNDARY_SUMMARY, /proactive_suppress_single_defer=deterministic_main_module_contract/u);
  assert.match(source, /AI_DESKTOP_PET_P2_83A_SAFE_INJECTION: "1"/u);
  assert.match(source, /not real OS media\/game, real model semantics, user affect understanding, or MCP evidence/);
  assert.doesNotMatch(source, /closed safe fixture only/u);
  assert.doesNotMatch(source, /logTelemetry\(\s*["']pet_interaction_action_/u);
  assert.match(source, /assertNoScreenshotResidue/);
  assert.match(source, /cleanupRealUiRun/);
  assert.match(source, /readAcceptanceEvidenceForContext\(context, "p2-85"\)/u);
  assert.match(source, /assertRealUiRunParentRemoved\(context\)/u);
  assert.doesNotMatch(source, /AI_DESKTOP_PET_ACCEPTANCE_EVIDENCE_(?:PATH|DIR|FILE)/u);
  assert.doesNotMatch(source, /Input\.dispatchMouseEvent|\.click\s*\(/);
});

test("P2-85 runner reports a safe startup failure category without serializing error messages", () => {
  assert.deepEqual(createP285FailureDiagnostics({
    stage: "pet_window",
    error: new TypeError(),
    electronStderr: "GPU process exited unexpectedly",
    renderMode: "disable-gpu"
  }), {
    stage: "pet_window",
    errorName: "TypeError",
    failureCode: "gpu_child_crash",
    renderMode: "disable-gpu"
  });
  assert.doesNotMatch(source, /error:\s*error instanceof Error \? error\.message/u);
});

test("P2-85 runner reads only a closed rejection reason for a known scenario", () => {
  assert.equal(readP285SafeRejection([evidence("p2_85_acceptance_rejection", {
    scenarioId: "reply_visible_generic_once", rejectionReason: "reply_dispatch_rejected"
  })], "reply_visible_generic_once"), "reply_dispatch_rejected");
  assert.equal(readP285SafeRejection([evidence("p2_85_acceptance_rejection", {
    scenarioId: "reply_visible_generic_once", rejectionReason: "private_detail"
  })], "reply_visible_generic_once"), null);
  assert.doesNotMatch(source, /rejectionReason:\s*error\.message/u);
});

test("P2-85 render mode is allowlisted and selects only closed Electron argument sets", () => {
  assert.deepEqual(P2_85_RENDER_MODES, ["swiftshader", "disable-gpu"]);
  assert.equal(resolveP285RenderMode("unknown"), "swiftshader");
  assert.deepEqual(getP285ElectronArgs("unknown"), ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]);
  assert.equal(resolveP285RenderMode("disable-gpu"), "disable-gpu");
  assert.deepEqual(getP285ElectronArgs("disable-gpu"), ["--disable-gpu", "--disable-gpu-compositing"]);
  assert.equal(createP285FailureDiagnostics({ stage: "pet_window", error: new Error(), renderMode: "unknown" }).renderMode, "swiftshader");
});

test("P2-85 disable-gpu runner enables the pre-ready acceleration fallback only for its closed acceptance child", () => {
  assert.equal(
    getP285AcceptanceEnvironment("disable-gpu").AI_DESKTOP_PET_P2_85_DISABLE_HARDWARE_ACCELERATION,
    "1"
  );
  assert.equal(
    getP285AcceptanceEnvironment("swiftshader").AI_DESKTOP_PET_P2_85_DISABLE_HARDWARE_ACCELERATION,
    undefined
  );
  assert.match(source, /env: getP285AcceptanceEnvironment\(renderMode\),/u);
  assert.match(source, /AI_DESKTOP_PET_P2_85_DISABLE_HARDWARE_ACCELERATION: undefined/u);
});

test("P2-85 runner fails closed until every triple-gated fixture hook exists", () => {
  const missing = inspectP285AcceptanceHooks({
    appSource: "const isAcceptanceTelemetryEnabled = true;",
    scenarioSource: "export type P285AcceptanceObservation = Readonly<{ scenarioId: string }>;",
    petPreloadSource: "",
    ipcContractSource: ""
  });
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missing, ["triple_gate", "trusted_pet_scenario_ipc", "safe_observation"]);
  assert.deepEqual(missing.requiredHooks, REQUIRED_ACCEPTANCE_HOOKS);

  const ready = inspectP285AcceptanceHooks({
    appSource: `
      const isAcceptanceTelemetryEnabled = process.env.AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY === "1";
      const safe = process.env.AI_DESKTOP_PET_P2_85_SAFE_OBSERVATION && process.env.AI_DESKTOP_PET_P2_85_SAFE_FIXTURE;
      const isP283aAcceptanceInjectionOnly = true;
      createP285AcceptanceScenarioController();
      p285AcceptanceScenarioController?.observeRendererActionLifecycle();
      p285AcceptanceScenarioController?.observeProactiveDecision();
      ipcMain.handle("pet:p2-85-run-scenario", (event) => isPetSender(event));
      ipcMain.handle("pet:p2-85-reset-baseline-and-run-scenario", (event) => isPetSender(event));
      runP285AcceptanceScenario("proactive_suppress_single_defer");
      p2_85_acceptance_observation;
    `,
    scenarioSource: `
      function runP285AcceptanceScenario() {}
      function createP285AcceptanceScenarioController() { return { resetBaseline() {} }; }
      type P285AcceptanceObservation = { scenarioId: string; actionAttempted: boolean };
      const observation: P285AcceptanceObservation = {
        scenarioId: "safe",
        runtimeBoundary: "deterministic_main_module_contract",
        actionAttempted: false
      };
    `,
    petPreloadSource: "runP285ScenarioForAcceptance() {} resetP285AcceptanceBaselineAndRunScenario() {}",
    ipcContractSource: "runP285ScenarioForAcceptance(): Promise<boolean>; resetP285AcceptanceBaselineAndRunScenario(): Promise<boolean>;"
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missing, []);

  const syntheticLifecycle = inspectP285AcceptanceHooks({
    appSource: `
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY AI_DESKTOP_PET_P2_85_SAFE_OBSERVATION AI_DESKTOP_PET_P2_85_SAFE_FIXTURE
      isP283aAcceptanceInjectionOnly p2_85_acceptance_observation createP285AcceptanceScenarioController
      p285AcceptanceScenarioController?.observeRendererActionLifecycle()
      p285AcceptanceScenarioController?.observeProactiveDecision()
      logTelemetry("pet_interaction_action_finished", {})`,
    scenarioSource: `function runP285AcceptanceScenario() {}
      function createP285AcceptanceScenarioController() { return { resetBaseline() {} }; }
      const observation = { scenarioId: "safe", runtimeBoundary: "deterministic_main_module_contract", actionAttempted: false };`,
    petPreloadSource: "runP285ScenarioForAcceptance() {} resetP285AcceptanceBaselineAndRunScenario() {}",
    ipcContractSource: "runP285ScenarioForAcceptance(): Promise<boolean>; resetP285AcceptanceBaselineAndRunScenario(): Promise<boolean>;"
  });
  assert.equal(syntheticLifecycle.ready, false);

  const missingScenarioSchema = inspectP285AcceptanceHooks({
    appSource: "AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY AI_DESKTOP_PET_P2_85_SAFE_OBSERVATION AI_DESKTOP_PET_P2_85_SAFE_FIXTURE isP283aAcceptanceInjectionOnly ipcMain.handle(\"pet:p2-85-run-scenario\", (event) => isPetSender(event)); ipcMain.handle(\"pet:p2-85-reset-baseline-and-run-scenario\", (event) => isPetSender(event)); p2_85_acceptance_observation; createP285AcceptanceScenarioController; p285AcceptanceScenarioController?.observeRendererActionLifecycle(); p285AcceptanceScenarioController?.observeProactiveDecision();",
    scenarioSource: "type P285AcceptanceObservation = { scenarioId: string };",
    petPreloadSource: "runP285ScenarioForAcceptance() {} resetP285AcceptanceBaselineAndRunScenario() {}",
    ipcContractSource: "runP285ScenarioForAcceptance(): Promise<boolean>; resetP285AcceptanceBaselineAndRunScenario(): Promise<boolean>;"
  });
  assert.equal(missingScenarioSchema.ready, false);
  assert.deepEqual(missingScenarioSchema.missing, ["safe_observation"]);
});

test("P2-86 runner accepts only exact P2-85 telemetry schemas and bounded lifecycle evidence", async () => {
  const requestId = "0123456789abcdef0123456789abcdef";
  const chatObservation = {
    scenarioId: "chat_opened_replace_active",
    runtimeBoundary: "live_renderer_chain",
    actionAttempted: true,
    requestId,
    replacedRequestId: "fedcba9876543210fedcba9876543210",
    replacementAccepted: true,
    lateLifecycleIgnored: true,
    terminalObserved: true
  };
  assert.deepEqual(assertSafeP285Observation(chatObservation), {
    ok: true,
    reason: null
  });
  for (const invalid of [
    { ...chatObservation, text: "private" },
    { ...chatObservation, debugMeta: {} },
    { ...chatObservation, requestId: "bad" }
  ]) {
    assert.deepEqual(assertSafeP285Observation(invalid), {
      ok: false,
      reason: "p2_85_telemetry_schema_invalid"
    });
  }
  const replyObservation = {
    scenarioId: "reply_visible_generic_once",
    runtimeBoundary: "live_renderer_chain",
    actionAttempted: true,
    requestId,
    terminalObserved: true,
    affectActionAttempted: false,
    genericReplyActionAttempted: true,
    actionRequestCount: 1,
    streamCompleted: true
  };
  assert.equal(assertSafeP285Observation({ ...replyObservation, actionRequestCount: Number.NaN }).ok, false);
  assert.equal(assertSafeP285Observation({ ...replyObservation, actionRequestCount: Number.POSITIVE_INFINITY }).ok, false);
  assert.equal(assertSafeP285Observation({
    scenarioId: "explicit_game_single_presentation",
    runtimeBoundary: "live_global_p2_83a_fixture",
    actionAttempted: false,
    proactiveCandidateId: "explicit_game_started",
    proactiveCandidateCount: 1,
    proactiveCandidateOutcome: "untrusted",
    automaticModeActionCount: 0
  }).ok, false);
  assert.deepEqual(assertSafeP285AcceptanceTelemetryEvent(
    evidence("p2_85_acceptance_observation", chatObservation)
  ), { ok: true, reason: null });
  assert.deepEqual(assertSafeP285AcceptanceTelemetryEvent(
    evidence("p2_85_unknown", {})
  ), { ok: false, reason: "p2_85_telemetry_schema_invalid" });
  assert.deepEqual(assertSafeP285AcceptanceTelemetryEvent(
    evidence("unrelated_event", { text: "private" })
  ), { ok: false, reason: "p2_85_telemetry_schema_invalid" });
  const selection = selectP285EvidenceEvents([
    evidence("pet_interaction_action_finished", {
      actionType: "softSmile", reason: "state_idle", requestId, terminalStatus: "completed"
    }),
    evidence("p2_85_acceptance_observation", chatObservation)
  ]);
  assert.equal(selection.ok, true);
  assert.deepEqual(selection.events.map((event) => event.type), [
    "pet_interaction_action_finished",
    "p2_85_acceptance_observation"
  ]);
  assert.equal(selectP285EvidenceEvents([evidence("p2_85_unknown", {})]).ok, false);

  const lifecycle = [evidence("pet_interaction_action_finished", {
    actionType: "softSmile", reason: "state_idle", requestId, terminalStatus: "completed"
  })];
  assert.equal(validateScenarioObservation("chat_opened_replace_active", {
    scenarioId: "chat_opened_replace_active",
    requestId,
    replacedRequestId: "fedcba9876543210fedcba9876543210",
    runtimeBoundary: "live_renderer_chain",
    actionAttempted: true,
    replacementAccepted: true,
    lateLifecycleIgnored: true,
    terminalObserved: true
  }, lifecycle).ok, true);
  assert.equal(validateScenarioObservation("reply_visible_generic_once", {
    scenarioId: "reply_visible_generic_once",
    requestId,
    runtimeBoundary: "live_renderer_chain",
    actionAttempted: true,
    terminalObserved: true,
    affectActionAttempted: false,
    genericReplyActionAttempted: true,
    actionRequestCount: 1,
    streamCompleted: true
  }, lifecycle).ok, true);
  assert.equal(validateScenarioObservation("explicit_game_single_presentation", {
    scenarioId: "explicit_game_single_presentation",
    runtimeBoundary: "live_global_p2_83a_fixture",
    actionAttempted: false,
    proactiveCandidateId: "explicit_game_started",
    proactiveCandidateCount: 1,
    proactiveCandidateOutcome: "shown",
    automaticModeActionCount: 0
  }, []).ok, true);
  assert.equal(validateScenarioObservation("proactive_suppress_single_defer", {
    scenarioId: "proactive_suppress_single_defer",
    runtimeBoundary: "deterministic_main_module_contract",
    actionAttempted: false,
    suppressedTerminal: true,
    deferredOnce: true,
    deferredReplayed: false,
    ttlExtended: false,
    deferQueuedAtMs: 1000,
    originalExpiresAtMs: 2000,
    firstBeyondOriginalTtlTickAtMs: 2001,
    terminalAtMs: 2001,
    tickCount: 4
  }, []).ok, true);
  assert.equal(validateScenarioObservation("reply_visible_generic_once", {
    scenarioId: "reply_visible_generic_once",
    requestId,
    runtimeBoundary: "live_global_p2_83a_fixture",
    actionAttempted: true,
    terminalObserved: true,
    affectActionAttempted: false,
    genericReplyActionAttempted: true,
    actionRequestCount: 1,
    streamCompleted: true
  }, lifecycle).ok, false);
  assert.equal(validateScenarioObservation("reply_visible_generic_once", {
    scenarioId: "reply_visible_generic_once",
    requestId,
    runtimeBoundary: "live_renderer_chain",
    actionAttempted: true,
    affectActionAttempted: false,
    genericReplyActionAttempted: true,
    actionRequestCount: 1,
    streamCompleted: true
  }, lifecycle).ok, false);
  assert.equal(validateScenarioObservation("reply_visible_generic_once", {
    scenarioId: "reply_visible_generic_once",
    requestId,
    runtimeBoundary: "live_renderer_chain",
    actionAttempted: true,
    terminalObserved: true,
    affectActionAttempted: false,
    genericReplyActionAttempted: true,
    actionRequestCount: 1,
    streamCompleted: true
  }, [...lifecycle, lifecycle[0]]).ok, false);

  const primaryFailure = new Error("primary");
  await assert.rejects(runP285WithCleanup(
    async () => { throw primaryFailure; },
    async () => { throw new Error("cleanup"); }
  ), (error: Error & { p285CleanupFailureDiagnostics?: unknown }) =>
    error === primaryFailure && Boolean(error.p285CleanupFailureDiagnostics));

  for (const primary of ["primary-string", undefined, null, Object.freeze(new Error("primary-frozen"))]) {
    const errorName = primary instanceof Error ? primary.name : typeof primary;
    await assert.rejects(runP285WithCleanup(
      async () => { throw primary; },
      async () => { throw new Error("cleanup"); }
    ), (error: Error & {
      p285PrimaryFailureDiagnostics?: { errorName?: string };
      p285CleanupFailureDiagnostics?: unknown;
    }) => error.message === "p2_85_cleanup_failed_after_primary" &&
      error.p285PrimaryFailureDiagnostics?.errorName === errorName &&
      Boolean(error.p285CleanupFailureDiagnostics));
  }
});
