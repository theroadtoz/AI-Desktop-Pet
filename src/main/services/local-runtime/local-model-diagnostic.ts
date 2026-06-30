import { execFile } from "node:child_process";
import * as net from "node:net";
import { promisify } from "node:util";
import type {
  LocalModelDiagnosticEndpointStatus,
  LocalModelDiagnosticRuntimeSummary,
  LocalModelDiagnosticSafeSummary
} from "../../../shared/local-model-diagnostic";

const execFileAsync = promisify(execFile);
const defaultModel = "qwen3.5:2b";
const defaultAlias = "ai-desktop-pet-local";

type RuntimeNextActions = {
  commandMissing: string;
  tcpUnreachable: string;
  modelMissing: string;
  chatFailed: string;
};

export type LocalModelRuntimeCheck = {
  id: string;
  label: string;
  command: string;
  processNames: readonly string[];
  baseURL: string;
  model: string;
  nextActions: RuntimeNextActions;
};

export type ManagedLlamaCppDiagnosticConfig = {
  enabled: boolean;
  executableConfigured: boolean;
  modelConfigured: boolean;
  host?: string;
  port?: number;
  alias?: string;
};

export type LocalModelDiagnosticOptions = {
  env?: Record<string, string | undefined>;
  runtimes?: readonly LocalModelRuntimeCheck[];
  commandExists?: (command: string) => Promise<boolean>;
  processExists?: (processNames: readonly string[]) => Promise<boolean>;
  tcpReachable?: (baseURLHost: string | undefined, timeoutMs: number) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  tcpTimeoutMs?: number;
  modelsTimeoutMs?: number;
  chatTimeoutMs?: number;
  managedLlamaCpp?: ManagedLlamaCppDiagnosticConfig;
};

type RuntimeChecks = {
  commandExists: (command: string) => Promise<boolean>;
  processExists: (processNames: readonly string[]) => Promise<boolean>;
  tcpReachable: (baseURLHost: string | undefined, timeoutMs: number) => Promise<boolean>;
  fetchImpl: typeof fetch;
};

type RuntimeTiming = {
  tcpTimeoutMs: number;
  modelsTimeoutMs: number;
  chatTimeoutMs: number;
};

type ModelsCheckResult = {
  status: Exclude<LocalModelDiagnosticEndpointStatus, "chat_failed" | "skipped">;
  durationMs: number;
  modelCount?: number;
  reason?: string;
};

type ChatCheckResult = {
  status: Extract<LocalModelDiagnosticEndpointStatus, "ready" | "chat_failed">;
  durationMs: number;
  firstTokenMs?: number;
  replyLength?: number;
  reason?: string;
};

type SseSummary = {
  firstTokenMs: number | undefined;
  replyLength: number;
  sawEvent: boolean;
};

export const defaultRuntimeChecks: readonly LocalModelRuntimeCheck[] = [
  {
    id: "ollama",
    label: "Ollama OpenAI-compatible",
    command: "ollama",
    processNames: ["ollama.exe", "ollama"],
    baseURL: "http://localhost:11434/v1",
    model: defaultModel,
    nextActions: {
      commandMissing: "Install Ollama, start the service, then pull the target model.",
      tcpUnreachable: "Start Ollama or check whether port 11434 is listening.",
      modelMissing: "Pull the target model in Ollama before chat acceptance.",
      chatFailed: "Check the Ollama server log and retry with the target model."
    }
  },
  {
    id: "lm-studio",
    label: "LM Studio OpenAI-compatible",
    command: "lms",
    processNames: ["LM Studio.exe", "lmstudio.exe", "lms.exe", "lms"],
    baseURL: "http://localhost:1234/v1",
    model: defaultModel,
    nextActions: {
      commandMissing: "Install LM Studio or enable its CLI if you want to use this runtime.",
      tcpUnreachable: "Start the LM Studio local server on port 1234.",
      modelMissing: "Load or select a compatible local model in LM Studio.",
      chatFailed: "Check the LM Studio server console and loaded model."
    }
  },
  {
    id: "llama-cpp-external",
    label: "External llama.cpp server",
    command: "llama-server",
    processNames: ["llama-server.exe", "llama-server", "server.exe"],
    baseURL: "http://localhost:8080/v1",
    model: defaultAlias,
    nextActions: {
      commandMissing: "Build or download llama.cpp server if this advanced route is needed.",
      tcpUnreachable: "Start llama.cpp server or check whether port 8080 is listening.",
      modelMissing: "Start llama.cpp server with the expected model alias.",
      chatFailed: "Check llama.cpp server startup arguments and model compatibility."
    }
  }
];

export async function diagnoseLocalRuntimes(options: LocalModelDiagnosticOptions = {}): Promise<LocalModelDiagnosticSafeSummary> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const runtimes = options.runtimes ?? defaultRuntimeChecks;
  const checks: RuntimeChecks = {
    commandExists: options.commandExists ?? commandExists,
    processExists: options.processExists ?? processExists,
    tcpReachable: options.tcpReachable ?? tcpReachable,
    fetchImpl: options.fetchImpl ?? fetch
  };
  const timing: RuntimeTiming = {
    tcpTimeoutMs: options.tcpTimeoutMs ?? 700,
    modelsTimeoutMs: options.modelsTimeoutMs ?? 2_000,
    chatTimeoutMs: options.chatTimeoutMs ?? 15_000
  };
  const runtimeSummaries: LocalModelDiagnosticRuntimeSummary[] = [];

  for (const runtime of runtimes) {
    runtimeSummaries.push(await diagnoseOpenAICompatibleRuntime(runtime, checks, timing));
  }

  runtimeSummaries.push(diagnoseManagedLlamaCpp(env, options.managedLlamaCpp));

  const readyRuntime = runtimeSummaries.find((runtime) => runtime.status === "ready");

  return removeUndefined({
    ok: Boolean(readyRuntime),
    status: readyRuntime ? "ready" : "not_ready",
    recommendedRuntime: readyRuntime?.id ?? "ollama",
    durationMs: Date.now() - startedAt,
    safeSummaryOnly: true,
    runtimes: runtimeSummaries
  }) as LocalModelDiagnosticSafeSummary;
}

async function diagnoseOpenAICompatibleRuntime(
  runtime: LocalModelRuntimeCheck,
  checks: RuntimeChecks,
  timing: RuntimeTiming
) {
  const startedAt = Date.now();
  const host = readBaseURLHost(runtime.baseURL);
  const commandFound = await checks.commandExists(runtime.command);
  const processFound = await checks.processExists(runtime.processNames);
  const tcpReachableResult = await checks.tcpReachable(host, timing.tcpTimeoutMs);

  if (!tcpReachableResult) {
    return createRuntimeSummary(runtime, {
      status: "not_installed_or_unreachable",
      commandFound,
      processFound,
      tcpReachable: tcpReachableResult,
      modelsStatus: "skipped",
      chatStatus: "skipped",
      reason: commandFound ? "tcp_unreachable" : "command_missing",
      nextAction: commandFound ? runtime.nextActions.tcpUnreachable : runtime.nextActions.commandMissing,
      durationMs: Date.now() - startedAt
    });
  }

  const modelsCheck = await checkModels(runtime.baseURL, runtime.model, checks.fetchImpl, timing.modelsTimeoutMs);

  if (modelsCheck.status !== "ready") {
    const missingModel = modelsCheck.status === "model_missing";

    return createRuntimeSummary(runtime, {
      status: missingModel ? "model_missing" : "not_installed_or_unreachable",
      commandFound,
      processFound,
      tcpReachable: tcpReachableResult,
      modelsStatus: modelsCheck.status,
      chatStatus: "skipped",
      modelCount: modelsCheck.modelCount,
      modelsCheckMs: modelsCheck.durationMs,
      reason: modelsCheck.reason,
      nextAction: missingModel ? runtime.nextActions.modelMissing : runtime.nextActions.tcpUnreachable,
      durationMs: Date.now() - startedAt
    });
  }

  const chatCheck = await checkChat(runtime.id, runtime.baseURL, runtime.model, checks.fetchImpl, timing.chatTimeoutMs);

  return createRuntimeSummary(runtime, {
    status: chatCheck.status,
    commandFound,
    processFound,
    tcpReachable: tcpReachableResult,
    modelsStatus: modelsCheck.status,
    chatStatus: chatCheck.status,
    modelCount: modelsCheck.modelCount,
    modelsCheckMs: modelsCheck.durationMs,
    chatCheckMs: chatCheck.durationMs,
    firstTokenMs: chatCheck.firstTokenMs,
    replyLength: chatCheck.replyLength,
    reason: chatCheck.reason,
    nextAction: chatCheck.status === "ready"
      ? "Use this runtime for P2-20B real local model chat acceptance."
      : runtime.nextActions.chatFailed,
    durationMs: Date.now() - startedAt
  });
}

function diagnoseManagedLlamaCpp(
  env: Record<string, string | undefined>,
  managedConfig?: ManagedLlamaCppDiagnosticConfig
) {
  const enabled = managedConfig?.enabled ?? env.AI_DESKTOP_PET_LLAMA_CPP_MANAGED === "1";
  const executableConfigured = managedConfig?.executableConfigured ?? hasText(env.AI_DESKTOP_PET_LLAMA_CPP_EXE);
  const modelConfigured = managedConfig?.modelConfigured ?? hasText(env.AI_DESKTOP_PET_LLAMA_CPP_MODEL);
  const host = normalizeHostSummary(managedConfig?.host ?? env.AI_DESKTOP_PET_LLAMA_CPP_HOST);
  const port = managedConfig?.port ?? readPositiveInteger(env.AI_DESKTOP_PET_LLAMA_CPP_PORT) ?? 0;
  const alias = normalizeSafeLabel(managedConfig?.alias ?? env.AI_DESKTOP_PET_LLAMA_CPP_ALIAS, defaultAlias);
  const configured = enabled && executableConfigured && modelConfigured;

  return removeUndefined({
    id: "llama-cpp-managed",
    label: "Managed llama.cpp runtime",
    baseURLHost: port > 0 ? `${host}:${port}` : undefined,
    model: alias,
    commandFound: executableConfigured,
    processFound: false,
    tcpReachable: false,
    modelsStatus: "skipped",
    chatStatus: "skipped",
    managedEnabled: enabled,
    executableConfigured,
    modelConfigured,
    status: configured ? "env_configured" : "skipped",
    nextAction: configured
      ? "Use the app managed-runtime controls or P2-21 POC to start llama.cpp."
      : "Configure managed llama.cpp executable and model paths in the app settings before starting it.",
    reason: configured ? "env_configured_safe_skipped" : "missing_local_paths"
  }) as LocalModelDiagnosticRuntimeSummary;
}

async function checkModels(
  baseURL: string,
  model: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<ModelsCheckResult> {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(fetchImpl, createModelsURL(baseURL), {
      method: "GET",
      headers: { Accept: "application/json" }
    }, timeoutMs);

    if (!response.ok) {
      return {
        status: "service_unreachable",
        durationMs: Date.now() - startedAt,
        reason: `models_http_${response.status}`
      };
    }

    const modelIds = parseModelIds(await response.json());

    if (!modelIds) {
      return {
        status: "incompatible_response",
        durationMs: Date.now() - startedAt,
        reason: "models_response_incompatible"
      };
    }

    const hasTargetModel = modelIds.includes(model);

    return {
      status: hasTargetModel ? "ready" : "model_missing",
      durationMs: Date.now() - startedAt,
      modelCount: modelIds.length,
      ...(hasTargetModel ? {} : { reason: "model_missing" })
    };
  } catch (error) {
    return {
      status: "service_unreachable",
      durationMs: Date.now() - startedAt,
      reason: classifyFetchError(error)
    };
  }
}

async function checkChat(
  runtimeId: string,
  baseURL: string,
  model: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<ChatCheckResult> {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(fetchImpl, createChatCompletionsURL(baseURL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        temperature: 0.2,
        max_tokens: 32,
        stream: true,
        ...(runtimeId === "ollama" && isLocalOllamaOpenAICompatibleEndpoint(baseURL)
          ? { reasoning_effort: "none" }
          : {})
      })
    }, timeoutMs);

    if (!response.ok || !response.body) {
      return {
        status: "chat_failed",
        durationMs: Date.now() - startedAt,
        reason: `chat_http_${response.status}`
      };
    }

    const stream = await readSseSummary(response.body, startedAt);

    if (stream.replyLength <= 0) {
      return removeUndefined({
        status: "chat_failed",
        durationMs: Date.now() - startedAt,
        firstTokenMs: stream.firstTokenMs,
        replyLength: stream.replyLength,
        reason: stream.sawEvent ? "empty_chat_stream" : "incompatible_chat_stream"
      }) as ChatCheckResult;
    }

    return removeUndefined({
      status: "ready",
      durationMs: Date.now() - startedAt,
      firstTokenMs: stream.firstTokenMs,
      replyLength: stream.replyLength
    }) as ChatCheckResult;
  } catch (error) {
    return {
      status: "chat_failed",
      durationMs: Date.now() - startedAt,
      reason: classifyFetchError(error)
    };
  }
}

async function readSseSummary(body: ReadableStream<Uint8Array>, startedAt: number): Promise<SseSummary> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstTokenMs: number | undefined;
  let replyLength = 0;
  let sawEvent = false;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const data = trimmed.slice("data:".length).trim();

        if (data === "[DONE]") {
          return { firstTokenMs, replyLength, sawEvent: true };
        }

        sawEvent = true;
        const parsed = parseJson(data);
        const text = parsed?.choices?.[0]?.delta?.content;

        if (typeof text === "string" && text.length > 0) {
          firstTokenMs ??= Date.now() - startedAt;
          replyLength += text.length;
        }
      }
    }

    return { firstTokenMs, replyLength, sawEvent };
  } finally {
    reader.releaseLock();
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: URL,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function createRuntimeSummary(
  runtime: LocalModelRuntimeCheck,
  details: Record<string, unknown>
): LocalModelDiagnosticRuntimeSummary {
  return removeUndefined({
    id: runtime.id,
    label: runtime.label,
    baseURLHost: readBaseURLHost(runtime.baseURL),
    model: runtime.model,
    ...details
  }) as LocalModelDiagnosticRuntimeSummary;
}

export function createModelsURL(value: string): URL {
  const url = new URL(value);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/models`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

export function createChatCompletionsURL(value: string): URL {
  const url = new URL(value);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/chat/completions`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function isLocalOllamaOpenAICompatibleEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    return url.port === "11434" && (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

async function commandExists(command: string): Promise<boolean> {
  if (!command) {
    return false;
  }

  try {
    if (process.platform === "win32") {
      await execFileAsync("where.exe", [command], { windowsHide: true });
      return true;
    }

    await execFileAsync("sh", ["-lc", `command -v ${shellQuote(command)}`]);
    return true;
  } catch {
    return false;
  }
}

async function processExists(processNames: readonly string[]): Promise<boolean> {
  if (processNames.length === 0) {
    return false;
  }

  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist.exe", ["/fo", "csv", "/nh"], { windowsHide: true });
      const lower = stdout.toLowerCase();
      return processNames.some((name) => lower.includes(`"${name.toLowerCase()}"`));
    }

    const { stdout } = await execFileAsync("ps", ["-A", "-o", "comm="]);
    const names = stdout.split(/\r?\n/).map((name) => name.trim().toLowerCase());
    return processNames.some((name) => names.includes(name.toLowerCase()));
  } catch {
    return false;
  }
}

function tcpReachable(baseURLHost: string | undefined, timeoutMs: number): Promise<boolean> {
  if (!baseURLHost) {
    return Promise.resolve(false);
  }

  const [host, portText] = splitHostPort(baseURLHost);
  const port = Number(portText);

  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function splitHostPort(value: string): [string, string] {
  const url = new URL(`http://${value}`);
  return [url.hostname, url.port];
}

function parseModelIds(value: unknown): string[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) {
    return null;
  }

  const ids = [];

  for (const item of (value as { data: unknown[] }).data) {
    const id = item && typeof item === "object"
      ? (item as { id?: unknown; model?: unknown; name?: unknown }).id
        ?? (item as { id?: unknown; model?: unknown; name?: unknown }).model
        ?? (item as { id?: unknown; model?: unknown; name?: unknown }).name
      : null;

    if (typeof id !== "string" || id.length === 0) {
      return null;
    }

    ids.push(id);
  }

  return ids;
}

function readBaseURLHost(value: string): string | undefined {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function parseJson(value: string): {
  choices?: Array<{
    delta?: {
      content?: unknown;
    };
  }>;
} | null {
  try {
    return JSON.parse(value) as {
      choices?: Array<{
        delta?: {
          content?: unknown;
        };
      }>;
    };
  } catch {
    return null;
  }
}

function classifyFetchError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }

  return "network_or_runtime_unreachable";
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readPositiveInteger(value: unknown): number | null {
  if (!hasText(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeHostSummary(value: unknown): string {
  if (typeof value !== "string") {
    return "127.0.0.1";
  }

  const trimmed = value.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > 253 ||
    /[\u0000-\u001f\u007f/:\\\s]/.test(trimmed)
  ) {
    return "127.0.0.1";
  }

  return trimmed;
}

function normalizeSafeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > 128 ||
    /^[A-Za-z]:/.test(trimmed) ||
    /[\u0000-\u001f\u007f\\/]/.test(trimmed)
  ) {
    return fallback;
  }

  return trimmed;
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, removeUndefined(entryValue)])
  );
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
