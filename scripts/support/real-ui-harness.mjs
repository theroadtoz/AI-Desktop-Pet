import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const require = createRequire(import.meta.url);
const TARGET_COUNT_CAP = 8;

export class TargetDiscoveryError extends Error {
  constructor(code, metadata) {
    super(code);
    this.name = "TargetDiscoveryError";
    this.code = code;
    this.metadata = metadata;
  }
}

export class RealUiHarnessError extends Error {
  constructor(category, metadata = {}) {
    super(category);
    this.name = "RealUiHarnessError";
    this.category = category;
    this.metadata = metadata;
  }
}

function emptyTargetMetadata() {
  return {
    listReadable: false,
    pageTargetCount: 0,
    petTargetCount: 0,
    chatTargetCount: 0,
    otherPageTargetCount: 0,
    invalidTargetCount: 0,
    matchingCandidateCount: 0,
    attemptedCandidateCount: 0,
    attachPhase: null,
    attachFailureKind: null
  };
}

function capTargetCount(value) {
  return Math.min(TARGET_COUNT_CAP, value);
}

function inspectTargetList(targets, urlPart) {
  if (!Array.isArray(targets)) {
    throw new TargetDiscoveryError("target_list_shape_invalid", emptyTargetMetadata());
  }

  const metadata = { ...emptyTargetMetadata(), listReadable: true };
  const matchingTargets = [];
  for (const target of targets) {
    if (!target || typeof target !== "object" || Array.isArray(target) || typeof target.type !== "string") {
      metadata.invalidTargetCount = capTargetCount(metadata.invalidTargetCount + 1);
      continue;
    }
    if (target.type !== "page") continue;
    if (typeof target.url !== "string" || typeof target.webSocketDebuggerUrl !== "string") {
      metadata.invalidTargetCount = capTargetCount(metadata.invalidTargetCount + 1);
      continue;
    }
    metadata.pageTargetCount = capTargetCount(metadata.pageTargetCount + 1);
    if (target.url.includes("renderer/pet/index.html")) {
      metadata.petTargetCount = capTargetCount(metadata.petTargetCount + 1);
    } else if (target.url.includes("renderer/chat/index.html")) {
      metadata.chatTargetCount = capTargetCount(metadata.chatTargetCount + 1);
    } else {
      metadata.otherPageTargetCount = capTargetCount(metadata.otherPageTargetCount + 1);
    }
    if (target.url.includes(urlPart) && matchingTargets.length < TARGET_COUNT_CAP) {
      matchingTargets.push(target);
      metadata.matchingCandidateCount = capTargetCount(metadata.matchingCandidateCount + 1);
    }
  }
  return { metadata, matchingTargets };
}

export function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function createRunDeadline(timeoutMs = 70_000, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const deadlineAt = now() + timeoutMs;
  return {
    remaining(stageLimitMs = Number.POSITIVE_INFINITY) {
      const remainingMs = deadlineAt - now();
      if (remainingMs <= 0) throw new RealUiHarnessError("run_timeout");
      return Math.max(1, Math.min(stageLimitMs, remainingMs));
    }
  };
}

const ACTION_TERMINAL_STATUSES = ["completed", "interrupted", "timed_out", "failed"];
const BODY_STATES = ["pending", "started", "skipped", "completed"];
const BODY_SKIP_REASONS = [
  "active_action",
  "global_cooldown",
  "head_pat_cooldown",
  "same_action_cooldown",
  "window_shake_feedback_cooldown"
];

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function createSafeBodyAttemptResult(value, actionTypes) {
  if (!isPlainRecord(value) || !Array.isArray(actionTypes)) return null;
  const exactKeys = ["attempt", "bodyState", "bodySkipReason", "competingActionType", "terminal", "idle"];
  const keys = Object.keys(value);
  if (keys.length !== exactKeys.length || keys.some((key) => !exactKeys.includes(key))) return null;
  if (!Number.isInteger(value.attempt) || value.attempt < 1 || value.attempt > 3) return null;
  if (!BODY_STATES.includes(value.bodyState)) return null;
  if (value.bodySkipReason !== null && !BODY_SKIP_REASONS.includes(value.bodySkipReason)) return null;
  if (value.competingActionType !== null && !actionTypes.includes(value.competingActionType)) return null;
  if (value.terminal !== null && !ACTION_TERMINAL_STATUSES.includes(value.terminal)) return null;
  if (typeof value.idle !== "boolean") return null;
  return {
    attempt: value.attempt,
    bodyState: value.bodyState,
    bodySkipReason: value.bodySkipReason,
    competingActionType: value.competingActionType,
    terminal: value.terminal,
    idle: value.idle
  };
}

function safeBodyResultOrThrow(value, actionTypes) {
  const safe = createSafeBodyAttemptResult(value, actionTypes);
  if (!safe) throw new RealUiHarnessError("product_assertion");
  return safe;
}

export function summarizeActionLifecycle(events, afterIndex = 0, actionType = "bodyAttentionTurn") {
  const summary = {
    bodyStarted: 0,
    bodyFinished: 0,
    bodySkipped: 0,
    otherStarted: 0,
    otherFinished: 0,
    otherSkipped: 0,
    active: 0,
    missingTerminal: 0,
    unmatchedFinished: 0,
    terminal: { completed: 0, interrupted: 0, timed_out: 0, failed: 0 }
  };
  const unmatchedByType = new Map();
  for (const event of events.slice(afterIndex)) {
    const eventActionType = event?.payload?.actionType;
    const kind = eventActionType === actionType ? "body" : "other";
    if (event?.type === "pet_interaction_action_started") {
      summary[`${kind}Started`] += 1;
      summary.active += 1;
      unmatchedByType.set(eventActionType, (unmatchedByType.get(eventActionType) ?? 0) + 1);
    }
    if (event?.type === "pet_interaction_action_skipped") summary[`${kind}Skipped`] += 1;
    if (event?.type === "pet_interaction_action_finished") {
      summary[`${kind}Finished`] += 1;
      const terminalStatus = event?.payload?.terminalStatus;
      if (!ACTION_TERMINAL_STATUSES.includes(terminalStatus)) {
        summary.missingTerminal += 1;
        continue;
      }
      summary.terminal[terminalStatus] += 1;
      const unmatched = unmatchedByType.get(eventActionType) ?? 0;
      if (unmatched === 0) {
        summary.unmatchedFinished += 1;
        continue;
      }
      unmatchedByType.set(eventActionType, unmatched - 1);
      summary.active -= 1;
    }
  }
  return summary;
}

function stageDeadline(deadline, stageTimeoutMs, now) {
  return now() + deadline.remaining(stageTimeoutMs);
}

function remainingStageMs(deadline, stageEndsAt, now) {
  const stageRemaining = stageEndsAt - now();
  if (stageRemaining <= 0) throw new RealUiHarnessError("run_timeout");
  return Math.min(stageRemaining, deadline.remaining(stageRemaining));
}

function remainingLifecycleStageMs(options, stageEndsAt, now, summary) {
  try {
    return remainingStageMs(options.deadline, stageEndsAt, now);
  } catch (error) {
    if (error instanceof RealUiHarnessError && error.category === "run_timeout" && summary.active > 0) {
      options.onProgress?.({
        ...summary,
        missingTerminal: summary.missingTerminal + summary.active
      });
    }
    throw error;
  }
}

export async function waitForActionLifecycleIdle(options) {
  const now = options.now ?? Date.now;
  const sleepImpl = options.sleep ?? sleep;
  const pollMs = options.pollMs ?? 50;
  const stableMs = options.stableMs ?? 550;
  const stageEndsAt = stageDeadline(options.deadline, options.stageTimeoutMs ?? 15_000, now);
  let idleSince = null;
  while (true) {
    const summary = summarizeActionLifecycle(options.readEvents(), 0, options.actionType);
    options.onProgress?.(summary);
    if (summary.unmatchedFinished > 0 || summary.missingTerminal > 0) {
      throw new RealUiHarnessError("product_assertion");
    }
    if (summary.active === 0) {
      idleSince ??= now();
      if (now() - idleSince >= stableMs) return summary;
    } else {
      idleSince = null;
    }
    const remainingMs = remainingLifecycleStageMs(options, stageEndsAt, now, summary);
    await sleepImpl(Math.min(pollMs, remainingMs));
  }
}

export async function waitForActionLifecycleResult(options) {
  const now = options.now ?? Date.now;
  const sleepImpl = options.sleep ?? sleep;
  const pollMs = options.pollMs ?? 50;
  const stageEndsAt = stageDeadline(options.deadline, options.stageTimeoutMs ?? 15_000, now);
  while (true) {
    const events = options.readEvents().slice(options.afterIndex);
    const summary = summarizeActionLifecycle(events, 0, options.actionType);
    options.onProgress?.(summary);
    if (summary.unmatchedFinished > 0 || summary.missingTerminal > 0) {
      throw new RealUiHarnessError("product_assertion");
    }
    let started = false;
    for (const event of events) {
      if (event?.payload?.actionType !== options.actionType) continue;
      if (event.type === "pet_interaction_action_skipped") {
        throw new RealUiHarnessError("product_assertion");
      }
      if (event.type === "pet_interaction_action_started") started = true;
      if (event.type === "pet_interaction_action_finished") {
        if (!ACTION_TERMINAL_STATUSES.includes(event?.payload?.terminalStatus)) {
          throw new RealUiHarnessError("product_assertion");
        }
        if (started) return summary;
      }
    }
    const remainingMs = remainingLifecycleStageMs(options, stageEndsAt, now, summary);
    await sleepImpl(Math.min(pollMs, remainingMs));
  }
}

function inspectBodyAttempt(events, actionType, actionTypes) {
  const allowedTypes = new Set(actionTypes);
  const bodyEvents = events.filter((event) => event?.payload?.actionType === actionType);
  const bodyStarted = bodyEvents.filter((event) => event.type === "pet_interaction_action_started");
  const bodyFinished = bodyEvents.filter((event) => event.type === "pet_interaction_action_finished");
  const bodySkipped = bodyEvents.filter((event) => event.type === "pet_interaction_action_skipped");
  if (bodyStarted.length > 1 || bodyFinished.length > 1 || bodySkipped.length > 1) {
    throw new RealUiHarnessError("product_assertion");
  }
  if (bodyStarted.length > 0 && bodySkipped.length > 0) throw new RealUiHarnessError("product_assertion");
  if (bodyFinished.length > 0 && bodyStarted.length === 0) throw new RealUiHarnessError("product_assertion");
  if (bodyStarted.length > 0) {
    const startedIndex = events.indexOf(bodyStarted[0]);
    const finishedIndex = bodyFinished.length > 0 ? events.indexOf(bodyFinished[0]) : -1;
    if (finishedIndex >= 0 && finishedIndex < startedIndex) throw new RealUiHarnessError("product_assertion");
    return {
      kind: "started",
      terminal: bodyFinished[0]?.payload?.terminalStatus ?? null
    };
  }
  if (bodySkipped.length === 0) return { kind: "pending" };

  const skipReason = bodySkipped[0]?.payload?.skipReason;
  if (!BODY_SKIP_REASONS.includes(skipReason)) throw new RealUiHarnessError("product_assertion");
  if (skipReason !== "active_action" && skipReason !== "global_cooldown") {
    throw new RealUiHarnessError("product_assertion");
  }
  const isConcreteCompetitor = (event) => {
    const type = event?.payload?.actionType;
    return type !== actionType && allowedTypes.has(type);
  };
  if (skipReason === "active_action") {
    const starts = events.filter((event) => event?.type === "pet_interaction_action_started" && isConcreteCompetitor(event));
    const competingTypes = [...new Set(starts.map((event) => event.payload.actionType))];
    if (competingTypes.length !== 1) throw new RealUiHarnessError("product_assertion");
    const competingActionType = competingTypes[0];
    const startIndex = events.indexOf(starts[0]);
    const finishes = events.filter((event, index) => (
      index > startIndex && event?.type === "pet_interaction_action_finished" && event?.payload?.actionType === competingActionType
    ));
    if (finishes.length > 1) throw new RealUiHarnessError("product_assertion");
    const terminal = finishes[0]?.payload?.terminalStatus ?? null;
    if (terminal !== null && !ACTION_TERMINAL_STATUSES.includes(terminal)) {
      throw new RealUiHarnessError("product_assertion");
    }
    return { kind: "contention", skipReason, competingActionType, terminal };
  }

  const finishes = events.filter((event) => event?.type === "pet_interaction_action_finished" && isConcreteCompetitor(event));
  if (finishes.length === 0) throw new RealUiHarnessError("product_assertion");
  const finish = finishes.at(-1);
  const terminal = finish?.payload?.terminalStatus;
  if (!ACTION_TERMINAL_STATUSES.includes(terminal)) throw new RealUiHarnessError("product_assertion");
  return {
    kind: "contention",
    skipReason,
    competingActionType: finish.payload.actionType,
    terminal
  };
}

export async function runBodyActionAcceptance(options) {
  const now = options.now ?? Date.now;
  const sleepImpl = options.sleep ?? sleep;
  const pollMs = options.pollMs ?? 50;
  const stableMs = options.stableMs ?? 550;
  const actionTypes = [...new Set(options.actionTypes ?? [])];
  if (!actionTypes.includes(options.actionType)) throw new RealUiHarnessError("product_assertion");
  const publish = (value) => {
    const safe = safeBodyResultOrThrow(value, actionTypes);
    options.onProgress?.(safe);
    return safe;
  };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    options.deadline.remaining();
    const afterIndex = options.readEvents().length;
    publish({
      attempt, bodyState: "pending", bodySkipReason: null,
      competingActionType: null, terminal: null, idle: false
    });
    if (await options.trigger(attempt) !== true) throw new RealUiHarnessError("product_assertion");

    let contention = null;
    while (true) {
      const attemptEvents = options.readEvents().slice(afterIndex);
      const observation = inspectBodyAttempt(attemptEvents, options.actionType, actionTypes);
      if (observation.kind === "started") {
        if (observation.terminal === null) {
          publish({
            attempt, bodyState: "started", bodySkipReason: null,
            competingActionType: null, terminal: null, idle: false
          });
        } else {
          const result = publish({
            attempt,
            bodyState: observation.terminal === "completed" ? "completed" : "started",
            bodySkipReason: null,
            competingActionType: null,
            terminal: observation.terminal,
            idle: false
          });
          if (observation.terminal !== "completed") throw new RealUiHarnessError("product_assertion");
          return result;
        }
      }
      if (observation.kind === "contention") {
        contention = observation;
        publish({
          attempt, bodyState: "skipped", bodySkipReason: contention.skipReason,
          competingActionType: contention.competingActionType, terminal: contention.terminal, idle: false
        });
        if (contention.terminal !== null) break;
      }
      const remainingMs = options.deadline.remaining();
      await sleepImpl(Math.min(pollMs, remainingMs));
    }

    await waitForActionLifecycleIdle({
      readEvents: options.readEvents,
      actionType: options.actionType,
      deadline: options.deadline,
      stageTimeoutMs: options.deadline.remaining(),
      stableMs,
      pollMs,
      now,
      sleep: sleepImpl
    });
    publish({
      attempt, bodyState: "skipped", bodySkipReason: contention.skipReason,
      competingActionType: contention.competingActionType, terminal: contention.terminal, idle: true
    });
    if (attempt === 3) throw new RealUiHarnessError("persistent_contention");
  }
  throw new RealUiHarnessError("persistent_contention");
}

export function createRealUiRunContext({
  runName,
  appDataDir,
  port = 9534,
  env = {},
  structuredFailures = false,
  screenshotPatterns,
  tmpResiduePatterns
}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runParentDir = join(root, ".tmp", runName);
  const runDir = join(runParentDir, stamp);
  const resolvedAppDataDir = appDataDir ?? join(runDir, "user-data");
  const acceptanceRunId = randomUUID().toLowerCase();
  const prefix = runName.split("-").slice(0, 2).join("-");

  mkdirSync(runDir, { recursive: true });

  return {
    root,
    runName,
    stamp,
    runParentDir,
    runDir,
    appDataDir: resolvedAppDataDir,
    resultPath: join(runDir, "result.json"),
    progressPath: join(runDir, "progress.log"),
    port,
    cdpEndpointOwned: false,
    structuredFailures,
    acceptanceRunId,
    env: { ...env, AI_DESKTOP_PET_ACCEPTANCE_RUN_ID: acceptanceRunId },
    child: null,
    pages: [],
    screenshotPatterns: screenshotPatterns ?? [
      /^(screenshot.*|screen)\.png$/i,
      new RegExp(`^${escapeRegExp(prefix)}-.*\\.png$`, "i")
    ],
    tmpResiduePatterns: tmpResiduePatterns ?? [
      new RegExp(`^${escapeRegExp(prefix)}-`, "i")
    ]
  };
}

export function log(context, message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  writeFileSync(context.progressPath, `${line}\n`, { flag: "a" });
}

export async function waitForJsonWithDependencies(url, timeoutMs, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleepForRetry = dependencies.sleep ?? sleep;
  const deadline = now() + timeoutMs;
  let lastError = null;

  while (now() < deadline) {
    if (dependencies.child && childHasExited(dependencies.child)) {
      throw new RealUiHarnessError("child_exit");
    }
    try {
      const remainingMs = Math.max(1, deadline - now());
      const response = await waitForFetchOrChildExit(
        fetchImpl(url, { signal: AbortSignal.timeout(remainingMs) }),
        dependencies.child
      );
      if (!response.ok) {
        if (dependencies.structuredFailures) {
          throw new RealUiHarnessError("http_error", { status: normalizeHttpStatus(response.status) });
        }
        throw new Error(`${url} -> ${response.status}`);
      }
      try {
        return await response.json();
      } catch (error) {
        if (dependencies.structuredFailures) {
          throw new RealUiHarnessError("invalid_json");
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof RealUiHarnessError) throw error;
      lastError = error;
      const retryDelayMs = Math.min(300, Math.max(0, deadline - now()));
      if (retryDelayMs > 0) await sleepForRetry(retryDelayMs);
    }
  }

  if (dependencies.structuredFailures) {
    if (dependencies.child && childHasExited(dependencies.child)) {
      throw new RealUiHarnessError("child_exit");
    }
    throw new RealUiHarnessError("target_timeout");
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

export class CdpClientError extends Error {
  constructor(code) {
    super(code);
    this.name = "CdpClientError";
    this.code = code;
  }
}

function isSocketClosingOrClosed(socket) {
  return !socket || socket.readyState === 2 || socket.readyState === 3;
}

export class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.disconnectError = null;
    this.commandTimeoutMs = 15_000;
  }

  async open(timeoutMs = this.commandTimeoutMs) {
    try {
      this.socket = new WebSocket(this.webSocketUrl);
    } catch {
      throw new CdpClientError("transport_error");
    }
    this.socket.addEventListener("message", (event) => this.onMessage(event));
    this.socket.addEventListener("close", () => this.onDisconnect("session_closed"));
    this.socket.addEventListener("error", (event) => {
      this.onDisconnect("transport_error");
    });
    await new Promise((resolveOpen, rejectOpen) => {
      let opened = false;
      let openTimeout;
      const rejectBeforeOpen = (fallbackError) => {
        clearTimeout(openTimeout);
        rejectOpen(this.disconnectError ?? fallbackError);
      };
      this.socket.addEventListener("open", () => {
        opened = true;
        clearTimeout(openTimeout);
        resolveOpen();
      }, { once: true });
      this.socket.addEventListener("close", () => {
        if (!opened) rejectBeforeOpen(new CdpClientError("session_closed"));
      }, { once: true });
      this.socket.addEventListener("error", () => {
        if (!opened) rejectBeforeOpen(new CdpClientError("transport_error"));
      }, { once: true });
      if (timeoutMs <= 0) {
        this.onDisconnect("command_timeout");
        this.close();
        rejectBeforeOpen(new CdpClientError("command_timeout"));
        return;
      }
      openTimeout = setTimeout(() => {
        if (opened) return;
        this.onDisconnect("command_timeout");
        this.close();
        rejectBeforeOpen(new CdpClientError("command_timeout"));
      }, timeoutMs);
    });
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      this.onDisconnect("protocol_error");
      return;
    }
    if (message.id === undefined) {
      if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) {
          try {
            listener(message.params ?? {});
          } catch {}
        }
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) {
      pending.reject(new CdpClientError("protocol_error"));
      return;
    }
    pending.resolve(message.result ?? {});
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => this.off(method, listener);
  }

  off(method, listener) {
    const listeners = this.listeners.get(method);
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      this.listeners.delete(method);
    }
  }

  onDisconnect(code) {
    if (!this.disconnectError) this.disconnectError = new CdpClientError(code);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(this.disconnectError);
    }
    this.pending.clear();
    this.listeners.clear();
  }

  send(method, params = {}, timeoutMs = this.commandTimeoutMs) {
    if (this.disconnectError) return Promise.reject(this.disconnectError);
    if (isSocketClosingOrClosed(this.socket)) {
      this.onDisconnect("session_closed");
      return Promise.reject(this.disconnectError);
    }
    if (timeoutMs <= 0) {
      this.onDisconnect("command_timeout");
      this.close();
      return Promise.reject(this.disconnectError);
    }
    const id = this.nextId++;
    return new Promise((resolveSend, rejectSend) => {
      const timeout = setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        rejectSend(new CdpClientError("command_timeout"));
      }, timeoutMs).unref();
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend, timeout });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.onDisconnect("transport_error");
      }
    });
  }

  close() {
    this.socket?.close();
  }
}

function asCdp(page) {
  return page?.cdp ?? page;
}

export function startElectron(context, dependencies = {}) {
  const electronExe = join(root, "node_modules", "electron", "dist", "electron.exe");
  const electronCmd = existsSync(electronExe) ? electronExe : join(root, "node_modules", ".bin", "electron.cmd");
  const spawnImpl = dependencies.spawnImpl ?? spawn;
  const child = spawnImpl(electronCmd, [
    ".",
    `--remote-debugging-port=${context.port}`,
    ...(context.electronArgs ?? [])
  ], {
    cwd: root,
    env: {
      ...process.env,
      APPDATA: context.appDataDir,
      AI_DESKTOP_PET_USER_DATA_PATH: context.appDataDir,
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_API_KEY: "",
      AI_DESKTOP_PET_BASE_URL: "",
      AI_DESKTOP_PET_MODEL: "",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      ...context.env
    },
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeFileSync(join(context.runDir, "electron.stdout.log"), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => {
    writeFileSync(join(context.runDir, "electron.stderr.log"), chunk, { flag: "a" });
    captureOwnedCdpEndpoint(context, chunk);
  });
  child.once("exit", () => {
    context.childExitObserved = true;
  });
  writeFileSync(join(context.runDir, "electron.pid"), String(child.pid ?? ""));
  context.child = child;
  return child;
}

export async function connectToElectron(context, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  if (context.port === 0) {
    await waitForOwnedCdpEndpoint(context, timeoutMs);
  }
  return waitForJsonWithDependencies(`http://127.0.0.1:${context.port}/json/version`, Math.max(1, deadline - Date.now()), {
    child: context.child,
    structuredFailures: context.structuredFailures
  });
}

export async function getPageByUrlPartWithDependencies(context, urlPart, timeoutMs = 30_000, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const sleepForRetry = dependencies.sleep ?? sleep;
  const listTargets = dependencies.listTargets ?? ((remainingMs) => (
    waitForJsonWithDependencies(`http://127.0.0.1:${context.port}/json/list`, Math.min(10_000, remainingMs), {
      child: context.child,
      structuredFailures: context.structuredFailures
    })
  ));
  const createCdp = dependencies.createCdp ?? ((webSocketDebuggerUrl) => new CdpClient(webSocketDebuggerUrl));
  const deadline = now() + timeoutMs;
  let lastReadableMetadata = null;
  let sessionClosedListRetryUsed = false;
  while (now() < deadline) {
    if (context.structuredFailures && context.child && childHasExited(context.child)) {
      throw new RealUiHarnessError("child_exit");
    }
    let targets;
    try {
      targets = await listTargets(Math.max(1, deadline - now()));
    } catch (error) {
      if (error instanceof RealUiHarnessError) throw error;
      if (now() < deadline) await sleepForRetry(Math.min(300, Math.max(0, deadline - now())));
      continue;
    }
    const { metadata, matchingTargets } = inspectTargetList(targets, urlPart);
    lastReadableMetadata = metadata;
    let attemptedCandidateCount = 0;
    let attachPhase = null;
    let attachFailureKind = null;
    let allCandidatesSessionClosed = matchingTargets.length > 0;
    for (const matchingTarget of matchingTargets) {
      attemptedCandidateCount = capTargetCount(attemptedCandidateCount + 1);
      const cdp = createCdp(matchingTarget.webSocketDebuggerUrl);
      try {
        attachPhase = "open";
        await cdp.open(deadline - now());
        if (now() > deadline) throw new CdpClientError("command_timeout");
        const commandTimeoutMs = cdp.commandTimeoutMs ?? 15_000;
        attachPhase = "runtime";
        let remainingMs = deadline - now();
        if (remainingMs <= 0) throw new CdpClientError("command_timeout");
        await cdp.send("Runtime.enable", {}, Math.min(commandTimeoutMs, remainingMs));
        if (now() > deadline) throw new CdpClientError("command_timeout");
        attachPhase = "page";
        remainingMs = deadline - now();
        if (remainingMs <= 0) throw new CdpClientError("command_timeout");
        await cdp.send("Page.enable", {}, Math.min(commandTimeoutMs, remainingMs));
        if (now() > deadline) throw new CdpClientError("command_timeout");
        const page = { target: matchingTarget, cdp };
        context.pages.push(page);
        return page;
      } catch (error) {
        attachFailureKind = error instanceof CdpClientError ? error.code : "unknown";
        allCandidatesSessionClosed &&= attachFailureKind === "session_closed";
        try {
          cdp.close?.();
        } catch {}
        if (attachFailureKind !== "session_closed") {
          throw new TargetDiscoveryError("cdp_attach_failed", {
            ...metadata,
            attemptedCandidateCount,
            attachPhase,
            attachFailureKind
          });
        }
      }
    }
    if (allCandidatesSessionClosed && !sessionClosedListRetryUsed && now() < deadline) {
      sessionClosedListRetryUsed = true;
      continue;
    }
    if (attemptedCandidateCount > 0) {
      throw new TargetDiscoveryError("cdp_attach_failed", {
        ...metadata,
        attemptedCandidateCount,
        attachPhase,
        attachFailureKind
      });
    }
    if (metadata.invalidTargetCount > 0) {
      throw new TargetDiscoveryError("target_entry_shape_invalid", metadata);
    }
    await sleepForRetry(Math.min(300, Math.max(0, deadline - now())));
  }
  if (context.structuredFailures) {
    if (context.child && childHasExited(context.child)) {
      throw new RealUiHarnessError("child_exit");
    }
    throw new RealUiHarnessError("target_timeout", lastReadableMetadata ?? emptyTargetMetadata());
  }
  throw new TargetDiscoveryError(
    lastReadableMetadata ? "target_not_found" : "target_list_unreadable",
    lastReadableMetadata ?? emptyTargetMetadata()
  );
}

export async function getPageByUrlPart(context, urlPart, timeoutMs = 30_000) {
  return getPageByUrlPartWithDependencies(context, urlPart, timeoutMs);
}

export const waitForWindow = getPageByUrlPart;

export async function evaluate(page, expression, awaitPromise = true) {
  const result = await asCdp(page).send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed";
    throw new Error(detail);
  }

  return result.result?.value;
}

export async function waitFor(page, expression, options = {}) {
  const timeoutMs = typeof options === "number" ? options : options.timeoutMs ?? 10_000;
  const intervalMs = typeof options === "number" ? 150 : options.intervalMs ?? 150;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(page, expression);
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

export async function click(page, selector) {
  await evaluate(page, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error(${JSON.stringify(`Missing selector: ${selector}`)});
      element.click();
    })()
  `);
  await sleep(250);
}

export async function typeText(page, selector, text) {
  await evaluate(page, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error(${JSON.stringify(`Missing selector: ${selector}`)});
      element.focus();
      element.value = ${JSON.stringify(text)};
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
  await sleep(150);
}

export const chatUiSelectors = {
  chat: {
    page: "#chat-page",
    messages: "#messages",
    input: "#chat-input",
    send: "#send-button",
    settings: "#settings-button"
  },
  settings: {
    panel: "#settings-panel",
    close: "#settings-close-button",
    basicTab: "#settings-basic-tab",
    memoryTab: "#settings-memory-tab",
    historyTab: "#settings-history-tab",
    appearanceTab: "#settings-appearance-tab",
    modelTab: "#settings-model-tab",
    advancedTab: "#settings-advanced-tab",
    basicPage: "#settings-basic-page",
    memoryPage: "#memory-page",
    historyPage: "#history-page",
    appearancePage: "#settings-appearance-page",
    modelPage: "#settings-model-page",
    advancedPage: "#settings-advanced-page",
    memoryDetailPage: "#settings-memory-detail-page",
    historyDetailPage: "#settings-history-detail-page",
    modelDetailPage: "#settings-model-detail-page",
    modelDetailButton: "#settings-model-detail-button"
  },
  profile: {
    displayName: "#settings-user-display-name",
    preferredName: "#settings-user-preferred-name",
    save: "#save-user-profile-button",
    summary: "#user-profile-summary"
  },
  model: {
    providerId: "#provider-id",
    localPreset: "#local-provider-preset",
    baseURL: "#provider-base-url",
    model: "#provider-model",
    healthCheck: "#provider-health-check-button",
    healthStatus: "#provider-health-status"
  }
};

const settingsTabByPage = {
  basic: chatUiSelectors.settings.basicTab,
  memory: chatUiSelectors.settings.memoryTab,
  history: chatUiSelectors.settings.historyTab,
  appearance: chatUiSelectors.settings.appearanceTab,
  model: chatUiSelectors.settings.modelTab,
  advanced: chatUiSelectors.settings.advancedTab
};

const settingsPageByPage = {
  basic: chatUiSelectors.settings.basicPage,
  memory: chatUiSelectors.settings.memoryPage,
  history: chatUiSelectors.settings.historyPage,
  appearance: chatUiSelectors.settings.appearancePage,
  model: chatUiSelectors.settings.modelPage,
  advanced: chatUiSelectors.settings.advancedPage
};

export async function openSettingsPage(page, settingsPage = "basic") {
  const tab = settingsTabByPage[settingsPage];
  const pageSelector = settingsPageByPage[settingsPage];

  if (!tab || !pageSelector) {
    throw new Error(`Unknown settings page: ${settingsPage}`);
  }

  const isOpen = await evaluate(page, `document.querySelector(${JSON.stringify(chatUiSelectors.settings.panel)})?.hidden === false`);
  if (!isOpen) {
    await click(page, chatUiSelectors.chat.settings);
  }

  await waitFor(page, `document.querySelector(${JSON.stringify(chatUiSelectors.settings.panel)})?.hidden === false`);
  await click(page, tab);
  await waitFor(page, `document.querySelector(${JSON.stringify(pageSelector)})?.hidden === false`);
}

export async function openModelSettings(page, options = {}) {
  await openSettingsPage(page, "model");

  if (options.detail !== false) {
    await click(page, chatUiSelectors.settings.modelDetailButton);
    await waitFor(page, `document.querySelector(${JSON.stringify(chatUiSelectors.settings.modelDetailPage)})?.hidden === false`);
  }
}

export async function openMemorySettings(page, options = {}) {
  await openSettingsPage(page, "memory");

  if (options.detail === true) {
    await waitFor(page, "document.querySelector('.memory-card .button-light')");
    await evaluate(page, `
      (() => {
        const button = [...document.querySelectorAll(".memory-card .button-light")]
          .find((item) => item.textContent?.includes("查看内容"));
        if (!button) throw new Error("Missing memory detail button");
        button.click();
      })()
    `);
    await waitFor(page, `document.querySelector(${JSON.stringify(chatUiSelectors.settings.memoryDetailPage)})?.hidden === false`);
  }
}

export async function openHistorySettings(page) {
  await openSettingsPage(page, "history");
}

export async function openAppearanceSettings(page) {
  await openSettingsPage(page, "appearance");
}

export async function openAdvancedSettings(page) {
  await openSettingsPage(page, "advanced");
}

export async function closeSettingsPage(page) {
  const isOpen = await evaluate(page, `document.querySelector(${JSON.stringify(chatUiSelectors.settings.panel)})?.hidden === false`);
  if (isOpen) {
    await click(page, chatUiSelectors.settings.close);
  }
  await waitFor(page, `document.querySelector(${JSON.stringify(chatUiSelectors.chat.page)})?.hidden === false`);
}

export async function openChatPage(page) {
  await closeSettingsPage(page);
}

export async function setDialogueMode(page, modeId) {
  const changed = await evaluate(page, `(async () => {
    const api = window.dialogueModeApi;
    if (!api?.setMode) return false;
    await api.setMode(${JSON.stringify(modeId)});
    return true;
  })()`);
  if (!changed && modeId !== "default") {
    throw new Error(`legacy dialogue mode override unavailable: ${modeId}`);
  }
}

export async function setPresenceMode(page, modeId) {
  const changed = await evaluate(page, `(async () => {
    const api = window.presenceModeApi;
    if (!api?.setMode) return false;
    await api.setMode(${JSON.stringify(modeId)});
    return true;
  })()`);
  if (!changed && modeId !== "default") {
    throw new Error(`legacy presence mode override unavailable: ${modeId}`);
  }
}

export async function saveWelcomeProfile(page, profile) {
  await openSettingsPage(page, "basic");
  await typeText(page, chatUiSelectors.profile.displayName, profile.displayName);
  await typeText(page, chatUiSelectors.profile.preferredName, profile.preferredName ?? "");
  await click(page, chatUiSelectors.profile.save);
  await waitFor(page, `document.querySelector(${JSON.stringify(chatUiSelectors.profile.summary)})?.textContent.includes(${JSON.stringify(profile.displayName)})`);
  await closeSettingsPage(page);
}

async function setViewport(page, width, height) {
  await asCdp(page).send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(300);
}

export async function checkLayout(page, width, height, options = {}) {
  const selectors = options.selectors ?? [
    ".chat-shell",
    "#messages",
    "#chat-form"
  ];
  const controlSelector = options.controlSelector ?? "#chat-form button, #chat-form input";

  await setViewport(page, width, height);
  const result = await evaluate(page, `
    (() => {
      const visible = (node) => {
        if (!node || node.hidden || node.closest("[hidden]")) return false;
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      const selectors = ${JSON.stringify(selectors)};
      const overflowing = [];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < -1 || rect.right > window.innerWidth + 1 || rect.width <= 0 || rect.height <= 0) {
          overflowing.push(selector);
        }
      }
      const controls = [...document.querySelectorAll(${JSON.stringify(controlSelector)})]
        .filter(visible)
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left < -1 || rect.right > window.innerWidth + 1 || rect.height <= 0;
        })
        .map((node) => node.id || node.textContent);
      return { ok: overflowing.length === 0 && controls.length === 0, overflowing, controls };
    })()
  `);
  await asCdp(page).send("Emulation.clearDeviceMetricsOverride");
  await sleep(150);
  return result;
}

function readTextFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const texts = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      texts.push(...readTextFiles(fullPath));
      continue;
    }
    if (/\.(json|jsonl|log)$/i.test(entry.name)) {
      texts.push(readFileSync(fullPath, "utf8"));
    }
  }
  return texts;
}

export function readPrivacyCheckText(context, files = ["progress.log", "electron.stdout.log", "electron.stderr.log", "result.json"]) {
  const texts = readTextFiles(join(context.appDataDir, "logs"));
  for (const fileName of files) {
    const filePath = join(context.runDir, fileName);
    if (existsSync(filePath)) {
      texts.push(readFileSync(filePath, "utf8"));
    }
  }
  return texts.join("\n");
}

export function findScreenshotResidue(context, directory = root, matches = []) {
  const ignored = new Set([".git", "node_modules", "dist", "dist-renderer"]);

  if (!existsSync(directory)) {
    return matches;
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (isInside(fullPath, join(root, ".tmp")) && context.tmpResiduePatterns.some((pattern) => pattern.test(entry.name))) {
        matches.push(fullPath);
      } else {
        findScreenshotResidue(context, fullPath, matches);
      }
      continue;
    }

    if (context.screenshotPatterns.some((pattern) => pattern.test(entry.name))) {
      matches.push(fullPath);
    }
  }

  return matches;
}

export function assertNoScreenshotResidue(context) {
  const residue = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
  if (residue.length > 0) {
    throw new Error(`Screenshot residue found: ${JSON.stringify(residue)}`);
  }
}

export function cleanupRunDir(context) {
  cleanupRealUiRun(context);
}

export function cleanupRealUiRun(context) {
  const tmpRoot = join(root, ".tmp");
  if (!isInside(context.runParentDir, tmpRoot)) {
    throw new Error(`Refusing to clean outside .tmp: ${context.runParentDir}`);
  }
  rmSync(context.runParentDir, { recursive: true, force: true });
  assertRealUiRunParentRemoved(context);
}

export function assertRealUiRunParentRemoved(context) {
  for (const path of [
    context.runParentDir,
    context.runDir,
    context.appDataDir,
    join(context.appDataDir, "acceptance-evidence")
  ]) {
    if (existsSync(path)) throw new Error("real_ui_run_parent_cleanup_failed");
  }
}

export function readAcceptanceEvidenceForContext(context, expectedSuite) {
  const { readAcceptanceEvidence } = require("../../dist/main/services/acceptance-evidence.js");
  return readAcceptanceEvidence({
    userDataPath: context.appDataDir,
    runId: context.acceptanceRunId,
    expectedSuite
  });
}

export async function waitForChildExit(child, timeoutMs = 10_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      rejectExit(new Error(`Timed out waiting for Electron child ${child.pid ?? "unknown"} to exit`));
    }, timeoutMs);
    timeout.unref();

    child.once("close", () => {
      clearTimeout(timeout);
      resolveExit();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectExit(error);
    });
  });
}

export async function stopElectron(context) {
  const seen = new Set();
  for (const page of context.pages) {
    if (!page?.cdp || seen.has(page.cdp)) {
      continue;
    }
    seen.add(page.cdp);
    page.cdp.close();
  }
  const child = context.child;
  context.child = null;
  context.pages = [];
  if (!child) {
    return;
  }

  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
  await waitForChildExit(child);
}

export async function runStructuredRealUiAcceptance({ initialResult, execute, cleanupSteps, emit }) {
  let result = { ok: false, ...initialResult };
  let failure = null;
  try {
    const executionResult = await execute();
    result = { ...result, ...executionResult, ok: true };
  } catch (error) {
    failure = classifyRealUiFailure(error);
  }

  let cleaned = true;
  for (const cleanupStep of cleanupSteps) {
    try {
      await cleanupStep();
    } catch {
      cleaned = false;
    }
  }
  if (!cleaned) {
    failure = { category: "cleanup_failure" };
  }
  if (failure) {
    result = { ...result, ok: false, failure, cleaned };
  } else {
    result = { ...result, ok: true, cleaned };
  }
  emit(`${JSON.stringify(result)}\n`);
  return result;
}

function classifyRealUiFailure(error) {
  if (error instanceof RealUiHarnessError) {
    return { category: error.category };
  }
  if (error instanceof TargetDiscoveryError) {
    return { category: "target_timeout" };
  }
  if (error?.name === "AssertionError" || error?.code === "ERR_ASSERTION") {
    return { category: "product_assertion" };
  }
  return { category: "runner_error" };
}

function captureOwnedCdpEndpoint(context, chunk) {
  if (context.port !== 0 || context.cdpEndpointOwned) return;
  const previous = context.cdpAnnouncementBuffer ?? "";
  const text = `${previous}${String(chunk)}`.slice(-4096);
  context.cdpAnnouncementBuffer = text;
  const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d{1,5})\/devtools\/browser\/[A-Za-z0-9-]+/u.exec(text);
  if (!match) return;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return;
  context.port = port;
  context.cdpEndpointOwned = true;
  context.cdpAnnouncementBuffer = "";
}

async function waitForOwnedCdpEndpoint(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!context.cdpEndpointOwned && Date.now() < deadline) {
    if (context.child && childHasExited(context.child)) {
      throw new RealUiHarnessError("child_exit");
    }
    await sleep(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  if (!context.cdpEndpointOwned) throw new RealUiHarnessError("target_timeout");
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForFetchOrChildExit(fetchPromise, child) {
  if (!child?.once || !child?.removeListener) return fetchPromise;
  return new Promise((resolveFetch, rejectFetch) => {
    const onExit = () => finish(rejectFetch, new RealUiHarnessError("child_exit"));
    const finish = (settle, value) => {
      child.removeListener("exit", onExit);
      settle(value);
    };
    child.once("exit", onExit);
    Promise.resolve(fetchPromise).then(
      (response) => finish(resolveFetch, response),
      (error) => finish(rejectFetch, error)
    );
  });
}

function normalizeHttpStatus(status) {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
}

function isInside(targetPath, parentPath) {
  const target = resolve(targetPath).toLowerCase();
  const parent = resolve(parentPath).toLowerCase();
  return target === parent || target.startsWith(`${parent}\\`) || target.startsWith(`${parent}/`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
