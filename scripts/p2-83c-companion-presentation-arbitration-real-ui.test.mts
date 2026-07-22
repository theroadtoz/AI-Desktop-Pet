import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const source = readFileSync("scripts/p2-83c-companion-presentation-arbitration-real-ui.mjs", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const nativeClickSource = readFileSync("scripts/p2-83a-sendinput-click.ps1", "utf8");

test("P2-83C runner stays a single closed-fixture production Electron conflict scenario", () => {
  assert.match(source, /CANDIDATE_ID = "search_citation_safe"/);
  assert.match(source, /AI_DESKTOP_PET_P2_83A_SAFE_INJECTION: "1"/);
  assert.match(source, /AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"/);
  assert.match(source, /runtimePath: "production_electron"/);
  assert.match(source, /evidenceBoundary: "closed_safe_fixture"/);
  assert.match(source, /startElectron\(context\)/);
  assert.match(source, /context\.electronArgs = \["--use-angle=swiftshader"\]/);
  assert.match(source, /injectProactiveBubbleCandidateForAcceptance/);
  assert.match(source, /window\.petApi\.openChat\(\)/);
  assert.match(source, /chatUiSelectors\.chat\.input/);
  assert.doesNotMatch(source, /P2_83A_CASE|allCases|\.click\s*\(/);
});

test("P2-83C locks the reachable local-to-proactive-to-chat arbitration sequence", () => {
  assert.match(source, /isSafeRequestId\(event\.payload\?\.requestId\)/);
  assert.match(source, /isSafeActionInstanceId\(event\.payload\?\.actionInstanceId\)/);
  assert.match(source, /proactiveRequestId !== chatRequestId/);
  assert.match(source, /rendererLocalActionInstanceId/);
  assert.match(source, /rendererLocalTerminal = true/);
  assert.match(source, /proactiveBubbleShown = true/);
  assert.match(source, /bubbleHiddenAfterChat/);
  assert.match(source, /proactiveTerminalBeforeChatStarted/);
  assert.match(source, /proactiveSingleTerminal/);
  assert.match(source, /noProactiveRestartAfterChat/);
  assert.match(source, /noSecondProactiveTerminalAfterChat/);
  assert.match(source, /hasAtMostOneActiveRequest\(lifecycleEvents\)/);
  assert.match(source, /readWindowsNativeHeadTarget\(context, pet, rendererLocalStart\)/);
  assert.match(source, /const headRegion = \{/);
  assert.match(source, /dispatchWindowsNativeClick\(context, nativeTarget\)/);
  assert.match(source, /p2-83a-sendinput-click\.ps1/);
  assert.match(source, /createWindowsNativeClickArgs/);
  assert.match(source, /isSameOwnedProcessIdentity\(context\.p283cOwnedRootIdentity, currentRoot\)/);
  assert.match(source, /currentRoot\.pid !== target\.expectedPid/);
  assert.match(source, /screenPointFromWindowRect/);
  assert.match(source, /windowRect/);
  assert.match(source, /canvasRect/);
  assert.match(source, /rendererEventCountBefore/);
  assert.match(source, /rendererEventCountAfter/);
  assert.match(source, /candidateInjectionAccepted/);
  assert.match(source, /candidateDecisionStatus/);
  assert.match(source, /candidateSkipReason/);
  assert.match(source, /startupPresentationLifecycle/);
  assert.match(source, /observeStartupAppearanceLifecycle\(context\)/);
  assert.match(source, /event\.payload\?\.type === "appearance"/);
  assert.match(source, /appearance_terminal_timeout/);
  assert.match(source, /proactive_candidate_terminal_before_action/);
  assert.match(source, /chatTerminalObserved/);
  assert.match(source, /prepareWindowsNativeClick\(context, nativeTarget\)/);
  assert.match(source, /"-PrepareOnly", "-KeepCursorAtTarget"/);
  assert.match(source, /writeVirtualScreenNativeClickHelper\(context\)/);
  assert.match(source, /SystemInformation\.VirtualScreen/);
  assert.match(source, /virtualScreen\.Contains\(candidate\.x, candidate\.y\)/);
  assert.match(source, /TargetsControlledWindow\(candidate, expectedHwnd, expectedPid\)/);
  assert.match(source, /SetCursorPos\(candidate\.x, candidate\.y\)/);
  assert.match(source, /GetCursorPos\(out observed\)/);
  assert.match(source, /observed\.x != candidate\.x \|\| observed\.y != candidate\.y/);
  assert.match(source, /TargetsControlledWindow\(observed, expectedHwnd, expectedPid\)/);
  assert.match(source, /No verified neutral point exists inside SystemInformation\.VirtualScreen/);
  assert.match(source, /preflightVirtualScreen/);
  assert.match(source, /preflightNeutralPoint/);
  assert.match(source, /virtualScreen: null/);
  assert.match(source, /chosenNeutralPoint: null/);
  assert.doesNotMatch(source, /1920|1080|2560|1440/);
  assert.doesNotMatch(source, /Input\.dispatchMouseEvent|new PointerEvent/);
  assert.match(nativeClickSource, /SetProcessDpiAwarenessContext/);
  assert.match(nativeClickSource, /ClientToScreen/);
  assert.match(nativeClickSource, /WindowFromPoint/);
  assert.match(nativeClickSource, /GetAncestor/);
  assert.match(nativeClickSource, /GetWindowThreadProcessId/);
  assert.match(nativeClickSource, /AssertPointTarget\(clientPoint, expectedHwnd, expectedPid, "before SendInput"\)/);
  assert.match(nativeClickSource, /SendInput/);
  assert.match(source, /RENDERER_LOCAL_REASON/);
  assert.match(source, /await waitForTelemetryAfter\(context, rendererLocalStart[\s\S]*rendererLocalActionInstanceId/);
  assert.match(source, /observation\.proactiveTerminalBeforeChatStarted && observation\.proactiveSingleTerminal/);
  assert.doesNotMatch(source, /lateProactiveTerminalObserved|chatGateHeldAfterLateTerminal|rendererLocalCompletedMainRequest|bubbleShownAfterChat/);
  assert.doesNotMatch(source, /console\.log|windowTitle|processName|mediaMetadata|memoryBody|historyBody|searchQuery|prompt|apiKey/i);
});

test("P2-83C keeps the production-reachable startup to local-action to candidate to chat order", () => {
  const candidateIndex = source.indexOf('observation.stage = "candidate_injection"');
  const startupSettleIndex = source.indexOf('observation.stage = "startup_action_settle"');
  const rendererLocalIndex = source.indexOf('observation.stage = "renderer_local_action"');
  const rendererLocalTerminalIndex = source.indexOf("observation.rendererLocalLifecycleObserved = true");
  const localGateReleaseIndex = source.indexOf('observation.stage = "local_gate_release"');
  const proactiveIndex = source.indexOf('observation.stage = "proactive_action"');
  const chatOpenIndex = source.indexOf('observation.stage = "chat_open"');
  const chatTerminalIndex = source.indexOf('observation.stage = "chat_terminal"');
  assert.ok(candidateIndex >= 0);
  assert.ok(startupSettleIndex >= 0);
  assert.ok(startupSettleIndex < rendererLocalIndex);
  assert.ok(rendererLocalIndex < rendererLocalTerminalIndex);
  assert.ok(rendererLocalTerminalIndex < localGateReleaseIndex);
  assert.ok(localGateReleaseIndex < candidateIndex);
  assert.ok(candidateIndex < proactiveIndex);
  assert.ok(proactiveIndex < chatOpenIndex);
  assert.ok(chatOpenIndex < chatTerminalIndex);
  assert.match(source, /observation\.stage = "startup_action_settle"[\s\S]*await sleep\(550\);[\s\S]*observation\.stage = "renderer_local_action"/);
  assert.match(source, /observation\.stage = "local_gate_release"[\s\S]*await sleep\(550\);[\s\S]*observation\.stage = "candidate_injection"/);
  assert.doesNotMatch(source, /Page\.close|chat_hidden_pet_restored|chatHiddenBeforeLocal|petRestoredBeforeLocal/);
  assert.doesNotMatch(source, /proactiveBubbleCoordinator|requestPetActionTrigger|interactionActionPlayer/);
});

test("P2-83C aggregates completed main lifecycles before final assertions and on failure", () => {
  const refreshAfterChatTerminalIndex = source.indexOf("refreshLifecycleObservations(context);", source.indexOf('observation.stage = "chat_terminal"'));
  const assertionsIndex = source.indexOf('observation.stage = "assertions"');
  assert.ok(refreshAfterChatTerminalIndex >= 0);
  assert.ok(refreshAfterChatTerminalIndex < assertionsIndex);
  assert.match(source, /catch \(error\) \{[\s\S]*refreshLifecycleObservations\(context\)/);
  assert.match(source, /observation\.proactiveLifecycleCount = lifecycleEvents\.filter/);
  assert.match(source, /observation\.chatLifecycleCount = lifecycleEvents\.filter/);
  assert.match(source, /observation\.proactiveTerminalBeforeChatStarted =/);
  assert.match(source, /observation\.noConcurrentActiveRequests = hasAtMostOneActiveRequest/);
});

test("P2-83C virtual-screen neutralization remains bounded, ownership-safe, and fail-closed", () => {
  assert.match(source, /readFileSync\(sourcePath, "utf8"\)\.replace\(\/\\r\\n\/gu, "\\n"\)/);
  assert.match(source, /var virtualScreen = SystemInformation\.VirtualScreen/);
  assert.match(source, /var left = virtualScreen\.Left/);
  assert.match(source, /var top = virtualScreen\.Top/);
  assert.match(source, /var right = virtualScreen\.Right - 1/);
  assert.match(source, /var bottom = virtualScreen\.Bottom - 1/);
  assert.match(source, /!virtualScreen\.Contains\(candidate\.x, candidate\.y\)/);
  assert.match(source, /IsInsideWindow\(candidate, windowRect\)/);
  assert.match(source, /TargetsControlledWindow\(candidate, expectedHwnd, expectedPid\)/);
  assert.match(source, /GetWindowThreadProcessId\(root, out ownerPid\)/);
  assert.match(source, /if \(!SetCursorPos\(candidate\.x, candidate\.y\)\) continue/);
  assert.match(source, /!GetCursorPos\(out observed\)/);
  assert.match(source, /observed\.x != candidate\.x \|\| observed\.y != candidate\.y/);
  assert.match(source, /TargetsControlledWindow\(observed, expectedHwnd, expectedPid\)/);
  assert.match(source, /throw new InvalidOperationException\("No verified neutral point exists inside SystemInformation\.VirtualScreen"\)/);
  assert.match(source, /neutral\[0\] < virtual\[0\] \|\| neutral\[0\] >= virtual\[2\]/);
  assert.match(source, /neutral\[1\] < virtual\[1\] \|\| neutral\[1\] >= virtual\[3\]/);
});

test("P2-83C generated Windows helper compiles without moving the cursor or sending input", () => {
  assert.match(source, /--compile-native-helper-only/);
  assert.match(source, /\[switch\]\$CompileOnly/);
  assert.match(source, /if \(\$CompileOnly\.IsPresent\) \{/);
  assert.match(source, /input = "compile-only"/);
  const result = spawnSync(process.execPath, [
    "--no-warnings",
    "scripts/p2-83c-companion-presentation-arbitration-real-ui.mjs",
    "--compile-native-helper-only"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    ok: true,
    mode: "compile-only",
    inputAttempted: false
  });
});

test("P2-83C selects an isolated CDP port and retains SwiftShader only for its Electron child", () => {
  assert.match(source, /port: await selectAvailableCdpPort\(\)/);
  assert.match(source, /createServer/);
  assert.match(source, /server\.listen\(\{ host: "127\.0\.0\.1", port: 0 \}/);
  assert.match(source, /context\.electronArgs = \["--use-angle=swiftshader"\]/);
});

test("P2-83C preserves the existing owned-process, port, screenshot, and tmp cleanup contract", () => {
  assert.match(source, /assertNoScreenshotResidue\(context\)/);
  assert.match(source, /cleanupRealUiRun\(context\)/);
  assert.match(source, /closeOwnedProcessLogStreams\(context\.p283cOwnedChild\)/);
  assert.match(source, /removeAllListeners\("data"\)/);
  assert.match(source, /stream\?\.destroy\(\)/);
  assert.match(source, /p2-83a-capture-process-tree\.ps1/);
  assert.match(source, /p2-83a-probe-owned-process-identities\.ps1/);
  assert.match(source, /p2-83a-wait-owned-exit\.ps1/);
  assert.match(source, /p2-83a-wait-hwnd-invalid\.ps1/);
  assert.match(source, /spawnSync\("taskkill\.exe", \["\/PID", String\(identity\.pid\), "\/F"\]/);
  assert.doesNotMatch(source, /"\/T"/);
  assert.match(source, /selectInitialOwnedRootIdentity/);
  assert.match(source, /isSameOwnedProcessIdentity/);
  assert.match(source, /SAFE_CLEANUP_STAGES/);
  assert.match(source, /SAFE_CLEANUP_REASONS/);
  assert.match(source, /p2-83c-companion-presentation-arbitration-/);
  assert.match(source, /if \(expectedHwnd !== "0"\) \{[\s\S]*moveCursorToNeutralPosition/);
});

test("P2-83C closes only its spawned ChildProcess when identity capture fails before root validation", () => {
  assert.match(source, /if \(!rootIdentityValidated\) await terminateSpawnedChildBeforeIdentityValidation\(context\.p283cOwnedChild\)/);
  assert.match(source, /async function terminateSpawnedChildBeforeIdentityValidation\(child\)/);
  assert.match(source, /const terminated = child\.kill\(\)/);
  assert.match(source, /await waitForChildExit\(child\)/);
  assert.match(source, /spawned_child_fallback_failed/);
  assert.match(source, /if \(!cleanupError\) \{[\s\S]*cleanupRealUiRun\(context\)/);

  const result = spawnSync(process.execPath, [
    "--no-warnings",
    "scripts/p2-83c-companion-presentation-arbitration-real-ui.mjs",
    "--test-early-capture-cleanup"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    ok: true,
    mode: "early-capture-cleanup",
    killCalls: 1,
    closeObserved: true
  });
});

test("P2-83C reports a pre-first-frame GPU child crash as a failure", () => {
  assert.match(source, /GPU process exited unexpectedly\|GPU process isn't usable/);
  assert.match(source, /return "gpu_child_crash_before_first_frame"/);
  assert.match(source, /return "pet_preload_shared_module_unavailable"/);
  assert.match(source, /if \(failed\) process\.exitCode = 1/);
});

test("package exposes only the requested P2-83C acceptance command", () => {
  assert.match(packageJson, /"accept:p2-83c-companion-presentation-arbitration": "npm run build && node --no-warnings scripts\/p2-83c-companion-presentation-arbitration-real-ui\.mjs"/);
});
