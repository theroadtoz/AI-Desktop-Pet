import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { extname } from "node:path";

export type LlamaCppRuntimeConfig = {
  enabled: boolean;
  executablePath?: string;
  modelPath?: string;
  host?: string;
  port?: number;
  ctxSize?: number;
  alias?: string;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  healthPollIntervalMs?: number;
};

export type LlamaCppRuntimeStatus =
  | "disabled"
  | "missing_binary"
  | "missing_model"
  | "starting"
  | "ready"
  | "exited"
  | "timeout"
  | "error";

export type LlamaCppRuntimeSummary = {
  runtime: "llama.cpp";
  enabled: boolean;
  status: LlamaCppRuntimeStatus;
  safeSummaryOnly: true;
  executableConfigured: boolean;
  modelConfigured: boolean;
  baseURLHost?: string;
  alias?: string;
  durationMs?: number;
  startupMs?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | string | null;
  stdoutBytes?: number;
  stderrBytes?: number;
  reason?: "invalid_model_extension" | "spawn_failed" | "health_timeout" | "stop_timeout";
};

export type LlamaCppRuntime = {
  start(): Promise<LlamaCppRuntimeSummary>;
  stop(): Promise<LlamaCppRuntimeSummary>;
  getStatus(): LlamaCppRuntimeSummary;
  getBaseURL(): string | null;
};

type SpawnLike = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
type FetchLike = typeof fetch;

type RuntimeSettings = {
  executablePath: string;
  modelPath: string;
  host: string;
  port: number;
  ctxSize: number;
  alias: string;
  startupTimeoutMs: number;
  stopTimeoutMs: number;
  healthPollIntervalMs: number;
};

type RuntimeDependencies = {
  spawn?: SpawnLike;
  fetch?: FetchLike;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_CTX_SIZE = 2048;
const DEFAULT_ALIAS = "ai-desktop-pet-local";
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 200;
const HEALTH_REQUEST_TIMEOUT_MS = 1_000;
const LLAMA_SERVER_LOG_VERBOSITY = "2";

export function readLlamaCppRuntimeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): LlamaCppRuntimeConfig {
  const config: LlamaCppRuntimeConfig = {
    enabled: env.AI_DESKTOP_PET_LLAMA_CPP_MANAGED === "1"
  };
  const executablePath = readNonEmptyString(env.AI_DESKTOP_PET_LLAMA_CPP_EXE);
  const modelPath = readNonEmptyString(env.AI_DESKTOP_PET_LLAMA_CPP_MODEL);
  const host = readNonEmptyString(env.AI_DESKTOP_PET_LLAMA_CPP_HOST);
  const port = readPositiveInteger(env.AI_DESKTOP_PET_LLAMA_CPP_PORT);
  const ctxSize = readPositiveInteger(env.AI_DESKTOP_PET_LLAMA_CPP_CTX_SIZE);
  const alias = readNonEmptyString(env.AI_DESKTOP_PET_LLAMA_CPP_ALIAS);
  const startupTimeoutMs = readPositiveInteger(env.AI_DESKTOP_PET_LLAMA_CPP_STARTUP_TIMEOUT_MS);
  const stopTimeoutMs = readPositiveInteger(env.AI_DESKTOP_PET_LLAMA_CPP_STOP_TIMEOUT_MS);

  if (executablePath) {
    config.executablePath = executablePath;
  }
  if (modelPath) {
    config.modelPath = modelPath;
  }
  if (host) {
    config.host = host;
  }
  if (port) {
    config.port = port;
  }
  if (ctxSize) {
    config.ctxSize = ctxSize;
  }
  if (alias) {
    config.alias = alias;
  }
  if (startupTimeoutMs) {
    config.startupTimeoutMs = startupTimeoutMs;
  }
  if (stopTimeoutMs) {
    config.stopTimeoutMs = stopTimeoutMs;
  }

  return config;
}

export function buildLlamaCppSpawnArgs(settings: {
  modelPath: string;
  host: string;
  port: number;
  ctxSize: number;
  alias: string;
}): string[] {
  return [
    "-m",
    settings.modelPath,
    "--host",
    settings.host,
    "--port",
    String(settings.port),
    "--ctx-size",
    String(settings.ctxSize),
    "--alias",
    settings.alias,
    "--no-webui",
    "--offline",
    "--log-verbosity",
    LLAMA_SERVER_LOG_VERBOSITY
  ];
}

export function createLlamaCppRuntime(
  config: LlamaCppRuntimeConfig,
  dependencies: RuntimeDependencies = {}
): LlamaCppRuntime {
  const spawn = dependencies.spawn ?? nodeSpawn;
  const fetchFn = dependencies.fetch ?? fetch;
  let status: LlamaCppRuntimeStatus = "disabled";
  let child: ChildProcess | null = null;
  let startPromise: Promise<LlamaCppRuntimeSummary> | null = null;
  let baseURLHost: string | undefined;
  let activeHost: string = normalizeHost(config.host);
  let activePort: number | undefined;
  let exitCode: number | null | undefined;
  let signal: NodeJS.Signals | string | null | undefined;
  let stdoutBytes = 0;
  let stderrBytes = 0;

  async function start(): Promise<LlamaCppRuntimeSummary> {
    if (startPromise) {
      return startPromise;
    }

    if (child && status === "ready") {
      return createSummary();
    }

    startPromise = startInternal().finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  async function startInternal(): Promise<LlamaCppRuntimeSummary> {
    const startedAt = Date.now();
    const preflight = await resolveSettings();

    if ("status" in preflight) {
      status = preflight.status;
      return createSummary({
        durationMs: Date.now() - startedAt,
        ...(preflight.reason ? { reason: preflight.reason } : {})
      });
    }

    const settings = preflight;
    activeHost = settings.host;
    activePort = settings.port;
    baseURLHost = `${settings.host}:${settings.port}`;
    exitCode = undefined;
    signal = undefined;
    stdoutBytes = 0;
    stderrBytes = 0;
    status = "starting";

    try {
      const nextChild = spawn(settings.executablePath, buildLlamaCppSpawnArgs(settings), {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      child = nextChild;
      attachChild(nextChild);
    } catch {
      child = null;
      status = "error";
      return createSummary({
        durationMs: Date.now() - startedAt,
        reason: "spawn_failed"
      });
    }

    const healthReady = await waitForHealth(settings);

    if (healthReady && readStatus() === "starting") {
      status = "ready";
      return createSummary({
        durationMs: Date.now() - startedAt,
        startupMs: Date.now() - startedAt
      });
    }

    const currentStatus = readStatus();

    if (currentStatus === "exited" || currentStatus === "error") {
      return createSummary({
        durationMs: Date.now() - startedAt
      });
    }

    status = "timeout";
    await stopInternal({ preserveStatus: "timeout" });
    return createSummary({
      durationMs: Date.now() - startedAt,
      reason: "health_timeout"
    });
  }

  async function stop(): Promise<LlamaCppRuntimeSummary> {
    return stopInternal();
  }

  async function stopInternal(options: { preserveStatus?: LlamaCppRuntimeStatus } = {}): Promise<LlamaCppRuntimeSummary> {
    const startedAt = Date.now();
    const target = child;

    if (!target) {
      return createSummary({
        durationMs: Date.now() - startedAt
      });
    }

    const closedPromise = waitForClose(target, getStopTimeoutMs());

    try {
      target.kill();
    } catch {
      status = "error";
      child = null;
      return createSummary({
        durationMs: Date.now() - startedAt
      });
    }

    const closed = await closedPromise;

    if (!closed) {
      status = options.preserveStatus ?? "timeout";
      return createSummary({
        durationMs: Date.now() - startedAt,
        reason: "stop_timeout"
      });
    }

    if (child === target) {
      child = null;
    }

    status = options.preserveStatus ?? "exited";
    return createSummary({
      durationMs: Date.now() - startedAt
    });
  }

  function getStatus(): LlamaCppRuntimeSummary {
    return createSummary();
  }

  function getBaseURL(): string | null {
    if (!activePort) {
      return null;
    }

    return `http://${activeHost}:${activePort}/v1`;
  }

  async function resolveSettings(): Promise<RuntimeSettings | {
    status: Extract<LlamaCppRuntimeStatus, "disabled" | "missing_binary" | "missing_model">;
    reason?: "invalid_model_extension";
  }> {
    if (!config.enabled) {
      return { status: "disabled" };
    }

    const executablePath = readNonEmptyString(config.executablePath);

    if (!executablePath || !isExistingFile(executablePath)) {
      return { status: "missing_binary" };
    }

    const modelPath = readNonEmptyString(config.modelPath);

    if (!modelPath || !isExistingFile(modelPath)) {
      return { status: "missing_model" };
    }

    if (extname(modelPath).toLowerCase() !== ".gguf") {
      return {
        status: "missing_model",
        reason: "invalid_model_extension"
      };
    }

    const host = normalizeHost(config.host);
    const port = normalizePort(config.port) ?? await allocatePort(host);

    return {
      executablePath,
      modelPath,
      host,
      port,
      ctxSize: normalizePositiveInteger(config.ctxSize, DEFAULT_CTX_SIZE),
      alias: readNonEmptyString(config.alias) ?? DEFAULT_ALIAS,
      startupTimeoutMs: normalizePositiveInteger(config.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS),
      stopTimeoutMs: normalizePositiveInteger(config.stopTimeoutMs, DEFAULT_STOP_TIMEOUT_MS),
      healthPollIntervalMs: normalizePositiveInteger(config.healthPollIntervalMs, DEFAULT_HEALTH_POLL_INTERVAL_MS)
    };
  }

  function attachChild(nextChild: ChildProcess): void {
    nextChild.stdout?.on("data", (chunk: unknown) => {
      stdoutBytes += countChunkBytes(chunk);
    });
    nextChild.stderr?.on("data", (chunk: unknown) => {
      stderrBytes += countChunkBytes(chunk);
    });
    nextChild.once("error", () => {
      if (child === nextChild) {
        child = null;
      }
      status = "error";
    });
    nextChild.once("close", (code: number | null, closeSignal: NodeJS.Signals | null) => {
      exitCode = code;
      signal = closeSignal;
      if (child === nextChild) {
        child = null;
      }
      if (status === "starting" || status === "ready") {
        status = "exited";
      }
    });
  }

  async function waitForHealth(settings: RuntimeSettings): Promise<boolean> {
    const deadline = Date.now() + settings.startupTimeoutMs;
    const healthURL = `http://${settings.host}:${settings.port}/health`;

    while (Date.now() < deadline) {
      if (status !== "starting") {
        return false;
      }

      if (await fetchHealth(healthURL, Math.min(HEALTH_REQUEST_TIMEOUT_MS, deadline - Date.now()))) {
        return true;
      }

      await delay(Math.min(settings.healthPollIntervalMs, Math.max(deadline - Date.now(), 0)));
    }

    return false;
  }

  async function fetchHealth(url: string, timeoutMs: number): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(url, {
        method: "GET",
        signal: controller.signal
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function getStopTimeoutMs(): number {
    return normalizePositiveInteger(config.stopTimeoutMs, DEFAULT_STOP_TIMEOUT_MS);
  }

  function readStatus(): LlamaCppRuntimeStatus {
    return status;
  }

  function createSummary(extra: Partial<LlamaCppRuntimeSummary> = {}): LlamaCppRuntimeSummary {
    const summary: LlamaCppRuntimeSummary = {
      runtime: "llama.cpp",
      enabled: config.enabled,
      status,
      safeSummaryOnly: true,
      executableConfigured: Boolean(readNonEmptyString(config.executablePath)),
      modelConfigured: Boolean(readNonEmptyString(config.modelPath))
    };

    if (baseURLHost) {
      summary.baseURLHost = baseURLHost;
    }
    const alias = readNonEmptyString(config.alias) ?? DEFAULT_ALIAS;
    if (alias) {
      summary.alias = alias;
    }
    if (typeof exitCode !== "undefined") {
      summary.exitCode = exitCode;
    }
    if (typeof signal !== "undefined") {
      summary.signal = signal;
    }
    if (stdoutBytes > 0) {
      summary.stdoutBytes = stdoutBytes;
    }
    if (stderrBytes > 0) {
      summary.stderrBytes = stderrBytes;
    }

    return removeUndefined({
      ...summary,
      ...extra
    });
  }

  return {
    start,
    stop,
    getStatus,
    getBaseURL
  };
}

function isExistingFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function allocatePort(host: string): Promise<number> {
  const server = createServer();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();

      if (!address || typeof address !== "object") {
        server.close();
        reject(new Error("Unable to allocate llama.cpp port"));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => settle(false), timeoutMs);

    function settle(closed: boolean): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      child.off("close", onClose);
      resolve(closed);
    }

    function onClose(): void {
      settle(true);
    }

    child.once("close", onClose);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countChunkBytes(chunk: unknown): number {
  if (typeof chunk === "string") {
    return Buffer.byteLength(chunk);
  }

  if (chunk instanceof Uint8Array) {
    return chunk.byteLength;
  }

  return 0;
}

function normalizeHost(value: unknown): string {
  return readNonEmptyString(value) ?? DEFAULT_HOST;
}

function normalizePort(value: unknown): number | undefined {
  const port = normalizePositiveInteger(value, 0);
  return port >= 1 && port <= 65_535 ? port : undefined;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => typeof entryValue !== "undefined")
  ) as T;
}
