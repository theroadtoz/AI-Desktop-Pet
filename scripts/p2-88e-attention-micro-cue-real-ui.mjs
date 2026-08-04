import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
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
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { runWithRealUiDeadline } from "./support/real-ui-run-deadline.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const POSITIVE_MESSAGE = "西塔，你猜我刚才发现了什么？";
const NEGATIVE_MESSAGE = "你猜一下为什么这个程序会报错？";
const RUNTIME_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 600_000;
const SHADOW_EVENT_TYPE = "xita_interaction_cue_shadow_observed";

export function resolveBundledPackRoot({
  repoRoot = root,
  override = process.env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT ?? "",
  realpath = realpathSync.native
} = {}) {
  let packRoot;
  try {
    packRoot = realpath(join(repoRoot, "resources", "local-llm"));
  } catch {
    return { ok: false, bundledRootExact: false, failure: "bundled_root_unavailable" };
  }

  const requestedOverride = typeof override === "string" ? override.trim() : "";
  if (requestedOverride) {
    let overrideRoot;
    try {
      overrideRoot = realpath(resolve(requestedOverride));
    } catch {
      return { ok: false, bundledRootExact: false, failure: "external_source_override" };
    }
    if (normalizeWindowsPath(overrideRoot) !== normalizeWindowsPath(packRoot)) {
      return { ok: false, bundledRootExact: false, failure: "external_source_override" };
    }
  }

  return { ok: true, bundledRootExact: true, packRoot };
}

export function validatePositiveTransitionSequence(transitions) {
  const startedIndices = [];
  const terminalIndices = [];
  for (let index = 0; index < transitions.length; index += 1) {
    const status = transitions[index]?.status;
    if (status === "started") startedIndices.push(index);
    if (status === "released" || status === "owner-active") terminalIndices.push(index);
  }
  const terminal = terminalIndices.length === 1 ? transitions[terminalIndices[0]] : null;
  const ordered = startedIndices.length === 1 && terminalIndices.length === 1 &&
    startedIndices[0] === 0 && terminalIndices[0] === 1;
  const replayed = startedIndices.length > 1 ||
    (terminalIndices.length === 1 && startedIndices.some((index) => index > terminalIndices[0]));
  const releasedAfterOwnershipLoss = terminal?.status === "owner-active" &&
    transitions.slice(terminalIndices[0] + 1).some((entry) => entry?.status === "released");
  const terminalAccepted = terminal?.status === "released" ? terminal?.accepted === true : terminal?.accepted === false;
  return {
    ok: transitions.length === 2 && ordered && !replayed && !releasedAfterOwnershipLoss &&
      transitions[0]?.accepted === true && terminalAccepted,
    transitionCount: transitions.length,
    startedCount: startedIndices.length,
    terminalCount: terminalIndices.length,
    ordered,
    replayed,
    releasedAfterOwnershipLoss,
    terminalStatus: terminal?.status === "released" || terminal?.status === "owner-active" ? terminal.status : null
  };
}

export function validateBlockedTransitionSequence(transitions, expectedStatus) {
  const startedCount = transitions.filter((entry) => entry?.status === "started").length;
  const releasedCount = transitions.filter((entry) => entry?.status === "released").length;
  const blockedCount = transitions.filter((entry) =>
    entry?.status === expectedStatus && entry?.accepted === false).length;
  const exactBlockedOnly = transitions.length === 1 && blockedCount === 1;
  return {
    ok: exactBlockedOnly && startedCount === 0 && releasedCount === 0,
    transitionCount: transitions.length,
    startedCount,
    releasedCount,
    blockedCount,
    exactBlockedOnly
  };
}

function normalizeWindowsPath(path) {
  return resolve(path).replaceAll("/", "\\").replace(/\\+$/u, "").toLocaleLowerCase("en-US");
}

export function runWindowsAcceptanceCommand(file, args, spawn = spawnSync) {
  const result = spawn(file, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true
  });
  if (result.error || result.signal || result.status !== 0) {
    return { ok: false, stdout: String(result.stdout ?? "") };
  }
  return { ok: true, stdout: String(result.stdout ?? "") };
}

const runWindowsCommand = runWindowsAcceptanceCommand;

function readOwnedProcessTree(rootPid, commandRunner = runWindowsCommand) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) {
    return { ok: false, processes: [] };
  }
  const command = `
    $owned = New-Object 'System.Collections.Generic.HashSet[int]'
    [void]$owned.Add(${rootPid})
    $processes = @(Get-CimInstance Win32_Process)
    do {
      $before = $owned.Count
      $processes | Where-Object { $owned.Contains([int]$_.ParentProcessId) } | ForEach-Object { [void]$owned.Add([int]$_.ProcessId) }
    } while ($owned.Count -gt $before)
    @($processes | Where-Object { $owned.Contains([int]$_.ProcessId) } | ForEach-Object { @{ pid = [int]$_.ProcessId; name = [string]$_.Name } }) | ConvertTo-Json -Compress
  `;
  const result = commandRunner("powershell.exe", ["-NoProfile", "-Command", command]);
  if (!result.ok || !result.stdout.trim()) return { ok: false, processes: [] };
  try {
    const parsed = JSON.parse(result.stdout.trim());
    const processes = (Array.isArray(parsed) ? parsed : [parsed]).filter((entry) =>
      Number.isSafeInteger(entry?.pid) && entry.pid > 0);
    return processes.length > 0 ? { ok: true, processes } : { ok: false, processes: [] };
  } catch {
    return { ok: false, processes: [] };
  }
}

function recordOwnedProcessTree(context, discover = readOwnedProcessTree) {
  const rootPid = Number(context.child?.pid ?? context.p288eRootPid ?? 0);
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return false;
  context.p288eRootPid = rootPid;
  context.p288eOwnedPids ??= new Set();
  context.p288eOwnedLlamaPids ??= new Set();
  const discovery = discover(rootPid);
  if (!discovery.ok) return false;
  for (const process of discovery.processes) {
    context.p288eOwnedPids.add(process.pid);
    if (/^llama-server(?:\.exe)?$/iu.test(process.name)) context.p288eOwnedLlamaPids.add(process.pid);
  }
  return true;
}

async function terminateProcessTree(pid, commandRunner = runWindowsCommand) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  return commandRunner("taskkill.exe", ["/PID", String(pid), "/T", "/F"]).ok;
}

function inspectProcess(pid, commandRunner = runWindowsCommand) {
  const result = commandRunner("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
  return {
    ok: result.ok,
    alive: result.ok && new RegExp(`"[^\"]+","${pid}"`, "u").test(result.stdout)
  };
}

function listeningAcceptancePorts(commandRunner = runWindowsCommand) {
  const result = commandRunner("netstat.exe", ["-ano", "-p", "tcp"]);
  return {
    ok: result.ok,
    ports: result.ok
      ? [...result.stdout.matchAll(/^\s*TCP\s+\S+:(9750|9751)\s+\S+\s+LISTENING\s+\d+\s*$/gimu)]
        .map((match) => Number(match[1]))
      : []
  };
}

async function inspectAttentionResidue(context, processInspector = inspectProcess, portInspector = listeningAcceptancePorts) {
  const ownedPids = [...(context.p288eOwnedPids ?? [])];
  const ownedLlamaPids = [...(context.p288eOwnedLlamaPids ?? [])];
  const processResults = ownedPids.map((pid) => ({ pid, ...processInspector(pid) }));
  const llamaResults = ownedLlamaPids.map((pid) => ({ pid, ...processInspector(pid) }));
  const ports = portInspector();
  return {
    ok: processResults.every((result) => result.ok) && llamaResults.every((result) => result.ok) && ports.ok,
    liveOwnedPids: processResults.filter((result) => result.alive).map((result) => result.pid),
    listeningPorts: [...new Set(ports.ports)],
    liveOwnedLlamaPids: llamaResults.filter((result) => result.alive).map((result) => result.pid),
    tmpExists: existsSync(context.runParentDir)
  };
}

export async function cleanupAttentionRun(context, dependencies = {}) {
  const stop = dependencies.stopElectron ?? stopElectron;
  const terminate = dependencies.terminateProcessTree ?? terminateProcessTree;
  const discover = dependencies.discoverProcessTree ?? readOwnedProcessTree;
  const inspectProcessState = dependencies.inspectProcess ?? inspectProcess;
  const cleanupRun = dependencies.cleanupRun ?? cleanupRealUiRun;
  const inspect = dependencies.inspectResidue ?? inspectAttentionResidue;
  const processDiscoveryOk = recordOwnedProcessTree(context, discover);
  const rootPid = Number(context.p288eRootPid ?? context.child?.pid ?? 0);
  const ownedPids = [...new Set([rootPid, ...(context.p288eOwnedPids ?? [])])]
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  let cleanupError = !processDiscoveryOk;
  for (const pid of ownedPids) {
    try {
      const processState = await inspectProcessState(pid);
      if (!processState.ok || (processState.alive && await terminate(pid) !== true)) cleanupError = true;
    } catch { cleanupError = true; }
  }
  try { await stop(context); } catch { cleanupError = true; }
  try { cleanupRun(context); } catch { cleanupError = true; }
  let residue;
  try {
    residue = await inspect(context);
  } catch {
    residue = {
      ok: false,
      liveOwnedPids: ownedPids,
      listeningPorts: [],
      liveOwnedLlamaPids: [...(context.p288eOwnedLlamaPids ?? [])],
      tmpExists: existsSync(context.runParentDir)
    };
  }
  return {
    ...residue,
    ok: !cleanupError && residue.ok === true && residue.liveOwnedPids.length === 0 && residue.listeningPorts.length === 0 &&
      residue.liveOwnedLlamaPids.length === 0 && residue.tmpExists === false,
    processDiscoveryOk,
    rootPid,
    ownedPids,
    ownedLlamaPids: [...(context.p288eOwnedLlamaPids ?? [])],
    runParentDir: context.runParentDir
  };
}

export function finalizeAttentionModeResult(result, cleanup) {
  return {
    ...result,
    ok: result?.ok === true && cleanup?.ok === true,
    cleanup
  };
}

async function main() {
  const packResolution = resolveBundledPackRoot();
  if (!packResolution.ok) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      runtimePath: "preflight",
      provider: "unproven",
      bundledRootExact: false,
      failure: packResolution.failure
    })}\n`);
    process.exitCode = 1;
    return;
  }
  const summary = {
    ok: false,
    runtimePath: "production_electron_bundled_local_model",
    provider: "embedded-llama-cpp",
    bundledRootExact: true,
    checks: {}
  };
  try {
    const off = await runMode({ rollout: false, port: 9750, packRoot: packResolution.packRoot });
    const defaultOn = await runMode({ rollout: true, port: 9751, packRoot: packResolution.packRoot });
    summary.checks = { off, defaultOn };
    summary.ok = off.ok && defaultOn.ok;
  } catch (error) {
    summary.failure = classifyFailure(error);
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

async function runMode({ rollout, port, packRoot }) {
  const runName = `p2-88e-attention-micro-cue-real-ui-${rollout ? "default" : "off"}`;
  const context = createRealUiRunContext({
    runName,
    port,
    env: {
      AI_DESKTOP_PET_PROVIDER: "",
      AI_DESKTOP_PET_API_KEY: "",
      AI_DESKTOP_PET_BASE_URL: "",
      AI_DESKTOP_PET_MODEL: "",
      AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: packRoot,
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      ...(rollout ? {} : { AI_DESKTOP_PET_ATTENTION_MICRO_CUE_ROLLOUT: "0" })
    },
    tmpResiduePatterns: [new RegExp(`^${runName}$`, "i")]
  });
  context.electronArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

  let result;
  try {
    result = await runWithRealUiDeadline(() => runElectronMode(context, rollout), RUN_TIMEOUT_MS);
  } catch (error) {
    let transitionCount = 0;
    try {
      if (context.p288ePet) transitionCount = (await readTransitions(context.p288ePet)).length;
    } catch {}
    result = {
      ok: false,
      rollout,
      failureStage: context.p288eStage ?? "entry",
      failure: classifyFailure(error),
      transitionCount
    };
  } finally {
    const cleanup = await cleanupAttentionRun(context);
    result = finalizeAttentionModeResult(result ?? {
      ok: false,
      rollout,
      failureStage: context.p288eStage ?? "entry",
      failure: "runner_error"
    }, cleanup);
  }
  return result;
}

async function runElectronMode(context, rollout) {
  context.p288eStage = "electron_start";
  startElectron(context);
  context.p288eRootPid = Number(context.child?.pid ?? 0);
  recordOwnedProcessTree(context);
  context.p288eStage = "cdp_connect";
  await connectToElectron(context, 45_000);
  context.p288eStage = "pet_window";
  const pet = await waitForWindow(context, "renderer/pet/index.html", 45_000);
  context.p288ePet = pet;
  await waitFor(pet, `(() => {
    const canvas = document.querySelector("#pet-canvas");
    return Boolean(window.petApi?.openChat && canvas && canvas.width > 0 && canvas.height > 0);
  })()`, { timeoutMs: 30_000 });
  context.p288eStage = "startup_appearance";
  await waitForStartupAppearanceFinished(context, 20_000);
  await evaluate(pet, "window.petApi.openChat()");
  context.p288eStage = "chat_window";
  const chat = await waitForWindow(context, "renderer/chat/index.html", 45_000);
  await waitFor(chat, "Boolean(window.configApi?.getProviderStatus && document.querySelector('#chat-input'))", {
    timeoutMs: 30_000
  });
  context.p288eStage = "embedded_runtime";
  const handoff = await waitForEmbeddedRuntime(context);
  recordOwnedProcessTree(context);
  context.p288eStage = "embedded_provider";
  const provider = await waitForEmbeddedProvider(chat, handoff);
  await installTransitionObserver(pet);
  await waitForActionIdle(context, 20_000);

  const providerEmbedded = provider?.providerId === "local-openai-compatible" &&
    provider?.isFallback === false && handoff?.localPresetId === "embedded-llama-cpp";

  if (!rollout) {
    context.p288eStage = "rollout_off_request";
    const startIndex = readTelemetry(context).length;
    const transitionIndex = (await readTransitions(pet)).length;
    await prepareMessage(chat, POSITIVE_MESSAGE);
    await waitForActionIdle(context, 20_000);
    const reply = await submitMessage(chat);
    const shadow = await waitForTelemetry(context, startIndex, (event) => event.type === SHADOW_EVENT_TYPE, 10_000);
    const transitions = (await readTransitions(pet)).slice(transitionIndex);
    const noBodyLeak = !JSON.stringify([shadow, transitions]).includes(POSITIVE_MESSAGE);
    assertNoScreenshotResidue(context);
    return {
      ok: providerEmbedded && reply.completed && transitions.length === 0 && noBodyLeak,
      providerEmbedded,
      realReplyCompleted: reply.completed,
      shadowObserved: Boolean(shadow),
      cueTransitionCount: transitions.length,
      noBodyLeak
    };
  }

  context.p288eStage = "positive";
  const positive = await runPositive(context, pet, chat);
  context.p288eStage = "negative";
  const negative = await runNegative(context, pet, chat);
  context.p288eStage = "conflict";
  const conflict = await runConflict(context, pet, chat);
  context.p288eStage = "recovery";
  const recovery = await runRecovery(context, pet, chat);
  context.p288eStage = "hidden";
  const hidden = await runHidden(context, pet, chat);
  const allEvidence = [positive, negative, conflict, recovery, hidden];
  const noBodyLeak = !JSON.stringify(allEvidence).includes(POSITIVE_MESSAGE) &&
    !JSON.stringify(allEvidence).includes(NEGATIVE_MESSAGE);
  assertNoScreenshotResidue(context);

  return {
    ok: providerEmbedded && allEvidence.every((entry) => entry.ok) && noBodyLeak,
    providerEmbedded,
    positive,
    negative,
    conflict,
    recovery,
    hidden,
    noBodyLeak
  };
}

async function runPositive(context, pet, chat) {
  await prepareMessage(chat, POSITIVE_MESSAGE);
  await waitForActionIdle(context, 20_000);
  const telemetryIndex = readTelemetry(context).length;
  const transitionIndex = (await readTransitions(pet)).length;
  const replyPromise = submitMessage(chat);
  const shadow = await waitForTelemetry(context, telemetryIndex, (event) => event.type === SHADOW_EVENT_TYPE, 10_000);
  await waitForTransition(pet, transitionIndex, "started", 5_000);
  await waitForAnyTransition(pet, transitionIndex, ["released", "owner-active"], 5_000);
  const reply = await replyPromise;
  await sleep(1_200);
  const transitionEvidence = validatePositiveTransitionSequence(
    (await readTransitions(pet)).slice(transitionIndex)
  );
  return {
    ok: Boolean(shadow) && transitionEvidence.ok && reply.completed,
    shadowObserved: Boolean(shadow),
    transitionEvidence,
    realReplyCompleted: reply.completed
  };
}

async function runNegative(context, pet, chat) {
  await waitForActionIdle(context, 20_000);
  await prepareMessage(chat, NEGATIVE_MESSAGE);
  await waitForActionIdle(context, 20_000);
  const telemetryIndex = readTelemetry(context).length;
  const transitionIndex = (await readTransitions(pet)).length;
  const reply = await submitMessage(chat);
  await sleep(1_400);
  const transitions = (await readTransitions(pet)).slice(transitionIndex);
  const shadowCount = readTelemetry(context).slice(telemetryIndex).filter((event) => event.type === SHADOW_EVENT_TYPE).length;
  return {
    ok: reply.completed && transitions.length === 0 && shadowCount === 0,
    realReplyCompleted: reply.completed,
    cueTransitionCount: transitions.length,
    shadowCount
  };
}

async function runConflict(context, pet, chat) {
  await waitForActionIdle(context, 20_000);
  await prepareMessage(chat, POSITIVE_MESSAGE);
  await waitForActionIdle(context, 20_000);
  const actionIndex = readTelemetry(context).length;
  if (await triggerBodyClick(pet) !== true) throw new Error("body_click_failed");
  const owner = await waitForTelemetry(
    context,
    actionIndex,
    (event) => event.type === "pet_interaction_action_started" && event.payload?.reason === "click_body",
    5_000
  );
  const transitionIndex = (await readTransitions(pet)).length;
  const shadowIndex = readTelemetry(context).length;
  const replyPromise = submitMessage(chat);
  const shadow = await waitForTelemetry(
    context,
    shadowIndex,
    (event) => event.type === SHADOW_EVENT_TYPE,
    10_000
  );
  const reply = await replyPromise;
  await sleep(1_200);
  const transitions = (await readTransitions(pet)).slice(transitionIndex);
  return {
    ok: Boolean(owner) && Boolean(shadow) && transitions.length === 0 && reply.completed,
    ownerStarted: Boolean(owner),
    shadowObserved: Boolean(shadow),
    cueTransitionCount: transitions.length,
    realReplyCompleted: reply.completed
  };
}

async function runRecovery(context, pet, chat) {
  await waitForActionIdle(context, 20_000);
  await prepareMessage(chat, POSITIVE_MESSAGE);
  await waitForActionIdle(context, 20_000);
  const recoveryIndex = readTelemetry(context).length;
  if (await loseAndRestoreWebGLContext(pet) !== true) throw new Error("webgl_context_loss_unavailable");
  await waitForTelemetry(context, recoveryIndex, (event) => event.type === "recovery_started", 5_000);
  const transitionIndex = (await readTransitions(pet)).length;
  const replyPromise = submitMessage(chat);
  await waitForTransition(pet, transitionIndex, "recovering", 5_000);
  const recoveryTerminal = await waitForTelemetry(
    context,
    recoveryIndex,
    (event) => event.type === "recovery_succeeded" || event.type === "recovery_failed",
    15_000
  );
  const reply = await replyPromise;
  await sleep(1_200);
  const transitionEvidence = validateBlockedTransitionSequence(
    (await readTransitions(pet)).slice(transitionIndex),
    "recovering"
  );
  return {
    ok: transitionEvidence.ok && recoveryTerminal.type === "recovery_succeeded" && reply.completed,
    transitionEvidence,
    recoveryTerminal: recoveryTerminal.type,
    realReplyCompleted: reply.completed
  };
}

async function runHidden(context, pet, chat) {
  await waitForActionIdle(context, 20_000);
  await prepareMessage(chat, POSITIVE_MESSAGE);
  await waitForActionIdle(context, 20_000);
  const telemetryIndex = readTelemetry(context).length;
  const transitionIndex = (await readTransitions(pet)).length;
  let hidden = false;
  try {
    if (!setPetWindowVisibility(context, false)) throw new Error("pet_window_hide_failed");
    hidden = true;
    await waitFor(pet, "document.hidden === true", { timeoutMs: 5_000 });
    const hideTransitions = (await readTransitions(pet)).slice(transitionIndex);
    const requestTransitionIndex = (await readTransitions(pet)).length;
    const reply = await submitMessage(chat);
    const shadow = await waitForTelemetry(context, telemetryIndex, (event) => event.type === SHADOW_EVENT_TYPE, 10_000);
    await sleep(1_400);
    const hiddenRequestTransitions = (await readTransitions(pet)).slice(requestTransitionIndex);
    if (!setPetWindowVisibility(context, true)) throw new Error("pet_window_restore_failed");
    hidden = false;
    await waitFor(pet, "document.hidden === false", { timeoutMs: 10_000 });
    await sleep(1_400);
    const postRestoreTransitions = (await readTransitions(pet)).slice(requestTransitionIndex);
    const replayed = postRestoreTransitions.some((entry) => entry.status === "started");
    return {
      ok: Boolean(shadow) && reply.completed && hiddenRequestTransitions.length === 0 &&
        postRestoreTransitions.length === 0 && !replayed,
      shadowObserved: Boolean(shadow),
      hideCleanup: hideTransitions.map(safeTransition),
      hiddenRequestCueTransitionCount: hiddenRequestTransitions.length,
      postRestoreCueTransitionCount: postRestoreTransitions.length,
      replayed,
      realReplyCompleted: reply.completed
    };
  } catch (error) {
    if (hidden) setPetWindowVisibility(context, true);
    throw error;
  }
}

async function installTransitionObserver(pet) {
  await evaluate(pet, `(() => {
    const canvas = document.querySelector("#pet-canvas");
    if (!canvas) return false;
    window.__p288eTransitions = [];
    window.__p288eObserver?.disconnect?.();
    window.__p288eObserver = new MutationObserver(() => {
      const accepted = canvas.dataset.attentionMicroCueAccepted;
      const status = canvas.dataset.attentionMicroCueStatus;
      if (status) window.__p288eTransitions.push({ accepted, status });
    });
    window.__p288eObserver.observe(canvas, { attributes: true, attributeFilter: [
      "data-attention-micro-cue-accepted", "data-attention-micro-cue-status"
    ] });
    return true;
  })()`);
}

async function readTransitions(pet) {
  return evaluate(pet, `(() => (window.__p288eTransitions ?? []).map((entry) => ({
    accepted: entry.accepted === "true" ? true : entry.accepted === "false" ? false : undefined,
    status: String(entry.status ?? "")
  })))()`);
}

async function waitForTransition(pet, startIndex, status, timeoutMs) {
  return waitForAnyTransition(pet, startIndex, [status], timeoutMs);
}

async function waitForAnyTransition(pet, startIndex, statuses, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await readTransitions(pet)).slice(startIndex).find((entry) => statuses.includes(entry.status));
    if (found) return found;
    await sleep(50);
  }
  throw new Error("cue_transition_timeout");
}

async function prepareMessage(chat, message) {
  await typeText(chat, "#chat-input", message);
}

async function submitMessage(chat) {
  const before = await evaluate(chat, "document.querySelectorAll('.message-pet .message-content').length");
  await click(chat, "#send-button");
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await evaluate(chat, `(() => {
      const input = document.querySelector("#chat-input");
      const replies = [...document.querySelectorAll(".message-pet .message-content")];
      return {
        disabled: Boolean(input?.disabled),
        replyCount: replies.length,
        lastReplyLength: replies.at(-1)?.textContent?.trim().length ?? 0,
        sessionState: document.querySelector("#chat-session-note")?.dataset.state ?? ""
      };
    })()`);
    if (state.replyCount > before && !state.disabled && state.lastReplyLength > 0) return { completed: true };
    if (state.replyCount <= before && !state.disabled && state.sessionState === "error") throw new Error("provider_chat_failed");
    await sleep(200);
  }
  throw new Error("send_timeout");
}

async function triggerBodyClick(pet) {
  return evaluate(pet, `(() => {
    const canvas = document.querySelector("#pet-canvas");
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width * 0.5;
    const y = rect.top + rect.height * 0.72;
    for (const type of ["pointerdown", "pointerup"]) {
      canvas.dispatchEvent(new PointerEvent(type, {
        pointerId: 188, pointerType: "mouse", clientX: x, clientY: y,
        screenX: x, screenY: y, button: 0, buttons: type === "pointerdown" ? 1 : 0, bubbles: true
      }));
    }
    return true;
  })()`);
}

async function loseAndRestoreWebGLContext(pet) {
  return evaluate(pet, `(() => {
    const canvas = document.querySelector("#pet-canvas");
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl") ?? canvas?.getContext("experimental-webgl");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension || gl.isContextLost()) return false;
    extension.loseContext();
    window.setTimeout(() => { if (gl.isContextLost()) extension.restoreContext(); }, 2500);
    return true;
  })()`);
}

function setPetWindowVisibility(context, visible) {
  const command = `
    Add-Type @"
    using System;
    using System.Text;
    using System.Runtime.InteropServices;
    public class P288EWinApi {
      public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
      [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
      [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    }
"@
    $rootProcessId = ${Number(context.child?.pid ?? 0)}
    $owned = New-Object 'System.Collections.Generic.HashSet[int]'
    [void]$owned.Add($rootProcessId)
    do {
      $before = $owned.Count
      Get-CimInstance Win32_Process | Where-Object { $owned.Contains([int]$_.ParentProcessId) } | ForEach-Object { [void]$owned.Add([int]$_.ProcessId) }
    } while ($owned.Count -gt $before)
    $script:target = [IntPtr]::Zero
    $callback = [P288EWinApi+EnumWindowsProc]{
      param([IntPtr]$hwnd, [IntPtr]$lparam)
      $ownerProcessId = 0
      [P288EWinApi]::GetWindowThreadProcessId($hwnd, [ref]$ownerProcessId) | Out-Null
      if (-not $owned.Contains($ownerProcessId)) { return $true }
      $title = New-Object System.Text.StringBuilder 256
      [P288EWinApi]::GetWindowText($hwnd, $title, $title.Capacity) | Out-Null
      if ($title.ToString() -eq 'Desktop Pet') { $script:target = $hwnd; return $false }
      return $true
    }
    [P288EWinApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    if ($script:target -eq [IntPtr]::Zero) { exit 2 }
    if (-not [P288EWinApi]::ShowWindowAsync($script:target, ${visible ? 5 : 0})) { exit 3 }
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true
  });
  return result.status === 0;
}

async function waitForEmbeddedRuntime(context) {
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const events = readTelemetry(context);
    const runtime = [...events].reverse().find((event) => event.type === "bundled_llama_cpp_runtime_status" && event.payload?.status === "ready");
    const handoff = [...events].reverse().find((event) => event.type === "bundled_llama_cpp_provider_handoff");
    if (runtime && handoff?.payload?.providerId === "local-openai-compatible" &&
        handoff.payload?.localPresetId === "embedded-llama-cpp") return handoff.payload;
    await sleep(400);
  }
  throw new Error("embedded_runtime_timeout");
}

async function waitForEmbeddedProvider(chat, handoff) {
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const provider = await evaluate(chat, "window.configApi.getProviderStatus()");
    if (provider?.providerId === "local-openai-compatible" && provider?.isFallback === false &&
        provider?.model === handoff?.alias) return provider;
    await sleep(400);
  }
  throw new Error("embedded_provider_timeout");
}

async function waitForTelemetry(context, startIndex, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = readTelemetry(context).slice(startIndex).find(predicate);
    if (found) return found;
    await sleep(50);
  }
  throw new Error("telemetry_wait_timeout");
}

async function waitForStartupAppearanceFinished(context, timeoutMs) {
  return waitForTelemetry(context, 0, (event) =>
    event.type === "pet_interaction_action_finished" && event.payload?.type === "appearance", timeoutMs);
}

async function waitForActionIdle(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = null;
  while (Date.now() < deadline) {
    if (activeActionIds(readTelemetry(context)).size === 0) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= 500) return;
    } else {
      stableSince = null;
    }
    await sleep(50);
  }
  throw new Error("action_idle_timeout");
}

function activeActionIds(events) {
  const active = new Set();
  for (const event of events) {
    const id = typeof event.payload?.requestId === "string"
      ? `main:${event.payload.requestId}`
      : typeof event.payload?.actionInstanceId === "string" ? `local:${event.payload.actionInstanceId}` : null;
    if (!id) continue;
    if (event.type === "pet_interaction_action_started") active.add(id);
    if (event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped") active.delete(id);
  }
  return active;
}

function readTelemetry(context) {
  const logDir = join(context.appDataDir, "logs");
  if (!existsSync(logDir)) return [];
  return readdirSync(logDir).filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDir, name)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
    .flatMap((path) => readFileSync(path, "utf8").split(/\r?\n/u).flatMap((line) => {
      try { return line ? [JSON.parse(line)] : []; } catch { return []; }
    }));
}

function safeTransition(entry) {
  return { accepted: entry.accepted, status: entry.status };
}

function classifyFailure(error) {
  const message = error instanceof Error ? error.message : "runner_error";
  return [
    "embedded_runtime_timeout", "embedded_provider_timeout", "provider_chat_failed", "send_timeout",
    "telemetry_wait_timeout", "cue_transition_timeout", "action_idle_timeout", "body_click_failed",
    "webgl_context_loss_unavailable", "runner_timeout"
  ].includes(message) ? message : "runner_error";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
