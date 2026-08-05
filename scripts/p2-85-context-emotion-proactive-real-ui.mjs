import {
  assertNoScreenshotResidue,
  assertRealUiRunParentRemoved,
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  readAcceptanceEvidenceForContext,
  sleep,
  startElectron,
  waitFor,
  waitForChildExit,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const APP_PATH = join(ROOT, "src", "main", "app.ts");
const ACCEPTANCE_SCENARIOS_PATH = join(ROOT, "src", "main", "services", "companion-context", "p2-85-acceptance-scenarios.ts");
const PET_PRELOAD_PATH = join(ROOT, "src", "preload", "pet-preload.ts");
const IPC_CONTRACT_PATH = join(ROOT, "src", "shared", "ipc-contract.ts");
const RUNNER_TIMEOUT_MS = Math.min(120_000, Math.max(45_000, Number(process.env.P2_85_TOTAL_TIMEOUT_MS || 90_000)));
const P2_85_ELECTRON_ARGS = Object.freeze({
  swiftshader: Object.freeze(["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
  "disable-gpu": Object.freeze(["--disable-gpu", "--disable-gpu-compositing"])
});

export const P2_85_RENDER_MODES = Object.freeze(["swiftshader", "disable-gpu"]);

export function resolveP285RenderMode(value = process.env.P2_85_RENDER_MODE) {
  return value === "disable-gpu" ? "disable-gpu" : "swiftshader";
}

export function getP285ElectronArgs(renderMode = resolveP285RenderMode()) {
  return [...P2_85_ELECTRON_ARGS[resolveP285RenderMode(renderMode)]];
}

export function getP285AcceptanceEnvironment(renderMode = resolveP285RenderMode()) {
  const environment = {
    AI_DESKTOP_PET_PROVIDER: "fake",
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
    AI_DESKTOP_PET_P2_83A_SAFE_INJECTION: "1",
    AI_DESKTOP_PET_P2_85_SAFE_OBSERVATION: "1",
    AI_DESKTOP_PET_P2_85_SAFE_FIXTURE: "1",
    AI_DESKTOP_PET_P2_85_DISABLE_HARDWARE_ACCELERATION: undefined
  };
  if (resolveP285RenderMode(renderMode) === "disable-gpu") {
    environment.AI_DESKTOP_PET_P2_85_DISABLE_HARDWARE_ACCELERATION = "1";
  }
  return environment;
}

export const P2_85_SCENARIO_IDS = Object.freeze([
  "chat_opened_replace_active",
  "reply_visible_generic_once",
  "explicit_game_single_presentation",
  "proactive_suppress_single_defer"
]);

export const P2_85_RUNTIME_BOUNDARIES = Object.freeze({
  chat_opened_replace_active: "live_renderer_chain",
  reply_visible_generic_once: "live_renderer_chain",
  explicit_game_single_presentation: "live_global_p2_83a_fixture",
  proactive_suppress_single_defer: "deterministic_main_module_contract"
});

export const P2_85_EVIDENCE_BOUNDARY_SUMMARY = [
  "scenario runtime boundaries:",
  "chat_opened_replace_active=live_renderer_chain,",
  "reply_visible_generic_once=live_renderer_chain,",
  "explicit_game_single_presentation=live_global_p2_83a_fixture,",
  "proactive_suppress_single_defer=deterministic_main_module_contract;",
  "acceptance-only safe injection;",
  "not real OS media/game, real model semantics, user affect understanding, or MCP evidence"
].join(" ");

export const REQUIRED_ACCEPTANCE_HOOKS = Object.freeze([
  Object.freeze({
    id: "triple_gate",
    description: "main-only P2-85 fixture requires telemetry, safe observation, and safe fixture flags",
    files: Object.freeze(["src/main/app.ts"])
  }),
  Object.freeze({
    id: "trusted_pet_scenario_ipc",
    description: "trusted pet-only fixed scenario IPC rejects arbitrary payloads",
    files: Object.freeze(["src/main/app.ts", "src/preload/pet-preload.ts", "src/shared/ipc-contract.ts"])
  }),
  Object.freeze({
    id: "safe_observation",
    description: "main live start/observer hooks and deterministic scenario module record bounded outcomes",
    files: Object.freeze([
      "src/main/app.ts",
      "src/main/services/companion-context/p2-85-acceptance-scenarios.ts"
    ])
  })
]);

const SAFE_REQUEST_ID = /^[a-f0-9]{32}$/u;
const P2_85_ACCEPTANCE_REJECTION_REASONS = new Set([
  "pending_observation",
  "baseline_pending",
  "baseline_not_closed",
  "baseline_reset_failed",
  "state_listen_rejected",
  "chat_open_failed",
  "chat_open_replacement_missing",
  "affect_not_suppressed",
  "reply_not_allowed",
  "reply_dispatch_rejected",
  "explicit_game_fixture_disabled",
  "controller_unavailable",
  "controller_threw"
]);
const P2_85_PROACTIVE_CANDIDATE_STATES = new Set(["queued", "attempted", "shown", "skipped", "expired"]);
const P2_85_SHARED_LIFECYCLE_EVENT_TYPES = new Set([
  "pet_interaction_action_started",
  "pet_interaction_action_finished",
  "pet_interaction_action_skipped"
]);

function schemaInvalid() {
  return { ok: false, reason: "p2_85_telemetry_schema_invalid" };
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isFiniteNonNegativeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBoolean(value) {
  return typeof value === "boolean";
}

const SAFE_RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function inspectP285AcceptanceHooks({ appSource, scenarioSource, petPreloadSource, ipcContractSource }) {
  const missing = [];
  const hasTripleGate = /AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY/u.test(appSource) &&
    /AI_DESKTOP_PET_P2_85_SAFE_OBSERVATION/u.test(appSource) &&
    /AI_DESKTOP_PET_P2_85_SAFE_FIXTURE/u.test(appSource);
  if (!hasTripleGate) missing.push("triple_gate");

  const hasTrustedScenarioHandler = /ipcMain\.handle\(\s*["']pet:p2-85-run-scenario["']/u.test(appSource) &&
    /ipcMain\.handle\(\s*["']pet:p2-85-reset-baseline-and-run-scenario["']/u.test(appSource) &&
    /isPetSender\(event\)/u.test(appSource) &&
    /AI_DESKTOP_PET_P2_85_SAFE_FIXTURE/u.test(appSource);
  const hasPreloadBridge = /runP285ScenarioForAcceptance/u.test(petPreloadSource) &&
    /resetP285AcceptanceBaselineAndRunScenario/u.test(petPreloadSource);
  const hasTypedBridge = /runP285ScenarioForAcceptance/u.test(ipcContractSource) &&
    /resetP285AcceptanceBaselineAndRunScenario/u.test(ipcContractSource);
  if (!hasTrustedScenarioHandler || !hasPreloadBridge || !hasTypedBridge) {
    missing.push("trusted_pet_scenario_ipc");
  }

  const hasSafeObservation = /p2_85_acceptance_observation/u.test(appSource) &&
    /createP285AcceptanceScenarioController/u.test(appSource) &&
    /p285AcceptanceScenarioController\?\.observeRendererActionLifecycle/u.test(appSource) &&
    /p285AcceptanceScenarioController\?\.observeProactiveDecision/u.test(appSource) &&
    /isP283aAcceptanceInjectionOnly/u.test(appSource) &&
    /createP285AcceptanceScenarioController\s*\(/u.test(scenarioSource ?? "") &&
    /resetBaseline\(\)/u.test(scenarioSource ?? "") &&
    /function\s+runP285AcceptanceScenario\s*\(/u.test(scenarioSource ?? "") &&
    /runtimeBoundary:\s*["']deterministic_main_module_contract["']/u.test(scenarioSource ?? "") &&
    /scenarioId/u.test(scenarioSource ?? "") && /actionAttempted/u.test(scenarioSource ?? "") &&
    !/logTelemetry\(\s*["']pet_interaction_action_(?:started|finished|skipped)["']/u.test(appSource);
  if (!hasSafeObservation) missing.push("safe_observation");

  return {
    ready: missing.length === 0,
    missing,
    requiredHooks: REQUIRED_ACCEPTANCE_HOOKS.filter((item) => missing.includes(item.id))
  };
}

export function assertSafeP285Observation(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return schemaInvalid();
  }
  if (payload.scenarioId === "chat_opened_replace_active") {
    return hasExactKeys(payload, [
      "scenarioId", "runtimeBoundary", "actionAttempted", "requestId", "replacedRequestId",
      "replacementAccepted", "lateLifecycleIgnored", "terminalObserved"
    ]) && payload.runtimeBoundary === "live_renderer_chain" && isBoolean(payload.actionAttempted) &&
      SAFE_REQUEST_ID.test(payload.requestId) && SAFE_REQUEST_ID.test(payload.replacedRequestId) &&
      isBoolean(payload.replacementAccepted) && isBoolean(payload.lateLifecycleIgnored) &&
      isBoolean(payload.terminalObserved)
      ? { ok: true, reason: null }
      : schemaInvalid();
  }
  if (payload.scenarioId === "reply_visible_generic_once") {
    return hasExactKeys(payload, [
      "scenarioId", "runtimeBoundary", "actionAttempted", "requestId", "terminalObserved",
      "affectActionAttempted", "genericReplyActionAttempted", "actionRequestCount", "streamCompleted"
    ]) && payload.runtimeBoundary === "live_renderer_chain" && isBoolean(payload.actionAttempted) &&
      SAFE_REQUEST_ID.test(payload.requestId) && isBoolean(payload.terminalObserved) &&
      isBoolean(payload.affectActionAttempted) && isBoolean(payload.genericReplyActionAttempted) &&
      isFiniteNonNegativeInteger(payload.actionRequestCount) && isBoolean(payload.streamCompleted)
      ? { ok: true, reason: null }
      : schemaInvalid();
  }
  if (payload.scenarioId === "explicit_game_single_presentation") {
    return hasExactKeys(payload, [
      "scenarioId", "runtimeBoundary", "actionAttempted", "proactiveCandidateId", "proactiveCandidateCount",
      "proactiveCandidateOutcome", "automaticModeActionCount"
    ]) && payload.runtimeBoundary === "live_global_p2_83a_fixture" && isBoolean(payload.actionAttempted) &&
      payload.proactiveCandidateId === "explicit_game_started" &&
      isFiniteNonNegativeInteger(payload.proactiveCandidateCount) &&
      P2_85_PROACTIVE_CANDIDATE_STATES.has(payload.proactiveCandidateOutcome) &&
      isFiniteNonNegativeInteger(payload.automaticModeActionCount)
      ? { ok: true, reason: null }
      : schemaInvalid();
  }
  if (payload.scenarioId !== "proactive_suppress_single_defer") return schemaInvalid();
  const hasTerminalAt = Object.hasOwn(payload, "terminalAtMs");
  const keys = hasTerminalAt
    ? [
        "scenarioId", "runtimeBoundary", "actionAttempted", "suppressedTerminal", "deferredOnce",
        "deferredReplayed", "ttlExtended", "deferQueuedAtMs", "originalExpiresAtMs",
        "firstBeyondOriginalTtlTickAtMs", "terminalAtMs", "tickCount"
      ]
    : [
        "scenarioId", "runtimeBoundary", "actionAttempted", "suppressedTerminal", "deferredOnce",
        "deferredReplayed", "ttlExtended", "deferQueuedAtMs", "originalExpiresAtMs",
        "firstBeyondOriginalTtlTickAtMs", "tickCount"
      ];
  return hasExactKeys(payload, keys) && payload.runtimeBoundary === "deterministic_main_module_contract" &&
    isBoolean(payload.actionAttempted) && isBoolean(payload.suppressedTerminal) &&
    isBoolean(payload.deferredOnce) && isBoolean(payload.deferredReplayed) && isBoolean(payload.ttlExtended) &&
    isFiniteNonNegativeInteger(payload.deferQueuedAtMs) && isFiniteNonNegativeInteger(payload.originalExpiresAtMs) &&
    isFiniteNonNegativeInteger(payload.firstBeyondOriginalTtlTickAtMs) &&
    (!hasTerminalAt || isFiniteNonNegativeInteger(payload.terminalAtMs)) &&
    isFiniteNonNegativeInteger(payload.tickCount)
    ? { ok: true, reason: null }
    : schemaInvalid();
}

export function assertSafeP285AcceptanceTelemetryEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return schemaInvalid();
  if (event.type === "p2_85_acceptance_rejection") {
    return hasExactKeys(event, ["runId", "suite", "type", "payload"]) && SAFE_RUN_ID.test(event.runId) && event.suite === "p2-85" && event.payload &&
      typeof event.payload === "object" && !Array.isArray(event.payload) &&
      hasExactKeys(event.payload, ["scenarioId", "rejectionReason"]) &&
      P2_85_SCENARIO_IDS.includes(event.payload.scenarioId) &&
      P2_85_ACCEPTANCE_REJECTION_REASONS.has(event.payload.rejectionReason)
      ? { ok: true, reason: null }
      : schemaInvalid();
  }
  if (event.type === "p2_85_acceptance_observation") {
    return hasExactKeys(event, ["runId", "suite", "type", "payload"]) && SAFE_RUN_ID.test(event.runId) && event.suite === "p2-85"
      ? assertSafeP285Observation(event.payload)
      : schemaInvalid();
  }
  return schemaInvalid();
}

function isP285SharedLifecycleEvent(event) {
  return Boolean(event && typeof event === "object" && !Array.isArray(event) &&
    hasExactKeys(event, ["runId", "suite", "type", "payload"]) && SAFE_RUN_ID.test(event.runId) &&
    event.suite === "p2-85" && P2_85_SHARED_LIFECYCLE_EVENT_TYPES.has(event.type));
}

export function selectP285EvidenceEvents(events) {
  const selected = [];
  for (const event of events) {
    if (isP285SharedLifecycleEvent(event)) {
      selected.push(event);
      continue;
    }
    const safety = assertSafeP285AcceptanceTelemetryEvent(event);
    if (safety.ok) {
      selected.push(event);
      continue;
    }
    return { ok: false, events: selected };
  }
  return { ok: true, events: selected };
}

export function validateScenarioObservation(scenarioId, payload, lifecycleEvents) {
  const privacy = assertSafeP285Observation(payload);
  if (!privacy.ok) return privacy;
  const requestId = payload.requestId;
  const actionLifecycle = lifecycleEvents.filter((event) => event.payload?.requestId === requestId);
  const terminalEvents = actionLifecycle.filter(isActionTerminal);
  const oneTerminal = SAFE_REQUEST_ID.test(requestId ?? "") && terminalEvents.length === 1;
  const boundaryMatches = payload.runtimeBoundary === P2_85_RUNTIME_BOUNDARIES[scenarioId];
  const checks = {
    chat_opened_replace_active: boundaryMatches && payload.terminalObserved === true &&
      payload.replacementAccepted === true &&
      payload.lateLifecycleIgnored === true && oneTerminal,
    reply_visible_generic_once: boundaryMatches && payload.terminalObserved === true &&
      payload.affectActionAttempted === false &&
      payload.genericReplyActionAttempted === true && payload.actionRequestCount === 1 &&
      payload.streamCompleted === true && oneTerminal,
    explicit_game_single_presentation: boundaryMatches && payload.proactiveCandidateId === "explicit_game_started" &&
      payload.proactiveCandidateCount === 1 && payload.automaticModeActionCount === 0,
    proactive_suppress_single_defer: boundaryMatches && payload.suppressedTerminal === true &&
      payload.deferredOnce === true && payload.deferredReplayed === false &&
      payload.ttlExtended === false
  };
  return checks[scenarioId] ? { ok: true, reason: null } : { ok: false, reason: "scenario_contract_failed" };
}

export function createP285FailureDiagnostics({ stage, error, electronStderr = "", renderMode }) {
  const failureCode = /GPU process exited unexpectedly|GPU process isn't usable/u.test(electronStderr)
    ? "gpu_child_crash"
    : /Unable to load preload script/u.test(electronStderr)
      ? "pet_preload_load_failed"
      : /Cannot find module|ERR_MODULE_NOT_FOUND/u.test(electronStderr)
        ? "module_load_failed"
        : stage === "overall_timeout"
          ? "runner_timeout"
          : "runner_failure";
  return {
    stage,
    errorName: error instanceof Error ? error.name : typeof error,
    failureCode,
    renderMode: resolveP285RenderMode(renderMode)
  };
}

function isActionTerminal(event) {
  return event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped";
}

export function readP285Telemetry(context) {
  const result = readAcceptanceEvidenceForContext(context, "p2-85");
  if (!result.ok) throw new Error("p2_85_evidence_invalid");
  return result.events;
}

export async function waitForP285Observation(context, startIndex, scenarioId) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const selection = selectP285EvidenceEvents(readP285Telemetry(context).slice(startIndex));
    if (!selection.ok) {
      throw new Error("p2_85_telemetry_schema_invalid");
    }
    const { events } = selection;
    const observation = events.find((event) =>
      event.type === "p2_85_acceptance_observation" && event.payload?.scenarioId === scenarioId
    );
    if (observation) return { observation, events };
    await sleep(50);
  }
  throw new Error("p2_85_observation_timeout");
}

export function readP285SafeRejection(events, scenarioId) {
  const event = events.find((item) =>
    item.type === "p2_85_acceptance_rejection" && item.payload?.scenarioId === scenarioId
  );
  if (event && !assertSafeP285AcceptanceTelemetryEvent(event).ok) return null;
  const rejectionReason = event?.payload?.rejectionReason;
  return typeof rejectionReason === "string" && P2_85_ACCEPTANCE_REJECTION_REASONS.has(rejectionReason)
    ? rejectionReason
    : null;
}

export async function resetP285AcceptanceBaseline(pet, context) {
  const startIndex = context ? readP285Telemetry(context).length : 0;
  const accepted = await evaluate(pet, "window.petApi.resetP285AcceptanceBaseline()")
  const selection = context
    ? selectP285EvidenceEvents(readP285Telemetry(context).slice(startIndex))
    : { ok: true, events: [] };
  if (!selection.ok) {
    throw new Error("p2_85_telemetry_schema_invalid");
  }
  const { events } = selection;
  if (accepted === true) return;
  const rejectionReason = context
    ? readP285SafeRejection(
      events,
      "chat_opened_replace_active"
    ) ?? "missing_safe_rejection_reason"
    : "missing_safe_rejection_reason";
  const error = new Error("p2_85_baseline_reset_rejected");
  error.p285RejectionReason = rejectionReason;
  throw error;
}

export async function runP285WithCleanup(run, cleanup) {
  let primaryFailure;
  let hasPrimaryFailure = false;
  try {
    return await run();
  } catch (error) {
    primaryFailure = error;
    hasPrimaryFailure = true;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      const cleanupFailureDiagnostics = createP285FailureDiagnostics({
        stage: "cleanup",
        error: cleanupError,
        renderMode: resolveP285RenderMode()
      });
      if (hasPrimaryFailure && primaryFailure !== null &&
        (typeof primaryFailure === "object" || typeof primaryFailure === "function") &&
        Object.isExtensible(primaryFailure)) {
        primaryFailure.p285CleanupFailureDiagnostics = cleanupFailureDiagnostics;
      } else if (hasPrimaryFailure) {
        const error = new Error("p2_85_cleanup_failed_after_primary");
        error.p285PrimaryFailureDiagnostics = createP285FailureDiagnostics({
          stage: "primary",
          error: primaryFailure,
          renderMode: resolveP285RenderMode()
        });
        error.p285CleanupFailureDiagnostics = cleanupFailureDiagnostics;
        throw error;
      } else {
        const error = new Error("p2_85_cleanup_failed");
        error.p285FailureDiagnostics = cleanupFailureDiagnostics;
        error.p285CleanupFailureDiagnostics = cleanupFailureDiagnostics;
        throw error;
      }
    }
  }
}

async function runProductionEvidence() {
  const renderMode = resolveP285RenderMode();
  const context = createRealUiRunContext({
    runName: "p2-85-context-emotion-proactive-real-ui",
    port: Number(process.env.P2_85_CDP_PORT || 9735),
    env: getP285AcceptanceEnvironment(renderMode),
    tmpResiduePatterns: [/^p2-85-context-emotion-proactive-real-ui$/i]
  });
  context.electronArgs = getP285ElectronArgs(renderMode);
  const observations = [];
  let stage = "electron_start";
  return runP285WithCleanup(async () => {
    startElectron(context);
    stage = "cdp_connect";
    await connectToElectron(context, 30_000);
    stage = "pet_window";
    const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    stage = "pet_preload";
    await waitFor(pet, "Boolean(window.petApi?.resetP285AcceptanceBaselineAndRunScenario)", { timeoutMs: 15_000 });
    for (const scenarioId of P2_85_SCENARIO_IDS) {
      stage = `scenario:${scenarioId}:baseline_and_invoke`;
      const startIndex = readP285Telemetry(context).length;
      const accepted = await evaluate(
        pet,
        `window.petApi.resetP285AcceptanceBaselineAndRunScenario(${JSON.stringify(scenarioId)})`
      );
      if (accepted !== true) {
        const error = new Error(`scenario_rejected:${scenarioId}`);
        error.p285RejectionReason = readP285SafeRejection(
          readP285Telemetry(context).slice(startIndex),
          scenarioId
        ) ?? "missing_safe_rejection_reason";
        throw error;
      }
      stage = `scenario:${scenarioId}:observation`;
      const { observation, events } = await waitForP285Observation(context, startIndex, scenarioId);
      stage = `scenario:${scenarioId}:validation`;
      const validation = validateScenarioObservation(scenarioId, observation.payload, events);
      observations.push({ scenarioId, ok: validation.ok, reason: validation.reason });
      if (!validation.ok) throw new Error(`${scenarioId}:${validation.reason}`);
    }
    stage = "screenshot_residue";
    assertNoScreenshotResidue(context);
    return {
      ok: observations.every((item) => item.ok),
      runtimePath: "production_electron",
      renderMode,
      evidenceBoundary: P2_85_EVIDENCE_BOUNDARY_SUMMARY,
      observations
    };
  }, async () => {
    await cleanupP285ProductionContext(context);
  }).catch((error) => {
    if (error && typeof error === "object" && !error.p285FailureDiagnostics) {
      error.p285FailureDiagnostics = createP285FailureDiagnostics({
        stage,
        error,
        renderMode,
        electronStderr: readElectronStderr(context)
      });
    }
    throw error;
  });
}

function readElectronStderr(context) {
  const stderrPath = join(context.runDir, "electron.stderr.log");
  return existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : "";
}

export async function cleanupP285ProductionContext(context) {
  let electronStopped = false;
  try {
    const page = context.pages.at(0);
    if (page?.cdp && context.child?.exitCode === null) {
      try {
        await page.cdp.send("Browser.close", {}, 5_000);
      } catch {
        // Closing the browser normally closes CDP before it can reply.
      }
    }
    for (const item of context.pages) item?.cdp?.close();
    context.pages = [];
    if (context.child?.exitCode === null && context.child?.signalCode === null) {
      context.child.kill();
      await waitForChildExit(context.child, 10_000);
    }
    electronStopped = context.child?.exitCode !== null || context.child?.signalCode !== null;
  } finally {
    cleanupRealUiRun(context);
  }
  assertRealUiRunParentRemoved(context);
  return { electronStopped, runnerTmpRemoved: !existsSync(context.runParentDir) };
}

export async function runP285ProductionAcceptance() {
  const hookInspection = inspectP285AcceptanceHooks({
    appSource: readFileSync(APP_PATH, "utf8"),
    scenarioSource: readFileSync(ACCEPTANCE_SCENARIOS_PATH, "utf8"),
    petPreloadSource: readFileSync(PET_PRELOAD_PATH, "utf8"),
    ipcContractSource: readFileSync(IPC_CONTRACT_PATH, "utf8")
  });
  if (!hookInspection.ready) {
    return {
      ok: false,
      status: "blocked_missing_hooks",
      runtimePath: "not_started",
      renderMode: resolveP285RenderMode(),
      evidenceBoundary: `${P2_85_EVIDENCE_BOUNDARY_SUMMARY}; no production Electron claim because required hooks are absent`,
      missingHooks: hookInspection.requiredHooks
    };
  }
  let timeout = null;
  try {
    return await Promise.race([
      runProductionEvidence(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("runner_timeout")), RUNNER_TIMEOUT_MS);
        timeout.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  try {
    const summary = await runP285ProductionAcceptance();
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.ok) process.exitCode = 1;
  } catch (error) {
    const diagnostics = error?.p285FailureDiagnostics ?? createP285FailureDiagnostics({
      stage: "overall_timeout",
      error,
      renderMode: resolveP285RenderMode()
    });
    process.stdout.write(`${JSON.stringify({
      ok: false,
      status: "failed",
      runtimePath: "production_electron",
      evidenceBoundary: P2_85_EVIDENCE_BOUNDARY_SUMMARY,
      ...diagnostics
      ,
      primaryFailure: error?.p285PrimaryFailureDiagnostics,
      cleanupFailure: error?.p285CleanupFailureDiagnostics,
      rejectionReason: typeof error?.p285RejectionReason === "string"
        ? error.p285RejectionReason
        : undefined
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
