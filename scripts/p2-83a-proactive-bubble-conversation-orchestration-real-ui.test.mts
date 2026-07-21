import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateRunnerTotalTimeoutMs } from "./support/p2-83a-runner-budget.mjs";

const source = readFileSync(
  "scripts/p2-83a-proactive-bubble-conversation-orchestration-real-ui.mjs",
  "utf8"
);
const nativeClickSource = readFileSync("scripts/p2-83a-sendinput-click.ps1", "utf8");
const neutralCursorSource = readFileSync("scripts/p2-83a-neutralize-cursor.ps1", "utf8");
const captureTreeSource = readFileSync("scripts/p2-83a-capture-process-tree.ps1", "utf8");
const waitOwnedExitSource = readFileSync("scripts/p2-83a-wait-owned-exit.ps1", "utf8");
const probeOwnedSource = readFileSync("scripts/p2-83a-probe-owned-process-identities.ps1", "utf8");
const waitHwndInvalidSource = readFileSync("scripts/p2-83a-wait-hwnd-invalid.ps1", "utf8");
const pointerControllerSource = readFileSync("src/main/services/pointer-controller.ts", "utf8");
const appSource = readFileSync("src/main/app.ts", "utf8");
const petPreloadSource = readFileSync("src/preload/pet-preload.ts", "utf8");

test("P2-83A runner covers five closed candidates and states its evidence boundary", () => {
  for (const candidateId of [
    "music_started",
    "explicit_game_started",
    "returned_from_away",
    "evening_companion",
    "search_citation_safe"
  ]) {
    assert.match(source, new RegExp(`"${candidateId}"`));
  }
  assert.match(source, /closed safe candidate policy injection/);
  assert.match(source, /not real OS media\/game, local model, or MCP evidence/);
  assert.match(source, /document\.activeElement/);
  assert.match(source, /assertNoScreenshotResidue/);
  assert.match(source, /cleanupRealUiRun/);
});

test("acceptance safe injection disables automatic candidate schedulers without changing production default", () => {
  assert.match(appSource, /const isP283aAcceptanceInjectionOnly = isAcceptanceTelemetryEnabled &&[\s\S]*AI_DESKTOP_PET_P2_83A_SAFE_INJECTION/);
  assert.match(appSource, /acceptanceInjectionOnly: isP283aAcceptanceInjectionOnly/);
  assert.match(appSource, /function schedulePetModeActionStateTrigger[\s\S]*if \(isP283aAcceptanceInjectionOnly\) return;/);
  assert.match(appSource, /function queueSourcedLowFrequencyCompanionEvent[\s\S]*if \(isP283aAcceptanceInjectionOnly\) return;/);
  assert.match(appSource, /function scheduleIdleProactiveSpeechBubble[\s\S]*if \(isP283aAcceptanceInjectionOnly\) return;/);
  assert.match(appSource, /function scheduleStartupProactiveSpeechBubbleIfNeeded[\s\S]*if \(isP283aAcceptanceInjectionOnly\)/);
  assert.match(appSource, /process\.env\.AI_DESKTOP_PET_P2_83A_SAFE_INJECTION !== "1"/);
});

test("P2-83A runner uses Windows native screen-coordinate input and covers layout and suppression states", () => {
  assert.match(source, /dispatchWindowsNativeClick/);
  assert.match(source, /prepareWindowsNativeBubbleHit/);
  assert.match(source, /waitForTelemetryAfter/);
  assert.match(source, /proactive_bubble_overlay_hit_changed/);
  assert.match(source, /overlayHitState === "active"/);
  assert.match(source, /overlayHitAuthority === "main_poll"/);
  assert.match(source, /p2-83a-sendinput-click\.ps1/);
  assert.match(source, /clientX: rect\.left \+ rect\.width \/ 2/);
  assert.match(source, /deviceScaleFactor: window\.devicePixelRatio/);
  assert.match(source, /getNativeWindowHandleForAcceptance/);
  assert.match(source, /expectedPid = context\.child\?\.pid/);
  assert.match(source, /createWindowsNativeClickArgs/);
  assert.match(source, /Windows SetCursorPos plus SendInput screen-coordinate click/);
  assert.doesNotMatch(source, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(source, /\.click\s*\(/);
  assert.match(nativeClickSource, /SetCursorPos/);
  assert.match(nativeClickSource, /SendInput/);
  assert.match(nativeClickSource, /SetProcessDpiAwarenessContext/);
  assert.match(nativeClickSource, /new IntPtr\(-4\)/);
  assert.match(nativeClickSource, /clientX \* deviceScaleFactor/);
  assert.match(nativeClickSource, /ClientToScreen/);
  assert.match(nativeClickSource, /WindowFromPoint/);
  assert.match(nativeClickSource, /GetWindowThreadProcessId/);
  assert.match(nativeClickSource, /GetAncestor/);
  assert.match(nativeClickSource, /Expected Electron window moved before SendInput/);
  assert.match(nativeClickSource, /AssertPointTarget\(clientPoint, expectedHwnd, expectedPid, "before SendInput"\)/);
  assert.match(nativeClickSource, /GetCursorPos\(out originalCursor\)/);
  assert.match(nativeClickSource, /FindOutsidePoint\(beforeMove\)/);
  assert.match(nativeClickSource, /SetCursorPos\(outsidePoint\.x, outsidePoint\.y\)/);
  assert.match(nativeClickSource, /SetCursorPos\(clientPoint\.x, clientPoint\.y\)/);
  assert.match(nativeClickSource, /IsExpectedPointTarget\(clientPoint, expectedHwnd, expectedPid\)/);
  assert.match(nativeClickSource, /Thread\.Sleep\(pollIntervalMilliseconds\)/);
  assert.match(nativeClickSource, /Stopwatch\.StartNew\(\)/);
  assert.match(nativeClickSource, /activationClock\.ElapsedMilliseconds <= activationTimeoutMilliseconds/);
  assert.doesNotMatch(nativeClickSource, /Environment\.TickCount64/);
  assert.match(nativeClickSource, /Native point target activation timed out before SendInput/);
  assert.match(nativeClickSource, /finally \{\s*if \(!keepCursorAtTarget\) SetCursorPos\(originalCursor\.x, originalCursor\.y\);\s*\}/);
  assert.match(source, /"-PollIntervalMilliseconds", "25"/);
  assert.match(source, /"-ActivationTimeoutMilliseconds", "2000"/);
  assert.match(source, /"-OutsideSettleMilliseconds", "60"/);
  assert.match(nativeClickSource, /AssertProcess\(targetRoot, expectedPid, "point target root " \+ phase\)/);
  assert.match(nativeClickSource, /AssertProcess\(expectedHwnd, expectedPid, "expected HWND after SendInput"\)/);
  assert.match(nativeClickSource, /Expected Electron window moved during SendInput/);
  assert.match(nativeClickSource, /if \(prepareOnly\) return clientPoint\.x/);
  assert.doesNotMatch(nativeClickSource, /CursorAlreadyPrepared|cursorAlreadyPrepared|Prepared cursor is no longer/);
  assert.match(source, /runWindowsNativeMouse\(target, \["-PrepareOnly", "-KeepCursorAtTarget"\]\)/);
  assert.match(source, /runWindowsNativeMouse\(target, \[\]\)/);
  assert.match(nativeClickSource, /0x0002/);
  assert.match(nativeClickSource, /0x0004/);
  assert.match(source, /Emulation\.setDeviceMetricsOverride/);
  assert.doesNotMatch(source, /Browser\.setWindowBounds/);
  assert.match(source, /"narrow"/);
  assert.match(source, /"right-half"/);
  assert.match(source, /lowerBodyOutside/);
  assert.match(source, /window\.moveTo/);
  for (const scenario of ["quiet", "off", "busy"]) {
    assert.match(source, new RegExp(`scenario: "${scenario}"`));
  }
});

test("native click ownership is bound to the acceptance pet HWND and owned Electron PID", () => {
  assert.match(appSource, /ipcMain\.handle\("pet:p2-83a-native-window-handle"/);
  assert.match(appSource, /process\.platform !== "win32"/);
  assert.match(appSource, /AI_DESKTOP_PET_P2_83A_SAFE_INJECTION/);
  assert.match(appSource, /petWindow\.getNativeWindowHandle\(\)/);
  assert.match(petPreloadSource, /getNativeWindowHandleForAcceptance/);
  assert.match(petPreloadSource, /^\s*return typeof value === "string" && \/\^\\d\{1,20\}\$\/u\.test\(value\) \? value : null;/m);
  const verifyIndex = nativeClickSource.indexOf("AssertPointTarget(clientPoint, expectedHwnd, expectedPid, \"before SendInput\")");
  const sendIndex = nativeClickSource.indexOf("var sent = SendInput");
  assert.ok(verifyIndex >= 0 && sendIndex > verifyIndex);
  assert.doesNotMatch(nativeClickSource.slice(0, verifyIndex), /SendInput\(\(uint\)inputs\.Length/);
});

test("P2-83A runner has one total deadline and cleans only its owned process trees", () => {
  assert.match(source, /RUNNER_TOTAL_TIMEOUT_MS/);
  assert.match(source, /calculateRunnerTotalTimeoutMs\([\s\S]*cases\.length,[\s\S]*process\.env\.P2_83A_TOTAL_TIMEOUT_MS/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /abortController\.abort\(new Error\("runner_total_timeout"\)\)/);
  assert.match(source, /runCases\(abortController\.signal\)/);
  assert.match(source, /throwIfAborted\(signal\);[\s\S]*startElectron\(context\)/);
  assert.match(source, /const child = startElectron\(context\);[\s\S]*captureOwnedProcessTree\(child\.pid, process\.pid, "electron\.exe"\)[\s\S]*selectInitialOwnedRootIdentity/);
  assert.match(source, /context\.p283aOwnedRootIdentity = fixedRootIdentity/);
  assert.match(source, /runStep\(signal,/);
  assert.match(source, /activeContexts/);
  assert.match(source, /context\.p283aOwnedRootPid \?\? context\.child\?\.pid/);
  assert.match(source, /spawnSync\("taskkill\.exe", \["\/PID", String\(identity\.pid\), "\/F"\]/);
  assert.doesNotMatch(source, /"\/T"/);
  assert.match(source, /timeout: 10_000/);
});

test("runner total budget scales with case count and clamps environment overrides", () => {
  assert.equal(calculateRunnerTotalTimeoutMs(8, undefined), 325_000);
  assert.ok(calculateRunnerTotalTimeoutMs(8, undefined) >= 300_000);
  assert.equal(calculateRunnerTotalTimeoutMs(1, undefined), 80_000);
  assert.equal(calculateRunnerTotalTimeoutMs(8, "1"), 60_000);
  assert.equal(calculateRunnerTotalTimeoutMs(8, "999999"), 420_000);
  assert.equal(calculateRunnerTotalTimeoutMs(8, "invalid"), 325_000);
});

test("native click runs first and every scenario blocks on cursor and owned-window isolation", () => {
  const casesStart = source.indexOf("const allCases = [");
  const searchIndex = source.indexOf('candidateId: "search_citation_safe"', casesStart);
  const musicIndex = source.indexOf('candidateId: "music_started"', casesStart);
  assert.ok(casesStart >= 0 && searchIndex > casesStart && musicIndex > searchIndex);
  assert.match(source, /context\.p283aNativeHwnd = await runStep/);
  assert.match(source, /const captured = captureOwnedProcessTree\(ownedPid, process\.pid, "electron\.exe"\)/);
  assert.match(source, /moveCursorToNeutralPosition\(expectedHwnd\)/);
  assert.match(source, /killOwnedElectronTree\(context, identityFile\)/);
  assert.match(source, /waitForOwnedProcessTreeExit\(identityFile, 8_000, true\)/);
  assert.match(source, /probeOwnedProcessIdentities\(identityFile\)\.length > 0/);
  assert.match(source, /waitForOldHwndInvalidation\(expectedHwnd, identityFile\)/);
  assert.match(source, /finally \{\s*await stopAndCleanupContext\(context\);\s*\}/);

  assert.match(neutralCursorSource, /SetProcessDpiAwarenessContext\(new IntPtr\(-4\)\)/);
  assert.match(neutralCursorSource, /GetSystemMetrics\(76\)/);
  assert.match(neutralCursorSource, /insideOldWindow/);
  assert.match(neutralCursorSource, /SetCursorPos\(selectedX, selectedY\)/);
  assert.doesNotMatch(neutralCursorSource, /SendInput|mouse_event/i);

  assert.match(captureTreeSource, /Get-CimInstance Win32_Process/);
  assert.match(captureTreeSource, /ParentProcessId/);
  assert.match(captureTreeSource, /Select-Object ProcessId, ParentProcessId, Name, CreationDate/);
  assert.match(captureTreeSource, /\[UInt32\]\$ExpectedParentPid/);
  assert.match(captureTreeSource, /\[ValidateSet\('electron\.exe'\)\]/);
  assert.match(captureTreeSource, /\[string\]\$root\.Name -cne \$ExpectedRootName/);
  assert.match(captureTreeSource, /\[UInt32\]\$root\.ParentProcessId -ne \$ExpectedParentPid/);
  assert.match(captureTreeSource, /Console\]::Out\.WriteLine\('\[\]'\)[\s\S]*Root process ownership does not match/);
  assert.match(captureTreeSource, /CreationDate/);
  assert.match(captureTreeSource, /creationTimeUtcTicks/);
  assert.match(captureTreeSource, /'root'/);
  assert.match(captureTreeSource, /'descendant'/);
  assert.match(captureTreeSource, /Queue\[UInt32\]/);
  assert.match(captureTreeSource, /\$childCreation -lt \$parentCreation/);
  assert.match(captureTreeSource, /\[string\]\$process\.Name -ieq \$rootName/);
  assert.match(captureTreeSource, /crashpad_handler\.exe/);
  assert.match(captureTreeSource, /\$owned\.Count -ge 32/);
  assert.match(captureTreeSource, /Owned process identity limit exceeded/);
  assert.match(waitOwnedExitSource, /System\.Diagnostics\.Stopwatch/);
  assert.match(waitOwnedExitSource, /IdentityFile/);
  assert.match(waitOwnedExitSource, /creationTimeUtcTicks/);
  assert.match(waitOwnedExitSource, /Get-CreationTicks \$current/);
  assert.match(waitOwnedExitSource, /if \(\$survivors\.Count -eq 0\)/);
  assert.match(waitOwnedExitSource, /survivorCount = \$survivors\.Count/);
  assert.match(waitOwnedExitSource, /rootAlive = \$rootAlive/);
  assert.match(waitOwnedExitSource, /descendantAliveCount = \$descendantAliveCount/);
  assert.match(waitOwnedExitSource, /safe_failure:/);
  assert.match(probeOwnedSource, /creationTimeUtcTicks/);
  assert.match(probeOwnedSource, /role = \$identity\.role/);
  assert.match(waitHwndInvalidSource, /GetWindowThreadProcessId/);
  assert.match(waitHwndInvalidSource, /creationTimeUtcTicks/);
  assert.match(waitHwndInvalidSource, /old_hwnd_owner_reused/);
  assert.match(waitHwndInvalidSource, /safe_failure:/);
});

test("cleanup validates the fixed root generation before capturing descendants or killing", () => {
  assert.match(source, /SAFE_CLEANUP_STAGES = new Set/);
  assert.match(source, /SAFE_CLEANUP_REASONS = new Set/);
  for (const stage of [
    "connection_close", "owned_process_snapshot", "native_cursor_neutralize",
    "owned_process_kill", "owned_process_wait", "hwnd_invalidation", "user_data_removal"
  ]) {
    assert.match(source, new RegExp(`"${stage}"`));
  }
  assert.match(source, /readSafeCleanupDiagnostic\(error\)/);
  assert.match(source, /Promise\.allSettled\(\[\.\.\.activeContexts\]\.map\(stopAndCleanupContext\)\)/);
  assert.match(source, /context\.p283aOwnedIdentities = \[\.\.\.ownedIdentities\]/);
  assert.match(source, /writeOwnedProcessIdentityFile\(context, ownedIdentities\)/);
  assert.match(source, /owned-process-identities\.json/);
  const closeIndex = source.indexOf('cleanupStep("connection_close"');
  const snapshotIndex = source.indexOf('cleanupStep("owned_process_snapshot"');
  const killIndex = source.indexOf('cleanupStep("owned_process_kill"');
  assert.ok(closeIndex >= 0 && snapshotIndex > closeIndex && killIndex > snapshotIndex);
  assert.match(source, /const currentRoot = probeOwnedProcessIdentities\(identityFile\)[\s\S]*isSameOwnedProcessIdentity\(fixedRootIdentity, currentRoot\)/);
  assert.match(source, /if \(!isSameOwnedProcessIdentity\(fixedRootIdentity, capturedRoot\)\)/);
  assert.match(source, /if \(rootIdentityValidated && ownedIdentities\.length > 0 && identityFile\)/);
  assert.match(source, /ownedIdentities = \[\];[\s\S]*identityFile = null;[\s\S]*return;/);
  assert.match(captureTreeSource, /Console\]::Out\.WriteLine\('\[\]'\)[\s\S]*exit 0/);
  assert.match(source, /const maxRounds = 3/);
  assert.match(source, /probeOwnedProcessIdentities\(identityFile\)/);
  assert.match(source, /isSameOwnedProcessIdentity\(identity, current\)/);
  assert.match(source, /if \(result\.status !== 0\)/);
  assert.match(source, /isTaskkillFailureIdempotent\(identity, afterFailure\)/);
  assert.match(source, /throw new OwnedProcessCleanupError\("owned_process_kill_failed", afterFailure\)/);
  assert.match(source, /waitForOwnedProcessTreeExit\(identityFile, 350, false\)/);
  assert.match(source, /survivorCount:[\s\S]*rootAlive:[\s\S]*descendantAliveCount:/);
  assert.match(source, /if \(!cleanupError\) \{[\s\S]*cleanupStep\("user_data_removal"/);
  assert.match(source, /closeOwnedProcessLogStreams\(context\.p283aOwnedChild\)/);
  assert.match(source, /removeAllListeners\("data"\)/);
  assert.match(source, /stream\?\.destroy\(\)/);
  assert.match(source, /cleanupRealUiRun\(context\)/);
});

test("P2-83A quiet case preloads an exhausted isolated ledger and verifies suppression", () => {
  assert.match(source, /scenario: "quiet", expectShown: false, expectedSkip: "daily_total_limit"/);
  assert.match(source, /prepareExhaustedQuietLedger\(context\)/);
  assert.match(source, /dailyTotal: 2/);
  assert.match(source, /startupDateKey: dateKey/);
  assert.match(source, /decision\?\.payload\?\.skipReason === testCase\.expectedSkip/);
});

test("all scenarios wait for first frame and only await an observed appearance lifecycle", () => {
  assert.match(source, /stage = "first_frame";[\s\S]*event\.type === "first_frame", 15_000/);
  assert.match(source, /stage = "appearance_observation";[\s\S]*observeAppearanceLifecycle\(context\)/);
  assert.match(source, /APPEARANCE_STARTED_OBSERVATION_MS = Math\.min\([\s\S]*2_000,[\s\S]*Math\.max\(100,/);
  assert.match(source, /startedIndex = events\.findIndex\(\(event\) =>[\s\S]*event\.type === "pet_interaction_action_started" && event\.payload\?\.type === "appearance"/);
  assert.match(source, /events\.slice\(startedIndex \+ 1\)\.find/);
  assert.match(source, /event\.type === "pet_interaction_action_finished" \|\|[\s\S]*event\.type === "pet_interaction_action_skipped"/);
  assert.match(source, /if \(startedIndex < 0\) return "not_started";/);
  assert.match(source, /throw new Error\("appearance_terminal_timeout"\)/);
  assert.doesNotMatch(source, /waitForTelemetry\(context, \(event\) =>\s*event\.type === "pet_interaction_action_finished" && event\.payload\?\.type === "appearance"/);
});

test("negative scenarios keep their additional finite stability window", () => {
  assert.match(source, /if \(testCase\.expectShown === false\) \{/);
  assert.match(source, /stage = "negative_stable";[\s\S]*sleep\(NEGATIVE_SCENARIO_STABLE_MS\)/);
  assert.match(source, /NEGATIVE_SCENARIO_STABLE_MS = Math\.min\([\s\S]*2_000,[\s\S]*Math\.max\(100,/);
});

test("pointer controller production contract makes overlay hover interactive before native click", () => {
  assert.match(pointerControllerSource, /setIgnoreMouseEvents\(true, \{ forward: true \}\)/);
  assert.match(pointerControllerSource, /setOverlayHit\(nextIsHit: boolean\)/);
  assert.match(pointerControllerSource, /isOverlayHit \|\| isPointerHit \|\| isDragging/);
  assert.match(pointerControllerSource, /setIgnoreMouseEvents\(false\)/);
});

test("P2-83A runner does not print raw environment or content fields", () => {
  assert.doesNotMatch(source, /windowTitle|processName|mediaMetadata|memoryBody|historyBody|searchQuery|prompt|apiKey/i);
});

test("bubble visibility wait reports closed candidate and action diagnostics", () => {
  assert.match(source, /waitForBubbleVisibleWithDiagnostics/);
  assert.match(source, /candidateTelemetryStartIndex = readTelemetryEvents\(context\)\.length/);
  assert.match(source, /SAFE_CANDIDATE_STATUSES = new Set/);
  assert.match(source, /SAFE_CANDIDATE_SKIP_REASONS = new Set/);
  assert.match(source, /SAFE_ACTION_LIFECYCLES = new Map/);
  assert.match(source, /SAFE_ACTION_TERMINAL_STATUSES = new Set/);
  assert.match(source, /diagnostic\.status === "skipped" \|\| diagnostic\.status === "expired"/);
  assert.match(source, /diagnostic\.safeReason === "action_handshake_timeout"/);
  assert.match(source, /candidate_shown_without_visible_bubble/);
  assert.match(source, /bubble_visible_timeout_with_candidate_diagnostic/);
  assert.match(source, /candidate: testCase\.candidateId,[\s\S]*status,[\s\S]*safeReason: skipReason,[\s\S]*actionLifecycle,[\s\S]*actionTerminalStatus/);
  assert.doesNotMatch(source, /candidateEvent\.payload\s*[},]|actionEvent\.payload\s*[},]/);
});

test("runner waits for this-run main region registration before native hover", () => {
  assert.match(source, /stage = "overlay_region_registered"/);
  assert.match(source, /waitForOverlayRegionRegistration\([\s\S]*candidateTelemetryStartIndex/);
  assert.match(source, /event\.type === "proactive_bubble_overlay_region_changed"/);
  assert.match(source, /event\.payload\?\.authority === "main"/);
  assert.match(source, /event\.payload\?\.regionState === "rejected"/);
  assert.match(source, /region_rejected/);
  assert.match(source, /region_registration_timeout/);
  const regionWaitIndex = source.indexOf('stage = "overlay_region_registered"');
  const nativeHoverIndex = source.indexOf('stage = "native_hover"');
  assert.ok(regionWaitIndex >= 0 && nativeHoverIndex > regionWaitIndex);
});
