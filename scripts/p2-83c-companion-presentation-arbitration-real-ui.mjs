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
  waitForChildExit,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createWindowsNativeClickArgs } from "./support/p2-83a-native-click-contract.mjs";
import {
  isSameOwnedProcessIdentity,
  isTaskkillFailureIdempotent,
  mergeOwnedProcessIdentities,
  parseOwnedProcessIdentities,
  selectInitialOwnedRootIdentity
} from "./support/p2-83a-owned-process-identity.mjs";

const CANDIDATE_ID = "search_citation_safe";
const PROACTIVE_REASON = "state_search_cited";
const CHAT_REASON = "chat_opened";
const RENDERER_LOCAL_REASON = "click_head";
const SAFE_CLEANUP_STAGES = new Set([
  "connection_close", "owned_process_snapshot", "native_cursor_neutralize",
  "owned_process_kill", "owned_process_wait", "hwnd_invalidation", "spawned_child_fallback",
  "user_data_removal"
]);
const SAFE_CLEANUP_REASONS = new Set([
  "connection_close_failed", "owned_process_snapshot_failed", "native_cursor_neutralize_failed",
  "owned_process_kill_failed", "owned_process_wait_failed", "hwnd_invalidation_failed", "spawned_child_fallback_failed",
  "user_data_removal_failed"
]);
const RUNNER_TOTAL_TIMEOUT_MS = Math.min(
  120_000,
  Math.max(45_000, Number(process.env.P2_83C_TOTAL_TIMEOUT_MS || 75_000))
);

class CleanupStageError extends Error {
  constructor(stage, reason) {
    super(reason);
    this.cleanupStage = stage;
    this.cleanupReason = reason;
  }
}

  if (process.argv.includes("--compile-native-helper-only")) {
  try {
    const result = compileVirtualScreenNativeClickHelperOnly();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "native_helper_compile_failed"}\n`);
    process.exit(1);
  }
}

if (process.argv.includes("--test-early-capture-cleanup")) {
  try {
    const result = await runEarlyCaptureCleanupSelfTest();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "early_capture_cleanup_test_failed"}\n`);
    process.exit(1);
  }
}

const context = createRealUiRunContext({
  runName: "p2-83c-companion-presentation-arbitration",
  port: await selectAvailableCdpPort(),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake",
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
    AI_DESKTOP_PET_P2_83A_SAFE_INJECTION: "1"
  },
  tmpResiduePatterns: [/^p2-83c-companion-presentation-arbitration-/i]
});
// The shared harness reads this field from its returned context.
context.electronArgs = ["--use-angle=swiftshader"];
const observation = {
  rendererLocalStarted: false,
  rendererLocalTerminal: false,
  rendererLocalActionInstanceSafe: false,
  rendererLocalLifecycleObserved: false,
  actionFirstStarted: false,
  proactiveRequestIdSafe: false,
  proactiveBubbleShown: false,
  proactiveTerminalBeforeChatStarted: false,
  proactiveSingleTerminal: false,
  noProactiveRestartAfterChat: false,
  noSecondProactiveTerminalAfterChat: false,
  chatOpenedStarted: false,
  chatRequestIdSafe: false,
  requestIdsDiffer: false,
  bubbleHiddenAfterChat: false,
  noConcurrentActiveRequests: false,
  proactiveLifecycleCount: 0,
  chatLifecycleCount: 0,
  candidateInjectionAccepted: false,
  candidateDecisionStatus: null,
  candidateSkipReason: null,
  startupPresentationLifecycle: null,
  chatTerminalObserved: false,
  nativeInput: null,
  stage: "startup",
  cleanupCompleted: false
};
let failed = false;
let errorCode = null;
let failureDetail = null;
let totalTimeout = null;

try {
  await new Promise((resolve, reject) => {
    totalTimeout = setTimeout(() => reject(new Error("runner_total_timeout")), RUNNER_TOTAL_TIMEOUT_MS);
    totalTimeout.unref?.();
    runScenario().then(resolve, reject);
  });
} catch (error) {
  captureCandidateDecisionObservation(context);
  refreshLifecycleObservations(context);
  if (observation.stage === "renderer_local_action" && observation.nativeInput) {
    const rendererEvents = readTelemetryEvents(context);
    observation.nativeInput.rendererEventCountAfter = rendererEvents.length;
    observation.nativeInput.rendererLifecycleEventCountAfter = rendererEvents.filter((event) =>
      isActionLifecycleEvent(event) && event.payload?.reason === RENDERER_LOCAL_REASON).length;
  }
  failed = true;
  errorCode = classifyError(error, context);
  failureDetail = error instanceof Error ? error.message : "runner_error";
} finally {
  clearTimeout(totalTimeout);
  try {
    await stopAndCleanupContext(context);
    observation.cleanupCompleted = true;
  } catch (error) {
    failed = true;
    errorCode ??= classifyError(error, context);
    failureDetail ??= error instanceof Error ? error.message : "runner_error";
  }
}

process.stdout.write(`${JSON.stringify({
  ok: !failed,
  runtimePath: "production_electron",
  evidenceBoundary: "closed_safe_fixture",
  errorCode,
  failureDetail,
  observation
}, null, 2)}\n`);
if (failed) process.exitCode = 1;

async function runScenario() {
  observation.stage = "launch";
  const child = startElectron(context);
  const initialIdentities = captureOwnedProcessTree(child.pid, process.pid, "electron.exe");
  const rootIdentity = selectInitialOwnedRootIdentity({ pid: child.pid, identities: initialIdentities });
  if (!rootIdentity || child.exitCode !== null) throw new Error("owned_root_identity_capture_failed");
  context.p283cOwnedRootIdentity = rootIdentity;
  context.p283cOwnedRootPid = rootIdentity.pid;
  context.p283cOwnedIdentities = [rootIdentity];
  context.p283cOwnedIdentityFile = writeOwnedProcessIdentityFile(context, [rootIdentity]);

  observation.stage = "cdp_connect";
  await connectToElectron(context);
  observation.stage = "pet_window";
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  observation.stage = "pet_preload";
  await waitFor(pet, "Boolean(window.petApi)");
  context.p283cNativeHwnd = await evaluate(pet, "window.petApi.getNativeWindowHandleForAcceptance()");
  observation.stage = "first_frame";
  await waitForTelemetry(context, (event) => event.type === "first_frame", 15_000);

  observation.stage = "startup_action_settle";
  observation.startupPresentationLifecycle = await observeStartupAppearanceLifecycle(context);
  await sleep(550);

  observation.stage = "renderer_local_action";
  const rendererLocalStart = readTelemetryEvents(context).length;
  const nativeTarget = await readWindowsNativeHeadTarget(context, pet, rendererLocalStart);
  observation.nativeInput = createNativeInputObservation(nativeTarget);
  const nativePreflight = prepareWindowsNativeClick(context, nativeTarget);
  observation.nativeInput.preflightScreenPoint = nativePreflight.screenPoint;
  observation.nativeInput.preflightVirtualScreen = nativePreflight.virtualScreen;
  observation.nativeInput.preflightNeutralPoint = nativePreflight.chosenNeutralPoint;
  const nativeResult = dispatchWindowsNativeClick(context, nativeTarget);
  observation.nativeInput.screenPoint = nativeResult.screenPoint;
  observation.nativeInput.virtualScreen = nativeResult.virtualScreen;
  observation.nativeInput.chosenNeutralPoint = nativeResult.chosenNeutralPoint;
  const rendererLocalStarted = await waitForTelemetryAfter(context, rendererLocalStart, (event) =>
    event.type === "pet_interaction_action_started" &&
    event.payload?.reason === RENDERER_LOCAL_REASON &&
    event.payload?.type === "headPat" && event.payload?.requestId === undefined &&
    isSafeActionInstanceId(event.payload?.actionInstanceId), 8_000);
  const rendererLocalActionInstanceId = rendererLocalStarted.payload.actionInstanceId;
  observation.rendererLocalStarted = true;
  observation.rendererLocalActionInstanceSafe = true;
  await waitForTelemetryAfter(context, rendererLocalStart, (event) =>
    event.type === "pet_interaction_action_finished" &&
    event.payload?.reason === RENDERER_LOCAL_REASON &&
    event.payload?.requestId === undefined &&
    event.payload?.actionInstanceId === rendererLocalActionInstanceId, 10_000);
  observation.rendererLocalTerminal = true;
  observation.rendererLocalLifecycleObserved = true;

  observation.stage = "local_gate_release";
  // Local busy clears on the terminal telemetry; the renderer cooldown lasts 450 ms.
  await sleep(550);

  observation.stage = "candidate_injection";
  const candidateStart = readTelemetryEvents(context).length;
  context.p283cCandidateStartIndex = candidateStart;
  const accepted = await evaluate(
    pet,
    `window.petApi.injectProactiveBubbleCandidateForAcceptance(${JSON.stringify(CANDIDATE_ID)})`
  );
  observation.candidateInjectionAccepted = accepted === true;
  if (accepted !== true) throw new Error("safe_candidate_injection_rejected");

  observation.stage = "proactive_action";
  const proactiveStarted = await waitForProactiveActionStart(context, candidateStart, 8_000);
  observation.actionFirstStarted = true;
  observation.proactiveRequestIdSafe = true;
  const proactiveRequestId = proactiveStarted.payload.requestId;
  context.p283cProactiveRequestId = proactiveRequestId;
  await waitForTelemetryAfter(context, candidateStart, (event) =>
    event.type === "proactive_bubble_candidate" &&
    event.payload?.candidateId === CANDIDATE_ID && event.payload?.status === "shown", 8_000);
  captureCandidateDecisionObservation(context);
  observation.proactiveBubbleShown = true;
  const chatStart = readTelemetryEvents(context).length;

  observation.stage = "chat_open";
  await evaluate(pet, "window.petApi.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, `document.activeElement?.matches(${JSON.stringify(chatUiSelectors.chat.input)})`, {
    timeoutMs: 8_000
  });

  observation.stage = "chat_action";
  const chatStarted = await waitForTelemetryAfter(context, chatStart, (event) =>
    event.type === "pet_interaction_action_started" &&
    event.payload?.reason === CHAT_REASON &&
    isSafeRequestId(event.payload?.requestId), 8_000);
  observation.chatOpenedStarted = true;
  observation.chatRequestIdSafe = true;
  const chatRequestId = chatStarted.payload.requestId;
  context.p283cChatRequestId = chatRequestId;
  observation.requestIdsDiffer = proactiveRequestId !== chatRequestId;

  observation.stage = "chat_terminal";
  await waitForTelemetryAfter(context, chatStart, (event) =>
    isActionTerminalEvent(event) &&
    event.payload?.reason === CHAT_REASON && event.payload?.requestId === chatRequestId, 10_000);
  observation.chatTerminalObserved = true;
  refreshLifecycleObservations(context);
  observation.bubbleHiddenAfterChat = await evaluate(pet,
    'document.querySelector("#proactive-speech-bubble")?.dataset.state !== "visible"');

  observation.stage = "arbitration_settle";
  await sleep(1_200);
  refreshLifecycleObservations(context);

  observation.stage = "assertions";
  const required = observation.rendererLocalStarted && observation.rendererLocalTerminal &&
    observation.rendererLocalActionInstanceSafe && observation.rendererLocalLifecycleObserved &&
    observation.candidateInjectionAccepted && observation.candidateDecisionStatus === "shown" &&
    observation.actionFirstStarted && observation.proactiveRequestIdSafe && observation.proactiveBubbleShown &&
    observation.chatOpenedStarted && observation.chatRequestIdSafe && observation.chatTerminalObserved &&
    observation.requestIdsDiffer && observation.proactiveTerminalBeforeChatStarted && observation.proactiveSingleTerminal &&
    observation.noProactiveRestartAfterChat && observation.noSecondProactiveTerminalAfterChat &&
    observation.noConcurrentActiveRequests && observation.bubbleHiddenAfterChat;
  if (!required) throw new Error("arbitration_observation_failed");
  assertNoScreenshotResidue(context);
}

function refreshLifecycleObservations(context) {
  const candidateStart = context.p283cCandidateStartIndex;
  const proactiveRequestId = context.p283cProactiveRequestId;
  const chatRequestId = context.p283cChatRequestId;
  if (!Number.isSafeInteger(candidateStart) || !isSafeRequestId(proactiveRequestId) ||
    !isSafeRequestId(chatRequestId)) {
    return;
  }
  const lifecycleEvents = readTelemetryEvents(context).slice(candidateStart).filter(isActionLifecycleEvent);
  const chatStartedIndex = lifecycleEvents.findIndex((event) =>
    event.type === "pet_interaction_action_started" &&
    event.payload?.reason === CHAT_REASON && event.payload?.requestId === chatRequestId);
  const proactiveTerminals = lifecycleEvents.filter((event) =>
    isActionTerminalEvent(event) &&
    event.payload?.reason === PROACTIVE_REASON && event.payload?.requestId === proactiveRequestId);
  const proactiveTerminalIndex = lifecycleEvents.indexOf(proactiveTerminals[0]);
  const postChatLifecycle = lifecycleEvents.slice(Math.max(0, chatStartedIndex + 1));
  observation.proactiveLifecycleCount = lifecycleEvents.filter((event) =>
    event.payload?.reason === PROACTIVE_REASON && event.payload?.requestId === proactiveRequestId).length;
  observation.chatLifecycleCount = lifecycleEvents.filter((event) =>
    event.payload?.reason === CHAT_REASON && event.payload?.requestId === chatRequestId).length;
  observation.proactiveTerminalBeforeChatStarted = proactiveTerminalIndex >= 0 &&
    chatStartedIndex >= 0 && proactiveTerminalIndex < chatStartedIndex;
  observation.proactiveSingleTerminal = proactiveTerminals.length === 1;
  observation.noProactiveRestartAfterChat = chatStartedIndex >= 0 && !postChatLifecycle.some((event) =>
    event.type === "pet_interaction_action_started" &&
    event.payload?.reason === PROACTIVE_REASON && event.payload?.requestId === proactiveRequestId);
  observation.noSecondProactiveTerminalAfterChat = chatStartedIndex >= 0 && !postChatLifecycle.some((event) =>
    isActionTerminalEvent(event) &&
    event.payload?.reason === PROACTIVE_REASON && event.payload?.requestId === proactiveRequestId);
  observation.noConcurrentActiveRequests = hasAtMostOneActiveRequest(lifecycleEvents);
}

async function observeStartupAppearanceLifecycle(context) {
  const startedDeadline = Date.now() + 1_000;
  let startedIndex = -1;
  while (Date.now() <= startedDeadline) {
    const events = readTelemetryEvents(context);
    startedIndex = events.findIndex((event) =>
      event.type === "pet_interaction_action_started" && event.payload?.type === "appearance");
    if (startedIndex >= 0) break;
    await sleep(50);
  }
  if (startedIndex < 0) return "not_started";

  const terminalDeadline = Date.now() + 30_000;
  while (Date.now() <= terminalDeadline) {
    const terminal = readTelemetryEvents(context).slice(startedIndex + 1).find((event) =>
      isActionTerminalEvent(event) && event.payload?.type === "appearance");
    if (terminal) return terminal.type;
    await sleep(100);
  }
  throw new Error("appearance_terminal_timeout");
}

async function waitForProactiveActionStart(context, startIndex, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = readTelemetryEvents(context).slice(startIndex);
    captureCandidateDecisionObservation(context, events);
    const started = events.find((event) =>
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === PROACTIVE_REASON &&
      isSafeRequestId(event.payload?.requestId));
    if (started) return started;
    const terminalDecision = [...events].reverse().find((event) =>
      event.type === "proactive_bubble_candidate" &&
      event.payload?.candidateId === CANDIDATE_ID &&
      (event.payload?.status === "skipped" || event.payload?.status === "expired"));
    if (terminalDecision) throw new Error("proactive_candidate_terminal_before_action");
    await sleep(50);
  }
  throw new Error("telemetry_wait_timeout");
}

function captureCandidateDecisionObservation(context, suppliedEvents) {
  const startIndex = Number.isSafeInteger(context.p283cCandidateStartIndex)
    ? context.p283cCandidateStartIndex
    : 0;
  const events = suppliedEvents ?? readTelemetryEvents(context).slice(startIndex);
  const decision = [...events].reverse().find((event) =>
    event.type === "proactive_bubble_candidate" && event.payload?.candidateId === CANDIDATE_ID);
  if (!decision) return;
  observation.candidateDecisionStatus = typeof decision.payload?.status === "string"
    ? decision.payload.status
    : null;
  observation.candidateSkipReason = typeof decision.payload?.skipReason === "string"
    ? decision.payload.skipReason
    : null;
}

function isSafeRequestId(value) {
  return typeof value === "string" && /^[a-f0-9]{32}$/u.test(value);
}

function isSafeActionInstanceId(value) {
  return typeof value === "string" && /^renderer_action_\d+$/u.test(value);
}

function isActionLifecycleEvent(event) {
  return event.type === "pet_interaction_action_started" || isActionTerminalEvent(event);
}

function isActionTerminalEvent(event) {
  return event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped";
}

function hasAtMostOneActiveRequest(events) {
  const activeRequestIds = new Set();
  for (const event of events) {
    const requestId = event.payload?.requestId;
    if (!isSafeRequestId(requestId)) continue;
    if (event.type === "pet_interaction_action_started") {
      activeRequestIds.add(requestId);
    } else if (isActionTerminalEvent(event)) {
      activeRequestIds.delete(requestId);
    }
    if (activeRequestIds.size > 1) return false;
  }
  return true;
}

async function selectAvailableCdpPort() {
  const override = Number(process.env.P2_83C_CDP_PORT);
  if (Number.isInteger(override) && override > 0 && override <= 65_535) return override;
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("dynamic_cdp_port_unavailable")));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function readWindowsNativeHeadTarget(context, pet, rendererEventCountBefore) {
  const point = await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas?.getBoundingClientRect();
      if (!canvas || !rect || rect.width <= 0 || rect.height <= 0) {
        throw new Error("pet_canvas_unavailable");
      }
      const headRegion = {
        left: rect.left + rect.width * 0.25,
        right: rect.left + rect.width * 0.75,
        top: rect.top + rect.height * 0.05,
        bottom: rect.top + rect.height * 0.33
      };
      const x = (headRegion.left + headRegion.right) / 2;
      const y = (headRegion.top + headRegion.bottom) / 2;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        throw new Error("pet_head_target_outside_canvas");
      }
      return {
        clientX: x,
        clientY: y,
        deviceScaleFactor: window.devicePixelRatio,
        screenPointFromWindowRect: {
          x: window.screenX + x,
          y: window.screenY + y
        },
        windowRect: {
          left: window.screenX,
          top: window.screenY,
          right: window.screenX + window.outerWidth,
          bottom: window.screenY + window.outerHeight,
          width: window.outerWidth,
          height: window.outerHeight
        },
        canvasRect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        }
      };
    })()
  `);
  const expectedHwnd = context.p283cNativeHwnd;
  const expectedPid = context.p283cOwnedRootPid;
  if (!/^\d{1,20}$/u.test(expectedHwnd ?? "") ||
    !Number.isSafeInteger(expectedPid) || expectedPid <= 0) {
    throw new Error("native_window_target_unavailable");
  }
  return { ...point, expectedHwnd, expectedPid, rendererEventCountBefore };
}

function prepareWindowsNativeClick(context, target) {
  return runWindowsNativeMouse(context, target, ["-PrepareOnly", "-KeepCursorAtTarget"]);
}

function dispatchWindowsNativeClick(context, target) {
  return runWindowsNativeMouse(context, target, []);
}

function runWindowsNativeMouse(context, target, extraArgs) {
  const currentRoot = context.p283cOwnedIdentityFile
    ? probeOwnedProcessIdentities(context.p283cOwnedIdentityFile).find((identity) => identity.role === "root")
    : null;
  if (!isSameOwnedProcessIdentity(context.p283cOwnedRootIdentity, currentRoot) ||
    currentRoot.pid !== target.expectedPid) {
    throw new Error("native_input_owned_root_mismatch");
  }
  const helperPath = context.p283cNativeClickHelperPath ?? writeVirtualScreenNativeClickHelper(context);
  context.p283cNativeClickHelperPath = helperPath;
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", helperPath,
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
  const output = JSON.parse(result.stdout);
  if (output?.ok !== true || typeof output.screenPoint !== "string") {
    throw new Error("windows_sendinput_evidence_invalid");
  }
  return parseWindowsNativeMouseEvidence(output.screenPoint);
}

function writeVirtualScreenNativeClickHelper(context) {
  const sourcePath = join(process.cwd(), "scripts", "p2-83a-sendinput-click.ps1");
  let source = readFileSync(sourcePath, "utf8").replace(/\r\n/gu, "\n");
  const originalUsing = "using System.Threading;";
  const originalNeutralization = `      var outsidePoint = FindOutsidePoint(beforeMove);
      if (!SetCursorPos(outsidePoint.x, outsidePoint.y)) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "SetCursorPos outside failed");
      }`;
  const originalParameters = "  [switch]$PrepareOnly,\n  [switch]$KeepCursorAtTarget\n)";
  if (!source.includes(originalUsing) || !source.includes(originalNeutralization) ||
    !source.includes(originalParameters)) {
    throw new Error("native_helper_patch_contract_mismatch");
  }
  source = source.replace(originalUsing, `${originalUsing}\nusing System.Drawing;\nusing System.Windows.Forms;`);
  source = source.replace(originalNeutralization, `      var virtualScreen = SystemInformation.VirtualScreen;
      var neutralPoint = FindAndSetNeutralPoint(beforeMove, expectedHwnd, expectedPid, virtualScreen);`);
  source = source.replaceAll(
    'return clientPoint.x + "," + clientPoint.y;',
    "return FormatEvidence(clientPoint, virtualScreen, neutralPoint);"
  );
  const methodStart = source.indexOf("  private static POINT FindOutsidePoint(RECT windowRect) {");
  const methodEnd = source.indexOf("  private static bool IsExpectedPointTarget", methodStart);
  if (methodStart < 0 || methodEnd <= methodStart) {
    throw new Error("native_helper_patch_contract_mismatch");
  }
  const neutralMethod = `  private static POINT FindAndSetNeutralPoint(
    RECT windowRect,
    IntPtr expectedHwnd,
    uint expectedPid,
    Rectangle virtualScreen
  ) {
    var left = virtualScreen.Left;
    var top = virtualScreen.Top;
    var right = virtualScreen.Right - 1;
    var bottom = virtualScreen.Bottom - 1;
    var candidates = new[] {
      new POINT { x = left, y = top },
      new POINT { x = right, y = top },
      new POINT { x = left, y = bottom },
      new POINT { x = right, y = bottom },
      new POINT { x = Clamp(windowRect.left - 12, left, right), y = Clamp(windowRect.top - 12, top, bottom) },
      new POINT { x = Clamp(windowRect.right + 12, left, right), y = Clamp(windowRect.top - 12, top, bottom) },
      new POINT { x = Clamp(windowRect.left - 12, left, right), y = Clamp(windowRect.bottom + 12, top, bottom) },
      new POINT { x = Clamp(windowRect.right + 12, left, right), y = Clamp(windowRect.bottom + 12, top, bottom) }
    };
    foreach (var candidate in candidates) {
      if (!virtualScreen.Contains(candidate.x, candidate.y) || IsInsideWindow(candidate, windowRect) ||
          TargetsControlledWindow(candidate, expectedHwnd, expectedPid)) continue;
      if (!SetCursorPos(candidate.x, candidate.y)) continue;
      POINT observed;
      if (!GetCursorPos(out observed) || observed.x != candidate.x || observed.y != candidate.y) continue;
      if (TargetsControlledWindow(observed, expectedHwnd, expectedPid)) continue;
      return observed;
    }
    throw new InvalidOperationException("No verified neutral point exists inside SystemInformation.VirtualScreen");
  }

  private static bool IsInsideWindow(POINT point, RECT rect) {
    return point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;
  }

  private static bool TargetsControlledWindow(POINT point, IntPtr expectedHwnd, uint expectedPid) {
    var target = WindowFromPoint(point);
    if (target == IntPtr.Zero) return false;
    var root = GetAncestor(target, GA_ROOT);
    if (root == expectedHwnd) return true;
    uint ownerPid;
    GetWindowThreadProcessId(root, out ownerPid);
    return ownerPid == expectedPid;
  }

  private static int Clamp(int value, int minimum, int maximum) {
    return Math.Max(minimum, Math.Min(maximum, value));
  }

  private static string FormatEvidence(POINT screenPoint, Rectangle virtualScreen, POINT neutralPoint) {
    return screenPoint.x + "," + screenPoint.y + "|" +
      virtualScreen.Left + "," + virtualScreen.Top + "," + virtualScreen.Right + "," +
      virtualScreen.Bottom + "," + virtualScreen.Width + "," + virtualScreen.Height + "|" +
      neutralPoint.x + "," + neutralPoint.y;
  }

`;
  source = source.slice(0, methodStart) + neutralMethod + source.slice(methodEnd);
  source = source.replace(
    originalParameters,
    "  [switch]$PrepareOnly,\n  [switch]$KeepCursorAtTarget,\n  [switch]$CompileOnly\n)"
  );
  source = source.replace(
    "Add-Type -TypeDefinition $signature",
    'Add-Type -AssemblyName System.Windows.Forms\n  Add-Type -TypeDefinition $signature -ReferencedAssemblies @("System.dll", "System.Core.dll", "System.Drawing.dll", "System.Windows.Forms.dll")'
  );
  source = source.replace(
    "  $screenPoint = [P283ANativeMouse]::Click(",
    `  if ($CompileOnly.IsPresent) {
    @{ ok = $true; input = "compile-only" } | ConvertTo-Json -Compress
    exit 0
  }
  $screenPoint = [P283ANativeMouse]::Click(`
  );
  const helperPath = join(context.runDir, "p2-83c-sendinput-click.ps1");
  writeFileSync(helperPath, source, "utf8");
  return helperPath;
}

function compileVirtualScreenNativeClickHelperOnly() {
  const compileDir = mkdtempSync(join(tmpdir(), "p2-83c-native-helper-compile-"));
  try {
    const helperPath = writeVirtualScreenNativeClickHelper({ runDir: compileDir });
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", helperPath,
      "-ExpectedHwnd", "1",
      "-ExpectedPid", "1",
      "-ClientX", "0",
      "-ClientY", "0",
      "-DeviceScaleFactor", "1",
      "-CompileOnly"
    ], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 20_000
    });
    if (result.status !== 0) {
      const detail = String(result.stderr || "native_helper_compile_failed").trim().slice(0, 2_000);
      throw new Error(`native_helper_compile_failed: ${detail}`);
    }
    const output = JSON.parse(result.stdout);
    if (output?.ok !== true || output.input !== "compile-only") {
      throw new Error("native_helper_compile_evidence_invalid");
    }
    return { ok: true, mode: "compile-only", inputAttempted: false };
  } finally {
    rmSync(compileDir, { recursive: true, force: true });
  }
}

function parseWindowsNativeMouseEvidence(value) {
  const [screenPart, virtualPart, neutralPart, ...extraParts] = value.split("|");
  const screen = parseIntegerTuple(screenPart, 2);
  const virtual = parseIntegerTuple(virtualPart, 6);
  const neutral = parseIntegerTuple(neutralPart, 2);
  if (extraParts.length > 0 || !screen || !virtual || !neutral ||
    virtual[2] <= virtual[0] || virtual[3] <= virtual[1] ||
    virtual[4] !== virtual[2] - virtual[0] || virtual[5] !== virtual[3] - virtual[1] ||
    neutral[0] < virtual[0] || neutral[0] >= virtual[2] ||
    neutral[1] < virtual[1] || neutral[1] >= virtual[3]) {
    throw new Error("windows_sendinput_evidence_invalid");
  }
  return {
    screenPoint: `${screen[0]},${screen[1]}`,
    virtualScreen: {
      left: virtual[0], top: virtual[1], right: virtual[2], bottom: virtual[3],
      width: virtual[4], height: virtual[5]
    },
    chosenNeutralPoint: { x: neutral[0], y: neutral[1] }
  };
}

function parseIntegerTuple(value, length) {
  if (typeof value !== "string" || !new RegExp(`^-?\\d+(,-?\\d+){${length - 1}}$`, "u").test(value)) {
    return null;
  }
  const items = value.split(",").map(Number);
  return items.length === length && items.every(Number.isSafeInteger) ? items : null;
}

function createNativeInputObservation(target) {
  return {
    clientPoint: { x: target.clientX, y: target.clientY },
    screenPointFromWindowRect: target.screenPointFromWindowRect,
    preflightScreenPoint: null,
    preflightVirtualScreen: null,
    preflightNeutralPoint: null,
    screenPoint: null,
    virtualScreen: null,
    chosenNeutralPoint: null,
    expectedHwnd: target.expectedHwnd,
    ownerPid: target.expectedPid,
    windowRect: target.windowRect,
    canvasRect: target.canvasRect,
    rendererEventCountBefore: target.rendererEventCountBefore,
    rendererEventCountAfter: null,
    rendererLifecycleEventCountAfter: null
  };
}

async function waitForTelemetry(context, predicate, timeoutMs) {
  return waitForTelemetryAfter(context, 0, predicate, timeoutMs);
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

function readTelemetryEvents(context) {
  const logDir = join(context.appDataDir, "logs");
  if (!existsSync(logDir)) return [];
  const events = [];
  for (const name of readdirSync(logDir).filter((item) => item.startsWith("telemetry-") && item.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(logDir, name), "utf8").split(/\r?\n/u)) {
      try {
        if (line.trim()) events.push(JSON.parse(line));
      } catch {
        // A running Electron process may be flushing its final telemetry line.
      }
    }
  }
  return events;
}

async function stopAndCleanupContext(context) {
  context.p283cOwnedChild ??= context.child;
  const ownedPid = context.p283cOwnedRootPid ?? context.child?.pid;
  const expectedHwnd = /^\d{1,20}$/u.test(context.p283cNativeHwnd ?? "") ? context.p283cNativeHwnd : "0";
  let cleanupError = null;
  let identities = Array.isArray(context.p283cOwnedIdentities) ? [...context.p283cOwnedIdentities] : [];
  let identityFile = context.p283cOwnedIdentityFile ?? null;
  let rootIdentityValidated = false;
  async function cleanupStep(stage, reason, operation) {
    try {
      await operation();
    } catch {
      cleanupError ??= new CleanupStageError(stage, reason);
    }
  }

  await cleanupStep("connection_close", "connection_close_failed", () => closeContextConnections(context));
  await cleanupStep("owned_process_snapshot", "owned_process_snapshot_failed", () => {
    const rootIdentity = context.p283cOwnedRootIdentity;
    const currentRoot = rootIdentity && identityFile
      ? probeOwnedProcessIdentities(identityFile).find((identity) => identity.role === "root")
      : null;
    if (!rootIdentity || !identityFile || !isSameOwnedProcessIdentity(rootIdentity, currentRoot)) return;
    const captured = captureOwnedProcessTree(ownedPid, process.pid, "electron.exe");
    const capturedRoot = captured.find((identity) => identity.role === "root");
    if (!isSameOwnedProcessIdentity(rootIdentity, capturedRoot)) return;
    rootIdentityValidated = true;
    identities = mergeOwnedProcessIdentities(identities, captured);
    context.p283cOwnedIdentities = [...identities];
    identityFile = writeOwnedProcessIdentityFile(context, identities);
  });
  if (expectedHwnd !== "0") {
    await cleanupStep("native_cursor_neutralize", "native_cursor_neutralize_failed", () => moveCursorToNeutralPosition(expectedHwnd));
  }
  await cleanupStep("owned_process_kill", "owned_process_kill_failed", () => {
    if (rootIdentityValidated && identityFile) killOwnedElectronTree(context, identityFile);
  });
  await cleanupStep("owned_process_wait", "owned_process_wait_failed", () => {
    if (rootIdentityValidated && identityFile) waitForOwnedProcessTreeExit(identityFile, 8_000);
  });
  await cleanupStep("spawned_child_fallback", "spawned_child_fallback_failed", async () => {
    if (!rootIdentityValidated) await terminateSpawnedChildBeforeIdentityValidation(context.p283cOwnedChild);
  });
  await cleanupStep("hwnd_invalidation", "hwnd_invalidation_failed", () => {
    if (rootIdentityValidated && identityFile && probeOwnedProcessIdentities(identityFile).length > 0) {
      waitForOldHwndInvalidation(expectedHwnd, identityFile);
    }
  });
  if (!cleanupError) {
    await cleanupStep("user_data_removal", "user_data_removal_failed", () => {
      closeOwnedProcessLogStreams(context.p283cOwnedChild);
      cleanupRealUiRun(context);
    });
  }
  if (cleanupError) throw cleanupError;
}

function closeOwnedProcessLogStreams(child) {
  for (const stream of [child?.stdout, child?.stderr]) {
    stream?.removeAllListeners("data");
    stream?.destroy();
  }
}

async function terminateSpawnedChildBeforeIdentityValidation(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const terminated = child.kill();
  if (!terminated && child.exitCode === null && child.signalCode === null) {
    throw new Error("spawned_child_handle_terminate_failed");
  }
  await waitForChildExit(child);
}

async function runEarlyCaptureCleanupSelfTest() {
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 83_083;
  child.exitCode = null;
  child.signalCode = null;
  let killCalls = 0;
  child.kill = () => {
    killCalls += 1;
    queueMicrotask(() => {
      child.exitCode = 0;
      child.emit("close", 0, null);
    });
    return true;
  };

  await terminateSpawnedChildBeforeIdentityValidation(child);
  if (killCalls !== 1 || child.exitCode === null) throw new Error("early_capture_child_not_closed");
  return { ok: true, mode: "early-capture-cleanup", killCalls, closeObserved: true };
}

function closeContextConnections(context) {
  for (const page of context.pages ?? []) page.cdp?.close();
  context.pages = [];
}

function moveCursorToNeutralPosition(expectedHwnd) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    join(process.cwd(), "scripts", "p2-83a-neutralize-cursor.ps1"), "-ExpectedHwnd", expectedHwnd
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) throw new Error("cursor_neutralization_failed");
}

function captureOwnedProcessTree(rootPid, expectedParentPid, expectedRootName) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    join(process.cwd(), "scripts", "p2-83a-capture-process-tree.ps1"), "-RootPid", String(rootPid),
    "-ExpectedParentPid", String(expectedParentPid), "-ExpectedRootName", expectedRootName
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) throw new Error("owned_process_tree_capture_failed");
  return parseOwnedProcessIdentities(JSON.parse(result.stdout));
}

function writeOwnedProcessIdentityFile(context, identities) {
  mkdirSync(context.runDir, { recursive: true });
  const path = join(context.runDir, "owned-process-identities.json");
  writeFileSync(path, `${JSON.stringify(identities)}\n`, "utf8");
  return path;
}

function probeOwnedProcessIdentities(identityFile) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    join(process.cwd(), "scripts", "p2-83a-probe-owned-process-identities.ps1"), "-IdentityFile", identityFile
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) throw new Error("owned_process_probe_failed");
  return parseOwnedProcessIdentities(JSON.parse(result.stdout));
}

function killOwnedElectronTree(context, identityFile) {
  for (let round = 0; round < 3; round += 1) {
    const survivors = probeOwnedProcessIdentities(identityFile);
    if (survivors.length === 0) break;
    for (const identity of [...survivors].sort((left, right) => Number(left.role === "root") - Number(right.role === "root"))) {
      const result = spawnSync("taskkill.exe", ["/PID", String(identity.pid), "/F"], {
        windowsHide: true, stdio: "ignore", timeout: 10_000
      });
      if (result.status !== 0 && !isTaskkillFailureIdempotent(identity, probeOwnedProcessIdentities(identityFile))) {
        throw new Error("owned_process_kill_failed");
      }
    }
  }
  context.child = null;
}

function waitForOwnedProcessTreeExit(identityFile, timeoutMilliseconds) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    join(process.cwd(), "scripts", "p2-83a-wait-owned-exit.ps1"), "-IdentityFile", identityFile,
    "-TimeoutMilliseconds", String(timeoutMilliseconds)
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) throw new Error("owned_process_wait_failed");
}

function waitForOldHwndInvalidation(expectedHwnd, identityFile) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    join(process.cwd(), "scripts", "p2-83a-wait-hwnd-invalid.ps1"), "-ExpectedHwnd", expectedHwnd,
    "-IdentityFile", identityFile, "-TimeoutMilliseconds", "8_000"
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) throw new Error("old_hwnd_invalidation_timeout");
}

function classifyError(error, context) {
  if (error instanceof CleanupStageError && SAFE_CLEANUP_STAGES.has(error.cleanupStage) && SAFE_CLEANUP_REASONS.has(error.cleanupReason)) {
    return error.cleanupReason;
  }
  const stderrPath = join(context.runDir, "electron.stderr.log");
  if (existsSync(stderrPath) && /GPU process exited unexpectedly|GPU process isn't usable/u.test(readFileSync(stderrPath, "utf8"))) {
    return "gpu_child_crash_before_first_frame";
  }
  const stdoutPath = join(context.runDir, "electron.stdout.log");
  if (existsSync(stdoutPath) && /Unable to load preload script:[\s\S]*module not found: \.\.\/shared\/pet-action-trigger/u.test(readFileSync(stdoutPath, "utf8"))) {
    return "pet_preload_shared_module_unavailable";
  }
  const message = error instanceof Error ? error.message : "runner_error";
  if (message.startsWith("windows_sendinput_failed:")) return "native_input_rejected";
  return [
    "runner_total_timeout", "safe_candidate_injection_rejected", "telemetry_wait_timeout",
    "appearance_terminal_timeout",
    "arbitration_observation_failed", "proactive_candidate_terminal_before_action",
    "native_input_owned_root_mismatch",
    "windows_sendinput_evidence_invalid", "native_window_target_unavailable"
  ].includes(message)
    ? message
    : "runner_error";
}
