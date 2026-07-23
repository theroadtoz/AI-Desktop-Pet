import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { createServer, connect as connectSocket } from "node:net";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  sleep,
  startElectron,
  typeText,
  waitFor,
  waitForChildExit,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packRoot = resolve(
  process.env.P2_84_LOCAL_LLM_PACK_ROOT ||
  process.env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT ||
  join(root, "resources", "local-llm")
);
const sendTimeoutMs = readPositiveInteger(process.env.P2_84_SEND_TIMEOUT_MS) ?? 180_000;
const providerTimeoutMs = readPositiveInteger(process.env.P2_84_PROVIDER_TIMEOUT_MS) ?? 180_000;
const PRODUCTION_STARTUP_MAX_ATTEMPTS = 2;
const PRODUCTION_WINDOW_CONNECT_MAX_ATTEMPTS = 2;
const acceptanceScope = parseAcceptanceScope(process.env.P2_84_ACCEPTANCE_SCOPE);
const FIXTURE_MESSAGE = "__p2_84_medium_low_fixture__，以后回复短一点。";
const AFFECT_ACTION_REASONS = new Set(["state_listen", "state_think", "state_flustered", "state_sleep"]);
const FORBIDDEN_AFFECT_TELEMETRY_KEYS = new Set([
  "kind",
  "text",
  "source",
  "observedAtMs",
  "updatedAtMs",
  "reasoning",
  "timeline"
]);

class ProductionStartupError extends Error {
  constructor(stage, cause, attempts, cleanup) {
    super(`${stage}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.stage = stage;
    this.attempts = attempts;
    this.cleanup = cleanup;
  }
}

const startedAt = Date.now();
const l1 = acceptanceScope === "all" ? runThirdPartyReportedAffectL1() : null;
let production = null;
let bundled = null;
let activeSection = null;

try {
  if (acceptanceScope !== "bundled") {
    activeSection = "production-electron-l2";
    production = await runProductionL2();
  }
  if (acceptanceScope !== "production") {
    activeSection = "bundled-local-qwen-real-ui";
    bundled = await runBundledQwen();
  }
} catch (error) {
  if (activeSection === "production-electron-l2") {
    production = failedSection("production-electron-l2", error);
  } else if (activeSection === "bundled-local-qwen-real-ui") {
    bundled = failedSection("bundled-local-qwen-real-ui", error);
  }
}

const totalAssertions = sumAssertions(l1, production, bundled);
const summary = {
  ok: [l1, production, bundled].filter(Boolean).every((section) => section.ok === true),
  safeSummaryOnly: true,
  runName: "p2-84-acceptance",
  scope: acceptanceScope,
  durationMs: Date.now() - startedAt,
  assertions: totalAssertions,
  evidenceBoundary: {
    thirdPartyReportedAffectL1: "deterministic parser contract only; no real-model classification claim",
    productionL2: "closed-safe-fixture; proves production Electron/IPC/settings/coordinator/P2-83C routing, not real emotion understanding",
    bundledQwen: "real bundled llama.cpp/Qwen UI replies; proves sampled relevance and boundaries, not genuine emotion understanding"
  },
  l1,
  production,
  bundled
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) {
  process.exitCode = 1;
}

function runThirdPartyReportedAffectL1() {
  const sectionStartedAt = Date.now();
  const result = spawnSync(process.execPath, [
    "--test",
    "--experimental-strip-types",
    "--test-name-pattern=third-party and structurally reported affect",
    "scripts/companion-affect.test.mts"
  ], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000
  });
  const checks = {
    thirdPartyReportedAffectNotExplicitHigh: result.status === 0
  };
  return {
    ok: checks.thirdPartyReportedAffectNotExplicitHigh,
    mode: "deterministic-l1",
    durationMs: Date.now() - sectionStartedAt,
    assertions: summarizeChecks(checks),
    checks,
    failureCategory: result.status === 0 ? undefined : "third_party_reported_affect_l1_failed",
    evidenceBoundary: "deterministic parser contract; no real-model classification claim"
  };
}

async function runProductionL2() {
  const sectionStartedAt = Date.now();
  const checks = {};
  let error = null;
  let runtimePort = null;
  let context = null;
  let startup = null;
  let pet = null;
  let chat = null;

  try {
    ({ context, pet, chat, startup } = await startProductionWindows());
    await waitFor(chat, "Boolean(window.dialogueAffectApi && document.querySelector('#chat-input'))", {
      timeoutMs: 20_000
    });
    await waitForActionIdle(context, 12_000);

    const defaultSettings = await evaluate(chat, "window.dialogueAffectApi.getSettings()");
    checks.defaultEnabled = defaultSettings?.enabled === true;

    const lowStart = readTelemetryEntries(context).length;
    await sendMessage(chat, "我现在有点低落，只想让你安静听我说。");
    const lowObservation = await waitForTelemetryAfter(
      context,
      lowStart,
      (entry) => entry.type === "p2_84_acceptance_observation",
      10_000
    );
    const lowDecision = await waitForTelemetryAfter(
      context,
      lowStart,
      (entry) => entry.type === "dialogue_affect_decision",
      10_000
    );
    checks.lowToneApplied = lowObservation.payload?.enabled === true &&
      lowObservation.payload?.dialogueContextApplied === true;
    checks.lowHighIntensityHasNoAffectAction = lowObservation.payload?.actionIntentPresent === false &&
      lowDecision.payload?.status === "applied" &&
      lowDecision.payload?.confidenceBand === "high";
    await waitForActionIdle(context, 12_000);

    const disabledSettings = await evaluate(
      chat,
      "window.dialogueAffectApi.setSettings({ enabled: false })"
    );
    checks.disableRoundTrip = disabledSettings?.enabled === false &&
      (await evaluate(chat, "window.dialogueAffectApi.getSettings()"))?.enabled === false;

    const disabledStart = readTelemetryEntries(context).length;
    await sendMessage(chat, "我今天真的很疲惫，只想安静说一句。");
    const disabledObservation = await waitForTelemetryAfter(
      context,
      disabledStart,
      (entry) => entry.type === "p2_84_acceptance_observation",
      10_000
    );
    const disabledEvents = readTelemetryEntries(context).slice(disabledStart);
    checks.disabledToneSuppressed = disabledObservation.payload?.enabled === false &&
      disabledObservation.payload?.dialogueContextApplied === false;
    checks.disabledAffectActionSuppressed =
      disabledObservation.payload?.actionIntentPresent === false &&
      !disabledEvents.some(isAffectActionStarted);
    await waitForActionIdle(context, 12_000);

    const enabledSettings = await evaluate(
      chat,
      "window.dialogueAffectApi.setSettings({ enabled: true })"
    );
    checks.reenableRoundTrip = enabledSettings?.enabled === true &&
      (await evaluate(chat, "window.dialogueAffectApi.getSettings()"))?.enabled === true;

    const tiredStart = readTelemetryEntries(context).length;
    await sendMessage(chat, "我现在很疲惫，只想安静待一会儿。");
    const tiredObservation = await waitForTelemetryAfter(
      context,
      tiredStart,
      (entry) => entry.type === "p2_84_acceptance_observation",
      10_000
    );
    checks.tiredToneRestored = tiredObservation.payload?.enabled === true &&
      tiredObservation.payload?.dialogueContextApplied === true &&
      tiredObservation.payload?.actionIntentPresent === false;
    await waitForActionIdle(context, 12_000);

    const correctionStart = readTelemetryEntries(context).length;
    await sendMessage(chat, "纠正一下，我没有难过，刚才只是开玩笑。");
    const correctionObservation = await waitForTelemetryAfter(
      context,
      correctionStart,
      (entry) => entry.type === "p2_84_acceptance_observation",
      10_000
    );
    const correctionDecision = await waitForTelemetryAfter(
      context,
      correctionStart,
      (entry) => entry.type === "dialogue_affect_decision" &&
        entry.payload?.status === "corrected",
      10_000
    );
    checks.correctionReturnsNeutral = correctionObservation.payload?.dialogueContextApplied === false &&
      correctionObservation.payload?.actionIntentPresent === false &&
      correctionDecision.payload?.confidenceBand === "low";
    await waitForActionIdle(context, 12_000);

    const firstFixtureStart = readTelemetryEntries(context).length;
    await sendMessage(chat, FIXTURE_MESSAGE);
    const firstFixtureObservation = await waitForTelemetryAfter(
      context,
      firstFixtureStart,
      (entry) => entry.type === "p2_84_acceptance_observation",
      10_000
    );
    checks.mediumHysteresisFirstSignalHeld =
      firstFixtureObservation.payload?.dialogueContextApplied === false &&
      firstFixtureObservation.payload?.actionIntentPresent === false;
    const firstFixtureLifecycle = await waitForSingleP283cTerminalAfter(
      context,
      firstFixtureStart,
      15_000
    );
    checks.mediumFirstRequestHasSingleTerminal =
      firstFixtureLifecycle.terminalCount === 1;
    await waitForActionIdle(context, 12_000);
    await sleep(550);

    const secondFixtureStart = readTelemetryEntries(context).length;
    await sendMessage(chat, FIXTURE_MESSAGE);
    const secondFixtureObservation = await waitForTelemetryAfter(
      context,
      secondFixtureStart,
      (entry) => entry.type === "p2_84_acceptance_observation",
      10_000
    );
    checks.chatInputFocusedAtAffectGate = await evaluate(
      chat,
      "document.activeElement === document.querySelector('#chat-input')"
    );
    await sleep(550);
    const focusedGateEvents = readTelemetryEntries(context).slice(secondFixtureStart);
    checks.mediumHysteresisSecondSignalApplied =
      secondFixtureObservation.payload?.dialogueContextApplied === true &&
      secondFixtureObservation.payload?.actionIntentPresent === true;
    checks.focusedChatHasNoAffectCoordinatorDispatch =
      !focusedGateEvents.some((entry) =>
        entry.type === "dialogue_affect_action_dispatch"
      );
    checks.focusedChatDoesNotStartStateListen =
      !focusedGateEvents.some((entry) =>
        entry.type === "pet_interaction_action_started" &&
        entry.payload?.reason === "state_listen"
      );
    checks.noConcurrentP283cRequests = hasAtMostOneActiveRequest(
      focusedGateEvents
    );

    const telemetry = readTelemetryEntries(context);
    const affectEvents = telemetry.filter((entry) =>
      entry.type === "dialogue_affect_decision" ||
      entry.type === "xita_affect_transition" ||
      entry.type === "p2_84_acceptance_observation" ||
      entry.type === "dialogue_affect_action_dispatch"
    );
    checks.affectTelemetrySafeKeys = affectEvents.length > 0 &&
      affectEvents.every((entry) =>
        Object.keys(entry.payload ?? {}).every((key) => !FORBIDDEN_AFFECT_TELEMETRY_KEYS.has(key))
      );
    checks.telemetryContainsNoUserBody = !containsAny(
      serializeTelemetry(telemetry),
      [
        "我现在有点低落",
        "我今天真的很疲惫",
        "我现在很疲惫",
        "我没有难过",
        FIXTURE_MESSAGE
      ]
    );
    const settingsRecord = readJsonIfExists(
      join(context.appDataDir, "config", "dialogue-affect-settings.json")
    );
    checks.settingsPersistedEnabled = settingsRecord?.version === 1 &&
      settingsRecord?.enabled === true &&
      Object.keys(settingsRecord).length === 2;
    const stateRecord = readJsonIfExists(
      join(context.appDataDir, "config", "xita-affect-state.json")
    );
    checks.affectStoreHasNoUserAffect = stateRecord &&
      sortedKeysEqual(stateRecord, ["intensity", "state", "timestampMs", "version"]) &&
      !containsAny(JSON.stringify(stateRecord), ["kind", "confidence", "source", "text"]);
    checks.providerIsFakeFixtureOnly = telemetry.some((entry) =>
      entry.type === "provider_selected" && entry.payload?.providerId === "fake"
    );
    checks.noScreenshotResidue = assertNoScreenshotResidueSafe(context);
  } catch (caught) {
    error = caught;
  } finally {
    const cleanup = context
      ? await cleanupContext(context, runtimePort)
      : error instanceof ProductionStartupError
        ? error.cleanup
        : emptyCleanup();
    checks.electronStopped = cleanup.electronStopped;
    checks.cdpPortReleased = cleanup.cdpPortReleased;
    checks.runtimePortReleased = cleanup.runtimePortReleased;
    checks.runnerTmpRemoved = cleanup.runnerTmpRemoved;
  }

  const assertionSummary = summarizeChecks(checks);
  return {
    ok: error === null && assertionSummary.passed === assertionSummary.total,
    mode: "production-electron-l2",
    provider: "fake acceptance fixture",
    runtime: "production Electron",
    durationMs: Date.now() - sectionStartedAt,
    assertions: assertionSummary,
    checks,
    startup: startup ?? summarizeStartupFailure(error),
    failureCategory: error ? classifyError(error) : firstFailedCheck(checks),
    evidenceBoundary: "closed safe fixture; no claim of real emotion understanding"
  };
}

async function startProductionWindows() {
  const attempts = [];
  for (let attempt = 1; attempt <= PRODUCTION_STARTUP_MAX_ATTEMPTS; attempt += 1) {
    const context = await createProductionContext();
    let stage = "launch";
    try {
      startElectron(context);
      stage = "cdp_connect";
      await retryProductionStartupConnection(context, () => connectToElectron(context, 45_000));
      stage = "pet_window";
      const pet = await retryProductionStartupConnection(
        context,
        () => waitForWindow(context, "renderer/pet/index.html", 45_000)
      );
      stage = "pet_preload";
      await waitFor(pet, "Boolean(window.petApi)", { timeoutMs: 20_000 });
      stage = "chat_open";
      await evaluate(pet, "window.petApi.openChat()");
      stage = "chat_window";
      const chat = await retryProductionStartupConnection(
        context,
        () => waitForWindow(context, "renderer/chat/index.html", 45_000)
      );
      return {
        context,
        pet,
        chat,
        startup: {
          attempts: attempt,
          recoveredStages: attempts.map((item) => item.stage),
          connectionRetries: context.p284StartupConnectionRetries ?? 0
        }
      };
    } catch (error) {
      const diagnostics = await captureProductionStartupDiagnostics(context, stage);
      const cleanup = await cleanupContext(context, null);
      attempts.push({
        stage,
        connectionRetries: context.p284StartupConnectionRetries ?? 0,
        diagnostics,
        cleanupComplete: cleanup.electronStopped && cleanup.cdpPortReleased && cleanup.runnerTmpRemoved
      });
      if (attempt < PRODUCTION_STARTUP_MAX_ATTEMPTS && isRetryableProductionStartupStage(stage)) {
        await sleep(300);
        continue;
      }
      throw new ProductionStartupError(stage, error, attempts, cleanup);
    }
  }
  throw new Error("production_startup_attempts_exhausted");
}

async function createProductionContext() {
  const context = createRealUiRunContext({
    runName: "p2-84-production-affect-real-ui",
    port: await selectAvailablePort(),
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_P2_84_SAFE_OBSERVATION: "1",
      AI_DESKTOP_PET_P2_84_SAFE_FIXTURE: "1"
    },
    tmpResiduePatterns: [/^p2-84-production-affect-real-ui$/i]
  });
  context.electronArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  return context;
}

function isRetryableProductionStartupStage(stage) {
  return stage === "cdp_connect" || stage === "pet_window" || stage === "chat_window";
}

async function retryProductionStartupConnection(context, operation) {
  let lastError = null;
  for (let attempt = 1; attempt <= PRODUCTION_WINDOW_CONNECT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === PRODUCTION_WINDOW_CONNECT_MAX_ATTEMPTS) {
        throw error;
      }
      context.p284StartupConnectionRetries = (context.p284StartupConnectionRetries ?? 0) + 1;
      closeProductionCdpPages(context);
      await sleep(300);
    }
  }
  throw lastError ?? new Error("production_startup_connection_retry_exhausted");
}

function closeProductionCdpPages(context) {
  for (const page of context.pages) {
    try {
      page?.cdp?.close();
    } catch {
      // A closed CDP socket has no further cleanup work.
    }
  }
  context.pages = [];
}

function emptyCleanup() {
  return {
    electronStopped: false,
    cdpPortReleased: false,
    runtimePortReleased: true,
    runnerTmpRemoved: false
  };
}

function summarizeStartupFailure(error) {
  if (!(error instanceof ProductionStartupError)) {
    return null;
  }
  return {
    attempts: error.attempts.length,
    terminalStage: error.stage,
    attemptStages: error.attempts.map((item) => item.stage),
    attemptDiagnostics: error.attempts.map((item) => ({
      stage: item.stage,
      connectionRetries: item.connectionRetries,
      cleanupComplete: item.cleanupComplete,
      ...item.diagnostics
    }))
  };
}

async function captureProductionStartupDiagnostics(context, stage) {
  await sleep(150);
  const [version, targets] = await Promise.all([
    readCdpDiagnostic(context.port, "json/version"),
    readCdpDiagnostic(context.port, "json/list")
  ]);
  const child = context.child;
  return {
    stage,
    electron: {
      pid: Number.isInteger(child?.pid) ? child.pid : null,
      exitCode: child?.exitCode ?? null,
      signalCode: child?.signalCode ?? null,
      running: Boolean(child && child.exitCode === null && child.signalCode === null)
    },
    stdoutTail: readSafeDiagnosticTail(context, "electron.stdout.log"),
    stderrTail: readSafeDiagnosticTail(context, "electron.stderr.log"),
    cdpVersion: summarizeCdpVersion(version),
    targets: summarizeCdpTargets(targets)
  };
}

async function readCdpDiagnostic(port, path) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/${path}`, {
      signal: AbortSignal.timeout(1_500)
    });
    if (!response.ok) {
      return { available: false, status: response.status };
    }
    return { available: true, value: await response.json() };
  } catch {
    return { available: false, status: null };
  }
}

function summarizeCdpVersion(result) {
  if (!result.available || !result.value || Array.isArray(result.value)) {
    return { available: false, status: result.status };
  }
  return {
    available: true,
    browser: sanitizeDiagnosticText(result.value.Browser),
    protocolVersion: sanitizeDiagnosticText(result.value["Protocol-Version"])
  };
}

function summarizeCdpTargets(result) {
  if (!result.available || !Array.isArray(result.value)) {
    return {
      available: false,
      status: result.status,
      entries: []
    };
  }
  return {
    available: true,
    status: 200,
    entries: result.value.slice(0, 12).map((target) => ({
      type: sanitizeDiagnosticText(target?.type),
      title: sanitizeDiagnosticText(target?.title),
      url: normalizeDiagnosticTargetUrl(target?.url)
    }))
  };
}

function normalizeDiagnosticTargetUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "file:") {
      const marker = "/dist-renderer/";
      const markerIndex = parsed.pathname.lastIndexOf(marker);
      return markerIndex >= 0
        ? `file://<app>${parsed.pathname.slice(markerIndex)}`
        : "file://<app>";
    }
    if (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.protocol === "devtools:"
    ) {
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    }
    return `${parsed.protocol}//<redacted>${parsed.pathname}`;
  } catch {
    return sanitizeDiagnosticText(value);
  }
}

function readSafeDiagnosticTail(context, fileName) {
  const path = join(context.runDir, fileName);
  if (!existsSync(path)) {
    return [];
  }
  try {
    return readFileSync(path, "utf8")
      .slice(-16_384)
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0)
      .slice(-12)
      .map((line) => sanitizeDiagnosticText(line, context))
      .filter(Boolean);
  } catch {
    return ["<unreadable>"];
  }
}

function sanitizeDiagnosticText(value, context = null) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  let safe = value;
  for (const [literal, replacement] of [
    [context?.appDataDir, "<user-data>"],
    [context?.runDir, "<run-dir>"],
    [root, "<repo>"]
  ]) {
    if (literal) {
      safe = safe.replaceAll(literal, replacement);
      safe = safe.replaceAll(literal.replaceAll("\\", "/"), replacement);
    }
  }
  safe = safe
    .replace(
      /\b(api[_-]?key|authorization|bearer|token|secret|password)(\s*[:=]\s*|\s+)\S+/giu,
      "$1$2<redacted>"
    )
    .replace(/\bfile:\/\/\/[a-z]:\/\S+/giu, "file://<path>")
    .replace(/\b[a-z]:\\[^\r\n"']+/giu, "<path>")
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/giu, "$1");
  return safe.slice(0, 500);
}

async function runBundledQwen() {
  const sectionStartedAt = Date.now();
  const validation = validateLocalLlmPack(packRoot);
  if (!validation.ok) {
    return {
      ok: false,
      mode: "bundled-local-qwen-real-ui",
      runtime: "llama.cpp",
      provider: "unavailable",
      durationMs: Date.now() - sectionStartedAt,
      validation,
      assertions: { passed: 0, total: 1 },
      checks: { localLlmPackReady: false },
      failureCategory: validation.status ?? "local_llm_pack_unavailable",
      evidenceBoundary: "development pack unavailable; no model evidence created"
    };
  }

  const context = createRealUiRunContext({
    runName: "p2-84-bundled-qwen-real-ui",
    port: await selectAvailablePort(),
    env: {
      AI_DESKTOP_PET_PROVIDER: "",
      AI_DESKTOP_PET_API_KEY: "",
      AI_DESKTOP_PET_BASE_URL: "",
      AI_DESKTOP_PET_MODEL: "",
      AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: packRoot,
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"
    },
    tmpResiduePatterns: [/^p2-84-bundled-qwen-real-ui$/i]
  });
  context.electronArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  const checks = { localLlmPackReady: true };
  const caseResults = [];
  let providerStatus = null;
  let runtime = null;
  let handoff = null;
  let error = null;
  let runtimePort = null;

  try {
    startElectron(context);
    await connectToElectron(context, 45_000);
    const pet = await waitForWindow(context, "renderer/pet/index.html", 45_000);
    await waitFor(pet, "Boolean(window.petApi)", { timeoutMs: 20_000 });
    await evaluate(pet, "window.petApi.openChat()");
    const chat = await waitForWindow(context, "renderer/chat/index.html", 45_000);
    await waitFor(chat, "Boolean(window.configApi?.getProviderStatus && window.dialogueAffectApi)", {
      timeoutMs: 30_000
    });

    ({ runtime, handoff } = await waitForEmbeddedRuntime(context));
    runtimePort = runtime?.port ?? null;
    providerStatus = await waitForEmbeddedProviderStatus(chat, handoff);
    checks.defaultAffectEnabled =
      (await evaluate(chat, "window.dialogueAffectApi.getSettings()"))?.enabled === true;

    for (const item of bundledCases()) {
      await startNewConversation(chat);
      caseResults.push(await runBundledCase(chat, item));
    }

    const telemetry = readTelemetryEntries(context);
    const completedRequests = telemetry.filter((entry) =>
      entry.type === "provider_request_completed"
    );
    const startedRequests = telemetry.filter((entry) =>
      entry.type === "provider_request_started"
    );
    const startedChats = telemetry.filter((entry) =>
      entry.type === "chat_stream_started"
    );
    const affectEvents = telemetry.filter((entry) =>
      entry.type === "dialogue_affect_decision" || entry.type === "xita_affect_transition"
    );
    const requiredTurns = bundledCases().reduce((sum, item) => sum + item.turns.length, 0);
    checks.runtimeReady = runtime?.status === "ready" && runtime?.runtime === "llama.cpp";
    checks.embeddedProviderHandoff = handoff?.providerId === "local-openai-compatible" &&
      handoff?.localPresetId === "embedded-llama-cpp";
    checks.providerStatusEmbedded = providerStatus?.providerId === "local-openai-compatible" &&
      providerStatus?.model === handoff?.alias &&
      providerStatus?.baseURLHost === handoff?.baseURLHost &&
      providerStatus?.isFallback === false;
    checks.actualChatsEmbedded = startedChats.length === requiredTurns &&
      startedChats.every((entry) =>
        entry.payload?.providerId === "local-openai-compatible"
      );
    checks.providerRequestsEmbedded =
      startedRequests.length === requiredTurns &&
      completedRequests.length === requiredTurns &&
      [...startedRequests, ...completedRequests].every((entry) =>
        entry.payload?.providerId === "local-openai-compatible" &&
        entry.payload?.model === handoff?.alias &&
        entry.payload?.baseURLHost === handoff?.baseURLHost
      );
    checks.noFakeProvider = ![...startedChats, ...startedRequests, ...completedRequests].some(
      (entry) => entry.payload?.providerId === "fake"
    );
    checks.noExternalModelHost = [...startedRequests, ...completedRequests].every(
      (entry) => entry.payload?.baseURLHost === handoff?.baseURLHost
    );
    checks.chatStreamsCompleted = telemetry.filter((entry) =>
      entry.type === "chat_stream_completed"
    ).length >= requiredTurns;
    checks.noProviderFailures = !telemetry.some((entry) =>
      entry.type === "provider_request_failed" ||
      entry.type === "provider_unavailable" ||
      entry.type === "provider_unavailable_reply_blocked" ||
      entry.type === "chat_stream_failed"
    );
    checks.requiredCasesPassed = caseResults.every((item) => item.status === "passed");
    checks.affectTelemetrySafeKeys = affectEvents.length > 0 &&
      affectEvents.every((entry) =>
        Object.keys(entry.payload ?? {}).every((key) => !FORBIDDEN_AFFECT_TELEMETRY_KEYS.has(key))
      );
    checks.telemetryContainsNoUserBody = !containsAny(
      serializeTelemetry(telemetry),
      bundledCases().flatMap((item) => item.turns)
    );
    checks.noAcceptanceFixtureUsed = !telemetry.some((entry) =>
      entry.type === "p2_84_acceptance_observation"
    );
    checks.noScreenshotResidue = assertNoScreenshotResidueSafe(context);
  } catch (caught) {
    error = caught;
  } finally {
    const cleanup = await cleanupContext(context, runtimePort);
    checks.electronStopped = cleanup.electronStopped;
    checks.cdpPortReleased = cleanup.cdpPortReleased;
    checks.runtimePortReleased = cleanup.runtimePortReleased;
    checks.runnerTmpRemoved = cleanup.runnerTmpRemoved;
  }

  const caseAssertions = caseResults.reduce(
    (sum, item) => ({
      passed: sum.passed + item.assertions.passed,
      total: sum.total + item.assertions.total
    }),
    { passed: 0, total: 0 }
  );
  const sectionAssertions = summarizeChecks(checks);
  const assertions = {
    passed: caseAssertions.passed + sectionAssertions.passed,
    total: caseAssertions.total + sectionAssertions.total
  };

  return {
    ok: error === null && assertions.passed === assertions.total,
    mode: "bundled-local-qwen-real-ui",
    provider: providerStatus?.providerId ?? "unknown",
    runtime: runtime?.runtime ?? validation.runtime ?? "llama.cpp",
    model: handoff?.alias ?? validation.alias,
    durationMs: Date.now() - sectionStartedAt,
    validation,
    providerStatus: summarizeProviderStatus(providerStatus),
    runtimeStatus: summarizeRuntime(runtime),
    assertions,
    cases: caseResults,
    checks,
    failureCategory: error ? classifyError(error) : firstFailedCheck(checks),
    evidenceBoundary: "real bundled llama.cpp/Qwen sampled UI replies; not proof of genuine emotion understanding"
  };
}

function bundledCases() {
  return [
    {
      caseId: "explicit-low",
      turns: ["今天做什么都提不起劲。"],
      assert(reply) {
        const relevant = hasAny(reply, [
          "低落", "难过", "失落", "不好受", "提不起劲", "没精神", "难熬", "辛苦"
        ]);
        return {
          relevant,
          warmRestrained: relevant &&
            hasAny(reply, [
              "听起来", "能理解", "我明白", "明白了", "这样啊", "原来", "不容易",
              "辛苦", "难熬", "不好受", "心疼", "陪你", "听你", "在这", "安静待",
              "缓一缓", "慢慢来", "歇一歇"
            ]) &&
            !hasTaskifyingReply(reply) &&
            !hasDiagnosis(reply)
        };
      }
    },
    {
      caseId: "explicit-tired",
      turns: ["今天真的很累。"],
      assert(reply) {
        return {
          relevant: hasAny(reply, ["累", "疲惫", "困", "歇", "休息", "安静", "陪", "听"]),
          warmRestrained: hasAny(reply, ["陪", "听", "在", "安静", "慢慢", "歇"]) &&
            !hasTaskifyingReply(reply)
        };
      }
    },
    {
      caseId: "joke",
      turns: ["刚才说“世界末日了”，只是逗你的。"],
      assert(reply) {
        return {
          jokeUnderstood: hasSemanticJokeAcknowledgement(reply),
          noOverreading: !hasDeniedAffectOverread(reply),
          noForcedComfort: !hasForcedComfort(reply)
        };
      }
    },
    {
      caseId: "negation",
      turns: ["我没有难过，也不焦虑，今天就是下雨了。"],
      assert(reply) {
        return {
          negationRespected: hasSemanticNegationAcknowledgement(reply),
          noContradictoryInference: !hasDeniedAffectOverread(reply),
          noForcedComfort: !hasForcedComfort(reply)
        };
      }
    },
    {
      caseId: "correction",
      turns: [
        "今天有点难过。",
        "刚才那句是开玩笑的，我没有难过。"
      ],
      assert(reply) {
        const noInsistence = !hasDeniedAffectOverread(reply);
        const noForcedComfort = !hasForcedComfort(reply);
        return {
          correctionAccepted: hasSemanticCorrectionAcknowledgement(reply) &&
            reply.trim().length >= 4 &&
            noInsistence &&
            noForcedComfort,
          noInsistence,
          noForcedComfort
        };
      }
    },
    {
      caseId: "user-affect-attribution",
      turns: ["我有点难过，这是我的感受，不是你的。"],
      assert(reply) {
        return {
          userOwnershipPreserved: hasAny(reply, ["你", "你的", "这份", "难过"]),
          notClaimedAsXitaAffect: !/我(?:也|现在|真的|有点)?(?:很)?难过/.test(reply)
        };
      }
    },
    {
      caseId: "xita-affect-attribution",
      turns: ["西塔，你现在是什么感受？问的是你的感受，不是我的。"],
      assert(reply) {
        return {
          xitaFirstPersonAffect: reply.includes("我") &&
            /(开心|难过|平静|好奇|担心|感到|觉得|心里|心情|安心|放松|温柔|踏实|愉快|轻松|在意|关心)/.test(reply),
          noUserAffectProjection: !/(听起来|看起来|感觉你).{0,10}(难过|开心|焦虑|低落|紧张)/.test(reply)
        };
      }
    }
  ];
}

async function runBundledCase(page, item) {
  const startedAt = Date.now();
  let lastReply = "";
  let totalReplyLength = 0;

  try {
    for (const turn of item.turns) {
      lastReply = await sendMessage(page, turn);
      totalReplyLength += lastReply.length;
    }
    const caseChecks = {
      ...item.assert(lastReply),
      relatedAndBounded: lastReply.trim().length >= 4 && lastReply.length <= 280,
      kindAndInternalLabelsAbsent: !hasInternalAffectLabel(lastReply),
      actionResourcesAbsent: !hasActionResourceLeak(lastReply),
      noDiagnosis: !hasDiagnosis(lastReply),
      noGenericAiSelfIdentity: !hasGenericAiIdentity(lastReply),
      noThinkLeak: !/<\/?think>|reasoning/i.test(lastReply)
    };
    const assertions = summarizeChecks(caseChecks);
    return {
      caseId: item.caseId,
      status: assertions.passed === assertions.total ? "passed" : "failed",
      turnCount: item.turns.length,
      replyLength: lastReply.length,
      totalReplyLength,
      durationMs: Date.now() - startedAt,
      assertions,
      anchors: caseChecks,
      failureCategory: firstFailedCheck(caseChecks)
    };
  } catch (error) {
    return {
      caseId: item.caseId,
      status: "failed",
      turnCount: item.turns.length,
      replyLength: 0,
      totalReplyLength,
      durationMs: Date.now() - startedAt,
      assertions: { passed: 0, total: 1 },
      anchors: { completed: false },
      failureCategory: classifyError(error)
    };
  }
}

async function sendMessage(page, message) {
  const before = await evaluate(page, "document.querySelectorAll('.message-pet .message-content').length");
  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + sendTimeoutMs;

  while (Date.now() < deadline) {
    const state = await evaluate(page, `
      (() => {
        const input = document.querySelector("#chat-input");
        const replies = [...document.querySelectorAll(".message-pet .message-content")];
        return {
          inputDisabled: Boolean(input?.disabled),
          replyCount: replies.length,
          lastReply: replies.at(-1)?.textContent?.trim() ?? "",
          sessionState: document.querySelector("#chat-session-note")?.dataset.state ?? ""
        };
      })()
    `);
    if (state.replyCount > before && !state.inputDisabled && state.lastReply.length > 0) {
      return state.lastReply;
    }
    if (state.replyCount <= before && !state.inputDisabled && state.sessionState === "error") {
      throw new Error("provider_chat_failed");
    }
    await sleep(250);
  }
  throw new Error("send_timeout");
}

async function startNewConversation(page) {
  await click(page, "#new-conversation-button");
  await waitFor(page, `
    (() => {
      const input = document.querySelector("#chat-input");
      return document.querySelectorAll(".message-pet .message-content").length === 0 &&
        input && !input.disabled;
    })()
  `, { timeoutMs: 10_000, intervalMs: 150 });
}

async function waitForEmbeddedRuntime(context) {
  const deadline = Date.now() + providerTimeoutMs;
  while (Date.now() < deadline) {
    const entries = readTelemetryEntries(context);
    const runtime = latestPayload(entries, "bundled_llama_cpp_runtime_status", (payload) =>
      payload?.status === "ready"
    );
    const handoff = latestPayload(entries, "bundled_llama_cpp_provider_handoff");
    if (
      runtime?.status === "ready" &&
      handoff?.providerId === "local-openai-compatible" &&
      handoff?.localPresetId === "embedded-llama-cpp"
    ) {
      return { runtime, handoff };
    }
    await sleep(400);
  }
  throw new Error("embedded_runtime_timeout");
}

async function waitForEmbeddedProviderStatus(page, handoff) {
  const deadline = Date.now() + providerTimeoutMs;
  while (Date.now() < deadline) {
    const status = await evaluate(page, "window.configApi.getProviderStatus()");
    if (
      status?.providerId === "local-openai-compatible" &&
      status?.model === handoff?.alias &&
      status?.baseURLHost === handoff?.baseURLHost &&
      status?.isFallback === false
    ) {
      return status;
    }
    await sleep(400);
  }
  throw new Error("embedded_provider_timeout");
}

async function waitForTelemetryAfter(context, startIndex, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = readTelemetryEntries(context).slice(startIndex).find(predicate);
    if (entry) {
      return entry;
    }
    await sleep(50);
  }
  throw new Error("telemetry_wait_timeout");
}

async function waitForActionIdle(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = null;
  while (Date.now() < deadline) {
    const active = activeRequestIds(readTelemetryEntries(context));
    if (active.size === 0) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= 450) {
        return;
      }
    } else {
      stableSince = null;
    }
    await sleep(50);
  }
  throw new Error("action_idle_timeout");
}

async function waitForSingleP283cTerminalAfter(context, startIndex, timeoutMs) {
  const started = await waitForTelemetryAfter(
    context,
    startIndex,
    (entry) => entry.type === "pet_interaction_action_started" &&
      isSafeRequestId(entry.payload?.requestId),
    timeoutMs
  );
  const terminal = await waitForTelemetryAfter(
    context,
    startIndex,
    (entry) => isActionTerminal(entry) &&
      entry.payload?.requestId === started.payload.requestId,
    timeoutMs
  );
  const terminalCount = readTelemetryEntries(context).slice(startIndex).filter(
    (entry) => isActionTerminal(entry) &&
      entry.payload?.requestId === started.payload.requestId
  ).length;
  return { started, terminal, terminalCount };
}

function readTelemetryEntries(context) {
  const logDir = join(context.appDataDir, "logs");
  if (!existsSync(logDir)) {
    return [];
  }
  return readdirSync(logDir)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDir, name))
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs)
    .flatMap((path) => readFileSync(path, "utf8")
      .split(/\r?\n/u)
      .map((line) => parseJson(line))
      .filter(Boolean));
}

function activeRequestIds(entries) {
  const active = new Set();
  for (const entry of entries) {
    const requestId = entry.payload?.requestId;
    if (!isSafeRequestId(requestId)) {
      continue;
    }
    if (entry.type === "pet_interaction_action_started") {
      active.add(requestId);
    } else if (isActionTerminal(entry)) {
      active.delete(requestId);
    }
  }
  return active;
}

function hasAtMostOneActiveRequest(entries) {
  const active = new Set();
  for (const entry of entries) {
    const requestId = entry.payload?.requestId;
    if (!isSafeRequestId(requestId)) {
      continue;
    }
    if (entry.type === "pet_interaction_action_started") {
      active.add(requestId);
    } else if (isActionTerminal(entry)) {
      active.delete(requestId);
    }
    if (active.size > 1) {
      return false;
    }
  }
  return true;
}

function isAffectActionStarted(entry) {
  return entry.type === "pet_interaction_action_started" &&
    AFFECT_ACTION_REASONS.has(entry.payload?.reason);
}

function isActionTerminal(entry) {
  return entry.type === "pet_interaction_action_finished" ||
    entry.type === "pet_interaction_action_skipped";
}

function isSafeRequestId(value) {
  return typeof value === "string" && /^[a-f0-9]{32}$/u.test(value);
}

async function cleanupContext(context, runtimePort) {
  let electronStopped = false;
  const child = context.child;
  try {
    const page = context.pages.find((item) => item?.cdp);
    if (page && child?.exitCode === null && child?.signalCode === null) {
      try {
        await page.cdp.send("Browser.close", {}, 5_000);
      } catch {
        // The browser may close the CDP socket before acknowledging.
      }
    }
    for (const pageItem of context.pages) {
      pageItem?.cdp?.close();
    }
    context.pages = [];
    if (child?.exitCode === null && child?.signalCode === null) {
      try {
        await waitForChildExit(child, 15_000);
      } catch {
        const killed = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          timeout: 15_000
        });
        if (killed.status !== 0 && child.exitCode === null && child.signalCode === null) {
          child.kill();
        }
        await waitForChildExit(child, 10_000);
      }
    }
    electronStopped = !child || child.exitCode !== null || child.signalCode !== null;
  } catch {
    electronStopped = false;
  }

  const cdpPortReleased = await waitForPortClosed(context.port, 10_000);
  const runtimePortReleased = Number.isInteger(runtimePort)
    ? await waitForPortClosed(runtimePort, 15_000)
    : true;
  try {
    cleanupRealUiRun(context);
  } catch {
    // Reported by runnerTmpRemoved below.
  }
  const runnerTmpRemoved = !existsSync(context.runParentDir);
  return { electronStopped, cdpPortReleased, runtimePortReleased, runnerTmpRemoved };
}

async function selectAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("dynamic_port_unavailable")));
        return;
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitForPortClosed(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) {
      return true;
    }
    await sleep(150);
  }
  return !(await isPortOpen(port));
}

function isPortOpen(port) {
  return new Promise((resolveOpen) => {
    const socket = connectSocket({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolveOpen(open);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function validateLocalLlmPack(resourceRoot) {
  const result = spawnSync(process.execPath, ["scripts/p2-20h-validate-local-llm-resources.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: resourceRoot,
      AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: ""
    },
    encoding: "utf8",
    windowsHide: true
  });
  const summary = parseJson(result.stdout?.trim()) ?? {};
  return {
    ok: result.status === 0 && summary.ok === true,
    status: summary.status ?? "validator_failed",
    runtime: summary.runtime,
    resourceRootName: summary.resourceRootName ?? basename(resourceRoot),
    alias: summary.alias,
    executableName: summary.executableName,
    modelName: summary.modelName,
    runtimeIntegrity: summary.runtimeIntegrity,
    modelIntegrity: summary.modelIntegrity,
    safeSummaryOnly: true
  };
}

function hasTaskifyingReply(reply) {
  return /(?:^|\n)\s*[1-3][.、)]|建议你|你应该|你可以先|第一步|第二步|需要做|要不要我帮你/.test(reply);
}

function hasSemanticJokeAcknowledgement(reply) {
  return /(玩笑|开玩笑|逗|调皮|骗到|吓我|虚惊|松口气|原来|这样啊|那就|好[呀啦的]|收到|明白|懂了|笑)/.test(reply);
}

function hasSemanticNegationAcknowledgement(reply) {
  return /(没有|并不|不是|不判断|不替你|明白|知道|收到|了解|陈述|下雨|雨天|天气|雨)/.test(reply);
}

function hasSemanticCorrectionAcknowledgement(reply) {
  return /(玩笑|开玩笑|纠正|没有难过|不再|明白|知道|收到|了解|原来|那就|这样啊|这么回事|骗到(?:我)?|逗到(?:我)?|好[呀啦的]?|嗯(?:嗯)?|哈(?:哈)?|放心|虚惊|松口气)/.test(reply);
}

function parseAcceptanceScope(value) {
  const scope = value ?? "all";
  if (scope === "production" || scope === "bundled" || scope === "all") {
    return scope;
  }
  throw new Error("P2_84_ACCEPTANCE_SCOPE must be production, bundled, or all");
}

function hasDeniedAffectOverread(reply) {
  const withoutNegatedAffect = reply.replace(
    /(?:没有|没在|并不|不是|不)(?:真的|很|有点)?(?:难过|焦虑|低落|紧张)/g,
    "已否定情绪"
  );
  return /(潜意识|内心其实|你其实|你明明|我还是觉得|看得出来|听起来|看起来|感觉你|我能感到|我知道你).{0,12}(难过|焦虑|低落|紧张|创伤)/.test(
    withoutNegatedAffect
  );
}

function hasForcedComfort(reply) {
  return /(别难过|不要难过|一定会好起来|一切都会好起来|振作起来|坚强一点|抱抱你|我会治愈你|你需要(?:治疗|咨询|看医生))/.test(reply);
}

function hasInternalAffectLabel(reply) {
  return /\b(?:unknown|calm|positive|excited|low|tense|tired|quiet-support|warm-positive|gentle-curious|steady-serious|light-playful|gentle-embarrassed|slow-sleepy)\b|(?:kind|confidence|transitionReason|emotionalDialogueContextId)\s*[:=]/i.test(reply);
}

function hasActionResourceLeak(reply) {
  return /state_(?:listen|think|flustered|sleep)|pet:action-trigger|\.motion3\.json|resources[\\/]|expression(?:Id| ID)|action(?:Id| ID)/i.test(reply);
}

function hasDiagnosis(reply) {
  return /诊断|抑郁症|焦虑症|心理疾病|精神疾病|临床|需要治疗|心理医生|精神科/.test(reply);
}

function hasGenericAiIdentity(reply) {
  return /我是(?:一个)?(?:AI|人工智能|语言模型|聊天机器人)|作为(?:一个)?(?:AI|人工智能|语言模型|聊天机器人)|我的身份是(?:AI|人工智能|语言模型|聊天机器人)/i.test(reply);
}

function hasAny(text, values) {
  return values.some((value) => text.includes(value));
}

function containsAny(text, values) {
  return values.some((value) => text.includes(value));
}

function serializeTelemetry(entries) {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

function latestPayload(entries, type, predicate = () => true) {
  return [...entries].reverse().find((entry) =>
    entry.type === type && predicate(entry.payload)
  )?.payload ?? null;
}

function readJsonIfExists(path) {
  return existsSync(path) ? parseJson(readFileSync(path, "utf8")) : null;
}

function sortedKeysEqual(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function assertNoScreenshotResidueSafe(context) {
  try {
    assertNoScreenshotResidue(context);
    return true;
  } catch {
    return false;
  }
}

function summarizeChecks(checks) {
  const values = Object.values(checks);
  return {
    passed: values.filter(Boolean).length,
    total: values.length
  };
}

function sumAssertions(...sections) {
  return sections.reduce((sum, section) => ({
    passed: sum.passed + (section?.assertions?.passed ?? 0),
    total: sum.total + (section?.assertions?.total ?? 0)
  }), { passed: 0, total: 0 });
}

function summarizeProviderStatus(status) {
  return status ? {
    providerId: status.providerId,
    model: status.model,
    baseURLHost: status.baseURLHost,
    isFallback: status.isFallback
  } : null;
}

function summarizeRuntime(runtime) {
  return runtime ? {
    runtime: runtime.runtime,
    bundled: runtime.bundled,
    status: runtime.status,
    executableName: runtime.executableName,
    modelName: runtime.modelName,
    alias: runtime.alias,
    host: runtime.host,
    port: runtime.port
  } : null;
}

function firstFailedCheck(checks) {
  return Object.entries(checks).find(([, value]) => !value)?.[0];
}

function failedSection(mode, error) {
  return {
    ok: false,
    mode,
    durationMs: 0,
    assertions: { passed: 0, total: 1 },
    failureCategory: classifyError(error)
  };
}

function classifyError(error) {
  if (error instanceof ProductionStartupError) {
    const gpuDllLoadFailed = error.attempts.some((attempt) =>
      attempt.diagnostics?.stderrTail?.some((line) =>
        line.includes("GPU process exited unexpectedly: exit_code=-1073741515")
      )
    );
    if (gpuDllLoadFailed) {
      return "production_startup_gpu_child_dll_load_failed";
    }
    return `production_startup_${error.stage}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message === "send_timeout" || message === "provider_chat_failed" ||
    message === "embedded_runtime_timeout" || message === "embedded_provider_timeout" ||
    message === "telemetry_wait_timeout" || message === "action_idle_timeout") {
    return message;
  }
  if (/Target not found|Timed out waiting/.test(message)) {
    return "ui_not_ready";
  }
  if (/CDP timeout/.test(message)) {
    return "cdp_timeout";
  }
  return "script_failed";
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function readPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
