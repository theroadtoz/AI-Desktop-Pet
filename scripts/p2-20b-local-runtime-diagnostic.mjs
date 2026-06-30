import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultModel = "qwen3.5:2b";
const defaultAlias = "ai-desktop-pet-local";

export const defaultRuntimeChecks = [
  {
    id: "ollama",
    label: "Ollama OpenAI-compatible",
    command: "ollama",
    processNames: ["ollama.exe", "ollama"],
    baseURL: "http://localhost:11434/v1",
    model: defaultModel,
    nextActions: {
      commandMissing: "Install Ollama, start the service, then pull the target model.",
      processMissing: "Start Ollama before running the local model chat acceptance.",
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
      processMissing: "Open LM Studio and start the local server.",
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
      processMissing: "Start llama.cpp server with a local GGUF model.",
      tcpUnreachable: "Start llama.cpp server or check whether port 8080 is listening.",
      modelMissing: "Start llama.cpp server with the expected model alias.",
      chatFailed: "Check llama.cpp server startup arguments and model compatibility."
    }
  }
];

export async function diagnoseLocalRuntimes(options = {}) {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const runtimes = options.runtimes ?? defaultRuntimeChecks;
  const checks = {
    commandExists: options.commandExists ?? commandExists,
    processExists: options.processExists ?? processExists,
    tcpReachable: options.tcpReachable ?? tcpReachable,
    fetchImpl: options.fetchImpl ?? fetch
  };
  const timing = {
    tcpTimeoutMs: options.tcpTimeoutMs ?? 700,
    modelsTimeoutMs: options.modelsTimeoutMs ?? 2_000,
    chatTimeoutMs: options.chatTimeoutMs ?? 5_000
  };
  const runtimeSummaries = [];

  for (const runtime of runtimes) {
    runtimeSummaries.push(await diagnoseOpenAICompatibleRuntime(runtime, checks, timing));
  }

  runtimeSummaries.push(diagnoseManagedLlamaCpp(env));

  const readyRuntime = runtimeSummaries.find((runtime) => runtime.status === "ready");

  return removeUndefined({
    ok: Boolean(readyRuntime),
    status: readyRuntime ? "ready" : "not_ready",
    recommendedRuntime: readyRuntime?.id ?? "ollama",
    durationMs: Date.now() - startedAt,
    safeSummaryOnly: true,
    runtimes: runtimeSummaries
  });
}

async function diagnoseOpenAICompatibleRuntime(runtime, checks, timing) {
  const startedAt = Date.now();
  const host = readBaseURLHost(runtime.baseURL);
  const commandFound = await checks.commandExists(runtime.command);
  const processFound = await checks.processExists(runtime.processNames ?? []);
  const tcpReachable = await checks.tcpReachable(host, timing.tcpTimeoutMs);

  if (!tcpReachable) {
    return createRuntimeSummary(runtime, {
      status: "not_installed_or_unreachable",
      commandFound,
      processFound,
      tcpReachable,
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
      tcpReachable,
      modelsStatus: modelsCheck.status,
      chatStatus: "skipped",
      modelCount: modelsCheck.modelCount,
      modelsCheckMs: modelsCheck.durationMs,
      reason: modelsCheck.reason,
      nextAction: missingModel ? runtime.nextActions.modelMissing : runtime.nextActions.tcpUnreachable,
      durationMs: Date.now() - startedAt
    });
  }

  const chatCheck = await checkChat(runtime.baseURL, runtime.model, checks.fetchImpl, timing.chatTimeoutMs);

  return createRuntimeSummary(runtime, {
    status: chatCheck.status,
    commandFound,
    processFound,
    tcpReachable,
    modelsStatus: modelsCheck.status,
    chatStatus: chatCheck.status,
    modelCount: modelsCheck.modelCount,
    modelsCheckMs: modelsCheck.durationMs,
    chatCheckMs: chatCheck.durationMs,
    firstTokenMs: chatCheck.firstTokenMs,
    replyLength: chatCheck.replyLength,
    reason: chatCheck.reason,
    nextAction: chatCheck.status === "ready" ? "Use this runtime for P2-20B real local model chat acceptance." : runtime.nextActions.chatFailed,
    durationMs: Date.now() - startedAt
  });
}

function diagnoseManagedLlamaCpp(env) {
  const enabled = env.AI_DESKTOP_PET_LLAMA_CPP_MANAGED === "1";
  const executableConfigured = hasText(env.AI_DESKTOP_PET_LLAMA_CPP_EXE);
  const modelConfigured = hasText(env.AI_DESKTOP_PET_LLAMA_CPP_MODEL);
  const host = hasText(env.AI_DESKTOP_PET_LLAMA_CPP_HOST) ? env.AI_DESKTOP_PET_LLAMA_CPP_HOST.trim() : "127.0.0.1";
  const port = readPositiveInteger(env.AI_DESKTOP_PET_LLAMA_CPP_PORT) ?? 0;
  const alias = hasText(env.AI_DESKTOP_PET_LLAMA_CPP_ALIAS) ? env.AI_DESKTOP_PET_LLAMA_CPP_ALIAS.trim() : defaultAlias;
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
  });
}

async function checkModels(baseURL, model, fetchImpl, timeoutMs) {
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

    return {
      status: modelIds.includes(model) ? "ready" : "model_missing",
      durationMs: Date.now() - startedAt,
      modelCount: modelIds.length,
      reason: modelIds.includes(model) ? undefined : "model_missing"
    };
  } catch (error) {
    return {
      status: "service_unreachable",
      durationMs: Date.now() - startedAt,
      reason: classifyFetchError(error)
    };
  }
}

async function checkChat(baseURL, model, fetchImpl, timeoutMs) {
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
        stream: true
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
      return {
        status: "chat_failed",
        durationMs: Date.now() - startedAt,
        firstTokenMs: stream.firstTokenMs,
        replyLength: stream.replyLength,
        reason: stream.sawEvent ? "empty_chat_stream" : "incompatible_chat_stream"
      };
    }

    return {
      status: "ready",
      durationMs: Date.now() - startedAt,
      firstTokenMs: stream.firstTokenMs,
      replyLength: stream.replyLength
    };
  } catch (error) {
    return {
      status: "chat_failed",
      durationMs: Date.now() - startedAt,
      reason: classifyFetchError(error)
    };
  }
}

async function readSseSummary(body, startedAt) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstTokenMs;
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

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
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

function createRuntimeSummary(runtime, details) {
  return removeUndefined({
    id: runtime.id,
    label: runtime.label,
    baseURLHost: readBaseURLHost(runtime.baseURL),
    model: runtime.model,
    ...details
  });
}

export function createModelsURL(value) {
  const url = new URL(value);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/models`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

export function createChatCompletionsURL(value) {
  const url = new URL(value);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/chat/completions`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

async function commandExists(command) {
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

async function processExists(processNames) {
  if (!Array.isArray(processNames) || processNames.length === 0) {
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

function tcpReachable(baseURLHost, timeoutMs) {
  if (!baseURLHost) {
    return Promise.resolve(false);
  }

  const [host, portText] = splitHostPort(baseURLHost);
  const port = Number(portText);

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result) => {
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

function splitHostPort(value) {
  const url = new URL(`http://${value}`);
  return [url.hostname, url.port];
}

function parseModelIds(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.data)) {
    return null;
  }

  const ids = [];

  for (const item of value.data) {
    const id = item && typeof item === "object"
      ? item.id ?? item.model ?? item.name
      : null;

    if (typeof id !== "string" || id.length === 0) {
      return null;
    }

    ids.push(id);
  }

  return ids;
}

function readBaseURLHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function classifyFetchError(error) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }

  return "network_or_runtime_unreachable";
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readPositiveInteger(value) {
  if (!hasText(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function removeUndefined(value) {
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function main() {
  const summary = await diagnoseLocalRuntimes();
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.log(JSON.stringify({
      ok: false,
      status: "script_failed",
      recommendedRuntime: "ollama",
      safeSummaryOnly: true,
      reason: error instanceof Error ? error.name : "unexpected_error",
      runtimes: []
    }, null, 2));
  });
}
