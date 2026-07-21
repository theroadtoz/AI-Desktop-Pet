import {
  assertNoScreenshotResidue,
  chatUiSelectors,
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  sleep,
  startElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createWindowsNativeClickArgs } from "./support/p2-83a-native-click-contract.mjs";
import { calculateRunnerTotalTimeoutMs } from "./support/p2-83a-runner-budget.mjs";
import {
  isSameOwnedProcessIdentity,
  isTaskkillFailureIdempotent,
  mergeOwnedProcessIdentities,
  parseOwnedProcessIdentities,
  selectInitialOwnedRootIdentity,
  summarizeOwnedProcessSurvivors
} from "./support/p2-83a-owned-process-identity.mjs";

const NEGATIVE_SCENARIO_STABLE_MS = Math.min(
  2_000,
  Math.max(100, Number(process.env.P2_83A_NEGATIVE_STABLE_MS || 500))
);
const APPEARANCE_STARTED_OBSERVATION_MS = Math.min(
  2_000,
  Math.max(100, Number(process.env.P2_83A_APPEARANCE_OBSERVATION_MS || 600))
);
const CANDIDATE_RENDER_GRACE_MS = 250;
const SAFE_CANDIDATE_STATUSES = new Set(["queued", "attempted", "shown", "skipped", "expired"]);
const SAFE_CANDIDATE_SKIP_REASONS = new Set([
  "action_handshake_timeout", "action_request_rejected", "action_skipped", "bubble_send_failed",
  "bubble_visible", "chat_interaction_active", "chat_visible", "class_cooldown", "cleared",
  "daily_class_limit", "daily_total_limit", "engagement_blocked", "global_cooldown",
  "high_priority_action_active", "interruptibility_not_allowed", "line_cooldown", "model_busy",
  "pet_not_ready", "pet_window_missing", "proactive_bubbles_off", "replaced_by_same_class",
  "same_class_attempt_in_progress", "source_disabled", "startup_daily_limit", "system_unavailable",
  "ttl_expired"
]);
const SAFE_ACTION_LIFECYCLES = new Map([
  ["pet_interaction_action_started", "started"],
  ["pet_interaction_action_finished", "finished"],
  ["pet_interaction_action_skipped", "skipped"]
]);
const SAFE_ACTION_TERMINAL_STATUSES = new Set(["completed", "interrupted", "timed_out", "failed"]);
const SAFE_CLEANUP_STAGES = new Set([
  "connection_close", "owned_process_snapshot", "native_cursor_neutralize",
  "owned_process_kill", "owned_process_wait", "hwnd_invalidation", "user_data_removal"
]);
const SAFE_CLEANUP_REASONS = new Set([
  "connection_close_failed", "owned_process_snapshot_failed", "native_cursor_neutralize_failed",
  "owned_process_kill_failed", "owned_process_wait_failed", "hwnd_invalidation_failed",
  "user_data_removal_failed"
]);
class CandidateDiagnosticError extends Error {
  constructor(code, diagnostic) {
    super(code);
    this.name = "CandidateDiagnosticError";
    this.diagnostic = diagnostic;
  }
}
class CleanupStageError extends Error {
  constructor(stage, reason, diagnostic = null) {
    super(reason);
    this.name = "CleanupStageError";
    this.cleanupStage = stage;
    this.cleanupReason = reason;
    this.cleanupDiagnostic = diagnostic;
  }
}
class OwnedProcessCleanupError extends Error {
  constructor(code, survivors) {
    super(code);
    this.name = "OwnedProcessCleanupError";
    this.cleanupDiagnostic = summarizeOwnedProcessSurvivors(survivors);
  }
}
class OverlayRegionDiagnosticError extends Error {
  constructor(code, regionState, safeReason) {
    super(code);
    this.name = "OverlayRegionDiagnosticError";
    this.regionState = regionState;
    this.safeReason = safeReason;
  }
}
const allCases = [
  { candidateId: "search_citation_safe", lineId: "idle_presence_search_citation", reason: "source_presence", actionReason: "state_search_cited", layout: "right-half", activate: true },
  { candidateId: "music_started", lineId: "environment_music_started", reason: "music_presence", actionReason: "state_music_playing_stable", layout: "narrow" },
  { candidateId: "explicit_game_started", lineId: "environment_game_started", reason: "game_presence", actionReason: "state_game_presence_stable" },
  { candidateId: "returned_from_away", lineId: "environment_returned_from_away", reason: "return_presence", actionReason: "return_from_idle" },
  { candidateId: "evening_companion", lineId: "idle_presence_evening", reason: "evening_presence", actionReason: "evening_companion_tick" },
  { candidateId: "long_silence", lineId: "idle_presence_soft", reason: "silence_presence", actionReason: "state_listen", scenario: "quiet", expectShown: false, expectedSkip: "daily_total_limit" },
  { candidateId: "memory_safe", lineId: "idle_presence_memory_safe", reason: "source_presence", actionReason: "state_memory_injected", scenario: "off", expectShown: false },
  { candidateId: "history_summary_safe", lineId: "idle_presence_history_summary", reason: "source_presence", actionReason: "state_proactive_bubble_visible", scenario: "busy", expectShown: false }
];
const cases = process.env.P2_83A_CASE
  ? allCases.filter(({ candidateId, scenario }) =>
    candidateId === process.env.P2_83A_CASE || scenario === process.env.P2_83A_CASE)
  : allCases;
const RUNNER_TOTAL_TIMEOUT_MS = calculateRunnerTotalTimeoutMs(
  cases.length,
  process.env.P2_83A_TOTAL_TIMEOUT_MS
);

const observations = [];
const activeContexts = new Set();
let failed = false;
const abortController = new AbortController();
const totalTimeout = setTimeout(() => {
  abortController.abort(new Error("runner_total_timeout"));
}, RUNNER_TOTAL_TIMEOUT_MS);
totalTimeout.unref?.();

try {
  await runCases(abortController.signal);
} catch (error) {
  failed = true;
  observations.push({
    caseId: "runner",
    ok: false,
    errorCode: error instanceof Error && error.message === "runner_total_timeout"
      ? "runner_total_timeout"
      : "runner_error",
    ...readSafeCleanupDiagnostic(error)
  });
} finally {
  clearTimeout(totalTimeout);
  const cleanupResults = await Promise.allSettled([...activeContexts].map(stopAndCleanupContext));
  for (const result of cleanupResults) {
    if (result.status !== "rejected") continue;
    failed = true;
    observations.push({
      caseId: "runner_cleanup",
      ok: false,
      errorCode: "runner_error",
      ...readSafeCleanupDiagnostic(result.reason)
    });
  }
}

const summary = {
  ok: !failed,
  runtime: "production Electron renderer and main process",
  evidenceBoundary: "closed safe candidate policy injection; not real OS media/game, local model, or MCP evidence",
  scenarioInjection: "closed quiet/off/busy acceptance settings and isolated quiet budget ledger; no user or environment content",
  inputEvidence: "Windows SetCursorPos plus SendInput screen-coordinate click and resulting chat focus",
  screenshotCount: 0,
  observations
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failed) process.exitCode = 1;

async function runCases(signal) {
  for (let index = 0; index < cases.length; index += 1) {
    throwIfAborted(signal);
    const testCase = cases[index];
    const scenario = testCase.scenario ?? "normal";
    const context = createRealUiRunContext({
      runName: `p2-83a-proactive-bubble-${testCase.candidateId}-${scenario}`,
      port: Number(process.env.P2_83A_CDP_PORT || 9720) + index,
      env: {
        AI_DESKTOP_PET_PROVIDER: "fake",
        AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
        AI_DESKTOP_PET_P2_83A_SAFE_INJECTION: "1",
        AI_DESKTOP_PET_P2_83A_SCENARIO: scenario
      },
      tmpResiduePatterns: [/^p2-83a-proactive-bubble-/i]
    });
    activeContexts.add(context);
    let stage = "startup";

    try {
      if (scenario === "quiet") prepareExhaustedQuietLedger(context);
      throwIfAborted(signal);
      const child = startElectron(context);
      const initialIdentities = captureOwnedProcessTree(child.pid, process.pid, "electron.exe");
      const fixedRootIdentity = selectInitialOwnedRootIdentity({
        pid: child.pid,
        identities: initialIdentities
      });
      if (!fixedRootIdentity || child.exitCode !== null) throw new Error("owned_root_identity_capture_failed");
      context.p283aOwnedRootIdentity = fixedRootIdentity;
      context.p283aOwnedRootPid = fixedRootIdentity.pid;
      context.p283aOwnedIdentities = [fixedRootIdentity];
      context.p283aOwnedIdentityFile = writeOwnedProcessIdentityFile(context, [fixedRootIdentity]);
      stage = "connect";
      await runStep(signal, () => connectToElectron(context));
      stage = "pet_window";
      const pet = await runStep(signal, () => waitForWindow(context, "renderer/pet/index.html"));
      await runStep(signal, () => waitFor(pet, "Boolean(window.petApi)"));
      context.p283aNativeHwnd = await runStep(signal, () => evaluate(
        pet,
        "window.petApi.getNativeWindowHandleForAcceptance()"
      ));
      stage = "first_frame";
      await runStep(signal, () => waitForTelemetry(context, (event) =>
        event.type === "first_frame", 15_000));
      stage = "appearance_observation";
      await runStep(signal, () => observeAppearanceLifecycle(context));
      if (testCase.expectShown === false) {
        stage = "negative_stable";
        await runStep(signal, () => sleep(NEGATIVE_SCENARIO_STABLE_MS));
      }
      stage = "layout";
      await runStep(signal, () => configureLayout(pet, testCase.layout));
      if (testCase.expectShown !== false) {
        await runStep(signal, () => sleep(Number(process.env.P2_83A_APPEARANCE_SETTLE_MS || 1_000)));
      }

      stage = "candidate_injection";
      const candidateTelemetryStartIndex = readTelemetryEvents(context).length;
      const injectionAccepted = await runStep(signal, () => evaluate(
        pet,
        `window.petApi.injectProactiveBubbleCandidateForAcceptance(${JSON.stringify(testCase.candidateId)})`
      ));
      if (!injectionAccepted) throw new Error("safe_candidate_injection_rejected");

      if (testCase.expectShown === false) {
        await runStep(signal, () => sleep(1_200));
        const hidden = await runStep(signal, () => evaluate(
          pet,
          `document.querySelector("#proactive-speech-bubble")?.dataset.state !== "visible"`
        ));
        const decision = readTelemetryEvents(context).find((event) =>
          event.type === "proactive_bubble_candidate" &&
          event.payload?.candidateId === testCase.candidateId &&
          event.payload?.status === "skipped");
        const skipVerified = !testCase.expectedSkip || decision?.payload?.skipReason === testCase.expectedSkip;
        observations.push({
          candidateId: testCase.candidateId,
          scenario,
          hidden,
          skipReason: decision?.payload?.skipReason ?? null,
          ok: hidden === true && skipVerified
        });
        failed ||= hidden !== true || !skipVerified;
        assertNoScreenshotResidue(context);
        continue;
      }

      stage = "bubble_visible";
      await runStep(signal, () => waitForBubbleVisibleWithDiagnostics(
        context,
        pet,
        testCase,
        candidateTelemetryStartIndex,
        8_000
      ));
      stage = "overlay_region_registered";
      await runStep(signal, () => waitForOverlayRegionRegistration(
        context,
        candidateTelemetryStartIndex,
        3_000
      ));

      const layout = await runStep(signal, () => readLayout(pet, testCase.layout));
      let activation = null;
      if (testCase.activate) {
        stage = "native_hover";
        const overlayHitEventCount = readTelemetryEvents(context).length;
        const nativeTarget = await runStep(signal, () => readWindowsNativeTarget(context, pet, "#proactive-speech-bubble"));
        await runStep(signal, () => prepareWindowsNativeBubbleHit(nativeTarget));
        stage = "overlay_hit_active";
        await runStep(signal, () => waitForTelemetryAfter(context, overlayHitEventCount, (event) =>
          event.type === "proactive_bubble_overlay_hit_changed" &&
          event.payload?.overlayHitState === "active" &&
          event.payload?.overlayHitAuthority === "main_poll", 3_000));
        stage = "native_click";
        await runStep(signal, () => dispatchWindowsNativeClick(nativeTarget));
        stage = "chat_window";
        const chat = await runStep(signal, () => waitForWindow(context, "renderer/chat/index.html"));
        stage = "chat_focus";
        await runStep(signal, () => waitFor(chat, `document.activeElement?.matches(${JSON.stringify(chatUiSelectors.chat.input)})`, {
          timeoutMs: 8_000
        }));
        activation = await runStep(signal, () => evaluate(chat, `({
          focused: document.activeElement?.matches(${JSON.stringify(chatUiSelectors.chat.input)}) === true,
          messageCount: document.querySelectorAll("#messages .message").length,
          inputValue: document.querySelector(${JSON.stringify(chatUiSelectors.chat.input)})?.value ?? null
        })`));
      }

      const ok = layout.tagName === "BUTTON" && layout.tabIndex === 0 &&
        layout.ariaHidden === "false" && layout.withinViewport && layout.textFits &&
        layout.textLength > 0 && layout.layoutCovered &&
        layout.datasetKeys.every((key) => ["lineId", "reason", "state"].includes(key)) &&
        (!activation || (activation.focused && activation.messageCount === 0 && activation.inputValue === ""));
      observations.push({ candidateId: testCase.candidateId, scenario, layout, activation, ok });
      failed ||= !ok;
      assertNoScreenshotResidue(context);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      observations.push({
        candidateId: testCase.candidateId,
        scenario,
        ok: false,
        stage,
        errorCode: classifyError(error),
        errorDetail: safeErrorDetail(error),
        ...readSafeCandidateDiagnostic(error),
        ...readSafeOverlayRegionDiagnostic(error)
      });
      failed = true;
    } finally {
      await stopAndCleanupContext(context);
    }
  }
}

async function waitForBubbleVisibleWithDiagnostics(context, page, testCase, startIndex, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let shownObservedAtMs = null;
  while (Date.now() < deadline) {
    const visible = await evaluate(page, `
      (() => {
        const bubble = document.querySelector("#proactive-speech-bubble");
        return bubble?.dataset.state === "visible" &&
          bubble?.dataset.lineId === ${JSON.stringify(testCase.lineId)} &&
          bubble?.dataset.reason === ${JSON.stringify(testCase.reason)};
      })()
    `);
    if (visible) return;

    const diagnostic = collectSafeCandidateDiagnostic(
      readTelemetryEvents(context).slice(startIndex),
      testCase
    );
    if (diagnostic.status === "skipped" || diagnostic.status === "expired" ||
      diagnostic.safeReason === "action_handshake_timeout" ||
      diagnostic.actionTerminalStatus === "timed_out") {
      throw new CandidateDiagnosticError("candidate_terminal_before_bubble_visible", diagnostic);
    }
    if (diagnostic.status === "shown") {
      shownObservedAtMs ??= Date.now();
      if (Date.now() - shownObservedAtMs >= CANDIDATE_RENDER_GRACE_MS) {
        throw new CandidateDiagnosticError("candidate_shown_without_visible_bubble", diagnostic);
      }
    }
    await sleep(50);
  }
  throw new CandidateDiagnosticError(
    "bubble_visible_timeout_with_candidate_diagnostic",
    collectSafeCandidateDiagnostic(readTelemetryEvents(context).slice(startIndex), testCase)
  );
}

function collectSafeCandidateDiagnostic(events, testCase) {
  const candidateEvents = events.filter((event) =>
    event.type === "proactive_bubble_candidate" &&
    event.payload?.candidateId === testCase.candidateId);
  const candidateEvent = candidateEvents.at(-1);
  const status = SAFE_CANDIDATE_STATUSES.has(candidateEvent?.payload?.status)
    ? candidateEvent.payload.status
    : null;
  const skipReason = SAFE_CANDIDATE_SKIP_REASONS.has(candidateEvent?.payload?.skipReason)
    ? candidateEvent.payload.skipReason
    : null;
  const actionEvents = events.filter((event) =>
    SAFE_ACTION_LIFECYCLES.has(event.type) && event.payload?.reason === testCase.actionReason);
  const actionEvent = actionEvents.at(-1);
  const actionLifecycle = SAFE_ACTION_LIFECYCLES.get(actionEvent?.type) ?? null;
  const actionTerminalStatus = SAFE_ACTION_TERMINAL_STATUSES.has(actionEvent?.payload?.terminalStatus)
    ? actionEvent.payload.terminalStatus
    : null;
  return {
    candidate: testCase.candidateId,
    status,
    safeReason: skipReason,
    actionLifecycle,
    actionTerminalStatus
  };
}

function readSafeCandidateDiagnostic(error) {
  return error instanceof CandidateDiagnosticError ? error.diagnostic : {};
}

function readSafeCleanupDiagnostic(error) {
  if (!(error instanceof CleanupStageError) ||
    !SAFE_CLEANUP_STAGES.has(error.cleanupStage) ||
    !SAFE_CLEANUP_REASONS.has(error.cleanupReason)) {
    return {};
  }
  return {
    cleanupStage: error.cleanupStage,
    cleanupReason: error.cleanupReason,
    ...readOwnedProcessCleanupDiagnostic(error.cleanupDiagnostic)
  };
}

function readOwnedProcessCleanupDiagnostic(value) {
  if (!value || !Number.isSafeInteger(value.survivorCount) || value.survivorCount < 0 ||
    typeof value.rootAlive !== "boolean" ||
    !Number.isSafeInteger(value.descendantAliveCount) || value.descendantAliveCount < 0 ||
    value.survivorCount !== value.descendantAliveCount + (value.rootAlive ? 1 : 0)) {
    return {};
  }
  return {
    survivorCount: value.survivorCount,
    rootAlive: value.rootAlive,
    descendantAliveCount: value.descendantAliveCount
  };
}

function readSafeOverlayRegionDiagnostic(error) {
  return error instanceof OverlayRegionDiagnosticError
    ? { regionState: error.regionState, safeReason: error.safeReason }
    : {};
}

async function waitForOverlayRegionRegistration(context, startIndex, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = readTelemetryEvents(context).slice(startIndex).filter((event) =>
      event.type === "proactive_bubble_overlay_region_changed" &&
      event.payload?.authority === "main");
    for (const event of events) {
      if (event.payload?.regionState === "rejected") {
        throw new OverlayRegionDiagnosticError("overlay_region_rejected", "rejected", "region_rejected");
      }
      if (event.payload?.regionState === "registered") {
        return;
      }
    }
    await sleep(50);
  }
  throw new OverlayRegionDiagnosticError("overlay_region_registration_timeout", null, "region_registration_timeout");
}

async function configureLayout(page, layout) {
  if (layout === "narrow") {
    await page.cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 480,
      deviceScaleFactor: 1,
      mobile: false
    });
  }
  if (layout === "right-half") {
    const display = await evaluate(page, `({
      availLeft: screen.availLeft,
      availTop: screen.availTop,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      width: outerWidth,
      height: outerHeight
    })`);
    await evaluate(page, `window.moveTo(
      ${display.availLeft + display.availWidth - display.width},
      ${display.availTop + display.availHeight - Math.round(display.height * 0.55)}
    )`);
    await sleep(300);
  }
}

async function readLayout(page, layout) {
  return evaluate(page, `
    (() => {
      const bubble = document.querySelector("#proactive-speech-bubble");
      const rect = bubble.getBoundingClientRect();
      const rightAligned = Math.abs(screenX + outerWidth - (screen.availLeft + screen.availWidth)) <= 6;
      const lowerBodyOutside = screenY + outerHeight > screen.availTop + screen.availHeight;
      return {
        tagName: bubble.tagName,
        tabIndex: bubble.tabIndex,
        ariaHidden: bubble.getAttribute("aria-hidden"),
        datasetKeys: Object.keys(bubble.dataset).sort(),
        withinViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        textFits: bubble.scrollWidth <= bubble.clientWidth && bubble.scrollHeight <= bubble.clientHeight,
        textLength: bubble.textContent.length,
        layoutCovered: ${JSON.stringify(layout ?? "normal")} === "narrow"
          ? innerWidth === 320
          : ${JSON.stringify(layout ?? "normal")} === "right-half"
            ? rightAligned && lowerBodyOutside
            : true
      };
    })()
  `);
}

async function readWindowsNativeTarget(context, page, selector) {
  const point = await evaluate(page, `
    (() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error("bubble_missing_for_coordinate_click");
      const rect = node.getBoundingClientRect();
      return {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        deviceScaleFactor: window.devicePixelRatio
      };
    })()
  `);
  const expectedHwnd = await evaluate(page, "window.petApi.getNativeWindowHandleForAcceptance()");
  const expectedPid = context.child?.pid;
  if (!/^\d{1,20}$/u.test(expectedHwnd ?? "") || !Number.isSafeInteger(expectedPid) || expectedPid <= 0) {
    throw new Error("native_window_target_unavailable");
  }
  return { ...point, expectedHwnd, expectedPid };
}

function runWindowsNativeMouse(target, extraArgs) {
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", join(process.cwd(), "scripts", "p2-83a-sendinput-click.ps1"),
    ...createWindowsNativeClickArgs({
      expectedHwnd: target.expectedHwnd,
      expectedPid: target.expectedPid,
      clientX: target.clientX,
      clientY: target.clientY,
      deviceScaleFactor: target.deviceScaleFactor
    }),
    "-PollIntervalMilliseconds", "25",
    "-ActivationTimeoutMilliseconds", "2000",
    "-OutsideSettleMilliseconds", "60",
    ...extraArgs
  ], {
    windowsHide: true,
    encoding: "utf8",
    timeout: 10_000
  });
  if (result.status !== 0) {
    const safeFailure = String(result.stderr || "unknown").trim().slice(0, 180);
    throw new Error(`windows_sendinput_failed: ${safeFailure}`);
  }
}

function prepareWindowsNativeBubbleHit(target) {
  runWindowsNativeMouse(target, ["-PrepareOnly", "-KeepCursorAtTarget"]);
}

function dispatchWindowsNativeClick(target) {
  runWindowsNativeMouse(target, []);
}

async function runStep(signal, operation) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("runner_total_timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => {
      throwIfAborted(signal);
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function throwIfAborted(signal) {
  if (signal.aborted) throw signal.reason ?? new Error("runner_total_timeout");
}

function prepareExhaustedQuietLedger(context) {
  const now = new Date();
  const dateKey = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  const configDir = join(context.appDataDir, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "proactive-bubble-ledger.json"), `${JSON.stringify({
    schemaVersion: 1,
    dateKey,
    dailyTotal: 2,
    dailyClassCounts: { environment: 1, silence: 1 },
    lastShownAtMs: null,
    lastClassShownAtMs: {},
    lastLineShownAtMs: {},
    startupDateKey: dateKey
  }, null, 2)}\n`, "utf8");
}

async function stopAndCleanupContext(context) {
  if (!activeContexts.has(context)) return;
  context.p283aOwnedChild ??= context.child;
  const ownedPid = context.p283aOwnedRootPid ?? context.child?.pid;
  if (Number.isSafeInteger(ownedPid) && ownedPid > 0) context.p283aOwnedRootPid = ownedPid;
  const expectedHwnd = /^\d{1,20}$/u.test(context.p283aNativeHwnd ?? "")
    ? context.p283aNativeHwnd
    : "0";
  let cleanupError = null;
  let ownedIdentities = Array.isArray(context.p283aOwnedIdentities)
    ? [...context.p283aOwnedIdentities]
    : [];
  let identityFile = context.p283aOwnedIdentityFile ?? null;
  let rootIdentityValidated = false;
  async function cleanupStep(stage, reason, operation) {
    try {
      await operation();
    } catch (error) {
      cleanupError ??= new CleanupStageError(stage, reason, error?.cleanupDiagnostic);
    }
  }

  await cleanupStep("connection_close", "connection_close_failed", () => closeContextConnections(context));
  await cleanupStep("owned_process_snapshot", "owned_process_snapshot_failed", () => {
    const fixedRootIdentity = context.p283aOwnedRootIdentity;
    if (fixedRootIdentity && identityFile) {
      const currentRoot = probeOwnedProcessIdentities(identityFile)
        .find((identity) => identity.role === "root");
      if (!isSameOwnedProcessIdentity(fixedRootIdentity, currentRoot)) {
        ownedIdentities = [];
        identityFile = null;
        context.p283aOwnedIdentities = [];
        return;
      }
      rootIdentityValidated = true;
      const captured = captureOwnedProcessTree(ownedPid, process.pid, "electron.exe");
      const capturedRoot = captured.find((identity) => identity.role === "root");
      if (!isSameOwnedProcessIdentity(fixedRootIdentity, capturedRoot)) {
        rootIdentityValidated = false;
        ownedIdentities = [];
        identityFile = null;
        context.p283aOwnedIdentities = [];
        return;
      }
      ownedIdentities = mergeOwnedProcessIdentities(ownedIdentities, captured);
      context.p283aOwnedIdentities = [...ownedIdentities];
      identityFile = writeOwnedProcessIdentityFile(context, ownedIdentities);
      context.p283aOwnedIdentityFile = identityFile;
    }
  });
  await cleanupStep("native_cursor_neutralize", "native_cursor_neutralize_failed", () => {
    moveCursorToNeutralPosition(expectedHwnd);
  });
  await cleanupStep("owned_process_kill", "owned_process_kill_failed", () => {
    if (rootIdentityValidated && ownedIdentities.length > 0 && identityFile) {
      killOwnedElectronTree(context, identityFile);
    } else {
      context.child = null;
    }
  });
  await cleanupStep("owned_process_wait", "owned_process_wait_failed", () => {
    if (rootIdentityValidated && ownedIdentities.length > 0 && identityFile) waitForOwnedProcessTreeExit(identityFile, 8_000, true);
  });
  await cleanupStep("hwnd_invalidation", "hwnd_invalidation_failed", () => {
    if (rootIdentityValidated && ownedIdentities.length > 0 && identityFile && probeOwnedProcessIdentities(identityFile).length > 0) {
      waitForOldHwndInvalidation(expectedHwnd, identityFile);
    }
  });
  if (!cleanupError) {
    await cleanupStep("user_data_removal", "user_data_removal_failed", () => {
      closeOwnedProcessLogStreams(context.p283aOwnedChild);
      if (process.env.P2_83A_KEEP_TMP !== "1") cleanupRealUiRun(context);
    });
  }

  if (!cleanupError) activeContexts.delete(context);
  if (cleanupError) throw cleanupError;
}

function closeOwnedProcessLogStreams(child) {
  for (const stream of [child?.stdout, child?.stderr]) {
    stream?.removeAllListeners("data");
    stream?.destroy();
  }
}

function closeContextConnections(context) {
  const seen = new Set();
  let closeError = null;
  for (const page of context.pages ?? []) {
    if (!page?.cdp || seen.has(page.cdp)) continue;
    seen.add(page.cdp);
    try {
      page.cdp.close();
    } catch (error) {
      closeError ??= error;
    }
  }
  context.pages = [];
  if (closeError) throw closeError;
}

function moveCursorToNeutralPosition(expectedHwnd) {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", join(process.cwd(), "scripts", "p2-83a-neutralize-cursor.ps1"),
    "-ExpectedHwnd", expectedHwnd
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) throw new Error("cursor_neutralization_failed");
}

function captureOwnedProcessTree(rootPid, expectedParentPid, expectedRootName) {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", join(process.cwd(), "scripts", "p2-83a-capture-process-tree.ps1"),
    "-RootPid", String(rootPid),
    "-ExpectedParentPid", String(expectedParentPid),
    "-ExpectedRootName", expectedRootName
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) throw new Error("owned_process_tree_capture_failed");
  const parsed = JSON.parse(result.stdout);
  return parseOwnedProcessIdentities(parsed);
}

function writeOwnedProcessIdentityFile(context, identities) {
  mkdirSync(context.runDir, { recursive: true });
  const path = join(context.runDir, "owned-process-identities.json");
  writeFileSync(path, `${JSON.stringify(identities)}\n`, "utf8");
  return path;
}

function waitForOwnedProcessTreeExit(identityFile, timeoutMilliseconds, throwOnTimeout) {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", join(process.cwd(), "scripts", "p2-83a-wait-owned-exit.ps1"),
    "-IdentityFile", identityFile,
    "-TimeoutMilliseconds", String(timeoutMilliseconds)
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  const diagnostic = parseOwnedProcessCleanupDiagnostic(result.stderr);
  if (!diagnostic) throw new Error("owned_process_wait_failed");
  if (throwOnTimeout) {
    const error = new Error("owned_process_tree_exit_timeout");
    error.cleanupDiagnostic = diagnostic;
    throw error;
  }
  return false;
}

function probeOwnedProcessIdentities(identityFile) {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", join(process.cwd(), "scripts", "p2-83a-probe-owned-process-identities.ps1"),
    "-IdentityFile", identityFile
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("owned_process_probe_failed");
  return parseOwnedProcessIdentities(JSON.parse(result.stdout));
}

function parseOwnedProcessCleanupDiagnostic(text) {
  try {
    return readOwnedProcessCleanupDiagnostic(JSON.parse(String(text).trim()));
  } catch {
    return null;
  }
}

function waitForOldHwndInvalidation(expectedHwnd, identityFile) {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", join(process.cwd(), "scripts", "p2-83a-wait-hwnd-invalid.ps1"),
    "-ExpectedHwnd", expectedHwnd,
    "-IdentityFile", identityFile,
    "-TimeoutMilliseconds", "8_000"
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) throw new Error("old_hwnd_invalidation_timeout");
}

async function waitForTelemetry(context, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = readTelemetryEvents(context).find(predicate);
    if (event) return event;
    await sleep(150);
  }
  throw new Error("telemetry_wait_timeout");
}

async function waitForTelemetryAfter(context, startIndex, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = readTelemetryEvents(context).slice(startIndex).find(predicate);
    if (event) return event;
    await sleep(50);
  }
  throw new Error("telemetry_wait_timeout");
}

async function observeAppearanceLifecycle(context) {
  const observationDeadline = Date.now() + APPEARANCE_STARTED_OBSERVATION_MS;
  let startedIndex = -1;
  while (Date.now() <= observationDeadline) {
    const events = readTelemetryEvents(context);
    startedIndex = events.findIndex((event) =>
      event.type === "pet_interaction_action_started" && event.payload?.type === "appearance");
    if (startedIndex >= 0) break;
    await sleep(50);
  }
  if (startedIndex < 0) return "not_started";

  const terminalDeadline = Date.now() + 30_000;
  while (Date.now() <= terminalDeadline) {
    const events = readTelemetryEvents(context);
    const terminal = events.slice(startedIndex + 1).find((event) =>
      (event.type === "pet_interaction_action_finished" ||
        event.type === "pet_interaction_action_skipped") &&
      event.payload?.type === "appearance");
    if (terminal) return terminal.type;
    await sleep(100);
  }
  throw new Error("appearance_terminal_timeout");
}

function readTelemetryEvents(context) {
  const logDir = join(context.appDataDir, "logs");
  if (!existsSync(logDir)) return [];
  const events = [];
  for (const name of readdirSync(logDir).filter((item) => item.startsWith("telemetry-") && item.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(logDir, name), "utf8").split(/\r?\n/u)) {
      try {
        if (line.trim()) events.push(JSON.parse(line));
      } catch {
        // The final telemetry line can be partially flushed while Electron is running.
      }
    }
  }
  return events;
}

function classifyError(error) {
  if (!(error instanceof Error)) return "runner_error";
  if (error instanceof CandidateDiagnosticError) return error.message;
  if (error instanceof OverlayRegionDiagnosticError) return error.message;
  if (error.message.includes("safe_candidate_injection_rejected")) return "safe_candidate_injection_rejected";
  if (error.message.includes("Timed out waiting")) return "bubble_wait_timeout";
  return "runner_error";
}

function safeErrorDetail(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(process.cwd(), "<workspace>").slice(0, 240);
}

function killOwnedElectronTree(context, identityFile) {
  if (process.platform !== "win32") {
    context.child = null;
    return;
  }
  const maxRounds = 3;
  for (let round = 0; round < maxRounds; round += 1) {
    const survivors = probeOwnedProcessIdentities(identityFile);
    if (survivors.length === 0) break;
    const ordered = [...survivors].sort((left, right) =>
      Number(left.role === "root") - Number(right.role === "root"));
    for (const identity of ordered) {
      const stillMatching = probeOwnedProcessIdentities(identityFile).some((current) =>
        isSameOwnedProcessIdentity(identity, current));
      if (!stillMatching) continue;
      const result = spawnSync("taskkill.exe", ["/PID", String(identity.pid), "/F"], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 10_000
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        const afterFailure = probeOwnedProcessIdentities(identityFile);
        if (!isTaskkillFailureIdempotent(identity, afterFailure)) {
          throw new OwnedProcessCleanupError("owned_process_kill_failed", afterFailure);
        }
      }
    }
    if (waitForOwnedProcessTreeExit(identityFile, 350, false)) break;
  }
  const survivors = probeOwnedProcessIdentities(identityFile);
  if (survivors.length > 0) {
    throw new OwnedProcessCleanupError("owned_process_kill_failed", survivors);
  }
  context.child = null;
}
