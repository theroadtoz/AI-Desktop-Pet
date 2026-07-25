import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  sleep,
  startElectron,
  waitFor,
  waitForChildExit,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

const FORBIDDEN_TELEMETRY_KEY = /(?:^|_)(?:text|body|content|prompt|raw|raw_snapshot|raw_environment|environment_snapshot|window|window_title|process|process_name|path|url|query|kind|affect_kind|emotion_kind)(?:$|_)/iu;
const SAFE_REQUEST_ID = /^[a-f0-9]{32}$/u;
const P2_85_ACCEPTANCE_REJECTION_REASONS = new Set([
  "pending_observation",
  "baseline_pending",
  "baseline_not_closed",
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

export function inspectP285AcceptanceHooks({ appSource, scenarioSource, petPreloadSource, ipcContractSource }) {
  const missing = [];
  const hasTripleGate = /AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY/u.test(appSource) &&
    /AI_DESKTOP_PET_P2_85_SAFE_OBSERVATION/u.test(appSource) &&
    /AI_DESKTOP_PET_P2_85_SAFE_FIXTURE/u.test(appSource);
  if (!hasTripleGate) missing.push("triple_gate");

  const hasTrustedScenarioHandler = /ipcMain\.handle\(\s*["']pet:p2-85-run-scenario["']/u.test(appSource) &&
    /isPetSender\(event\)/u.test(appSource) &&
    /AI_DESKTOP_PET_P2_85_SAFE_FIXTURE/u.test(appSource);
  const hasPreloadBridge = /runP285ScenarioForAcceptance/u.test(petPreloadSource);
  const hasTypedBridge = /runP285ScenarioForAcceptance/u.test(ipcContractSource);
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
    return { ok: false, reason: "missing_payload" };
  }
  const stack = [["payload", payload]];
  while (stack.length > 0) {
    const [path, value] = stack.pop();
    if (Array.isArray(value)) {
      value.forEach((item, index) => stack.push([`${path}[${index}]`, item]));
      continue;
    }
    if (!value || typeof value !== "object") continue;
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.replace(/([a-z])([A-Z])/gu, "$1_$2").toLowerCase();
      if (FORBIDDEN_TELEMETRY_KEY.test(normalizedKey)) {
        return { ok: false, reason: `forbidden_key:${key}` };
      }
      stack.push([`${path}.${key}`, nested]);
    }
  }
  return { ok: true, reason: null };
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
  const logDir = join(context.appDataDir, "logs");
  if (!existsSync(logDir)) return [];
  return readdirSync(logDir)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) => readFileSync(join(logDir, name), "utf8")
      .split(/\r?\n/u)
      .map((line) => {
        try {
          return line ? JSON.parse(line) : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean));
}

export async function waitForP285Observation(context, startIndex, scenarioId) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const events = readP285Telemetry(context).slice(startIndex);
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
  const rejectionReason = event?.payload?.rejectionReason;
  return typeof rejectionReason === "string" && P2_85_ACCEPTANCE_REJECTION_REASONS.has(rejectionReason)
    ? rejectionReason
    : null;
}

export async function resetP285AcceptanceBaseline(pet, context) {
  const startIndex = context ? readP285Telemetry(context).length : 0;
  const accepted = await evaluate(pet, "window.petApi.resetP285AcceptanceBaseline()")
  if (accepted === true) return;
  const rejectionReason = context
    ? readP285SafeRejection(
      readP285Telemetry(context).slice(startIndex),
      "chat_opened_replace_active"
    ) ?? "missing_safe_rejection_reason"
    : "missing_safe_rejection_reason";
  const error = new Error("p2_85_baseline_reset_rejected");
  error.p285RejectionReason = rejectionReason;
  throw error;
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
  let cleanup = { electronStopped: false, runnerTmpRemoved: false };
  let stage = "electron_start";
  try {
    startElectron(context);
    stage = "cdp_connect";
    await connectToElectron(context, 30_000);
    stage = "pet_window";
    const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    stage = "pet_preload";
    await waitFor(pet, "Boolean(window.petApi?.runP285ScenarioForAcceptance)", { timeoutMs: 15_000 });
    for (const scenarioId of P2_85_SCENARIO_IDS) {
      stage = `scenario:${scenarioId}:baseline_reset`;
      await resetP285AcceptanceBaseline(pet, context);
      stage = `scenario:${scenarioId}:invoke`;
      const startIndex = readP285Telemetry(context).length;
      const accepted = await evaluate(
        pet,
        `window.petApi.runP285ScenarioForAcceptance(${JSON.stringify(scenarioId)})`
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
  } catch (error) {
    if (error && typeof error === "object") {
      error.p285FailureDiagnostics = createP285FailureDiagnostics({
        stage,
        error,
        renderMode,
        electronStderr: readElectronStderr(context)
      });
    }
    throw error;
  } finally {
    cleanup = await cleanupP285ProductionContext(context);
  }
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
