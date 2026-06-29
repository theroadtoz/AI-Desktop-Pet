import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimeName = "llama.cpp";
const defaultAlias = "ai-desktop-pet-local";
const modelsTimeoutMs = 5_000;
const chatTimeoutMs = 60_000;
let runtimeModule;

try {
  runtimeModule = require("../dist/main/services/local-runtime/llama-cpp-runtime.js");
} catch {
  printSummary({
    ok: false,
    status: "script_failed",
    runtime: runtimeName,
    reason: "dist_runtime_missing"
  });
  process.exit(1);
}

const {
  createLlamaCppRuntime,
  readLlamaCppRuntimeConfigFromEnv
} = runtimeModule;

async function main() {
  const startedAt = Date.now();
  const cli = parseArgs(process.argv.slice(2));
  const envConfig = readLlamaCppRuntimeConfigFromEnv(process.env);
  const executablePath = readNonEmpty(cli.exe) ?? envConfig.executablePath;
  const modelPath = readNonEmpty(cli.model) ?? envConfig.modelPath;
  const alias = readNonEmpty(cli.alias) ?? envConfig.alias ?? defaultAlias;
  const host = readNonEmpty(cli.host) ?? envConfig.host;
  const port = readInteger(cli.port) ?? envConfig.port;
  const ctxSize = readInteger(cli.ctxSize) ?? envConfig.ctxSize;
  const runChat = cli.chat === true || process.env.AI_DESKTOP_PET_LLAMA_CPP_POC_CHAT === "1";

  if (!executablePath || !modelPath) {
    printSummary({
      ok: true,
      status: "skipped",
      reason: "missing_local_paths",
      runtime: runtimeName,
      modelAlias: alias,
      durationMs: Date.now() - startedAt
    });
    return;
  }

  const runtime = createLlamaCppRuntime({
    ...envConfig,
    enabled: true,
    executablePath,
    modelPath,
    ...(host ? { host } : {}),
    ...(port ? { port } : {}),
    ...(ctxSize ? { ctxSize } : {}),
    alias
  });

  const startSummary = await runtime.start();
  const baseURL = runtime.getBaseURL();
  let modelsCheck = null;
  let chatCheck = null;
  let stopSummary = null;

  try {
    if (startSummary.status === "ready" && baseURL) {
      modelsCheck = await checkModels(baseURL, alias);

      if (modelsCheck.status === "ready" && runChat) {
        chatCheck = await checkChat(baseURL, alias);
      }
    }
  } finally {
    stopSummary = await runtime.stop();
  }

  const status = startSummary.status !== "ready"
    ? startSummary.status
    : chatCheck?.status ?? modelsCheck?.status ?? "ready";

  printSummary({
    ok: status === "ready",
    status,
    runtime: runtimeName,
    modelAlias: alias,
    baseURLHost: startSummary.baseURLHost,
    durationMs: Date.now() - startedAt,
    startupMs: startSummary.startupMs,
    healthStatus: startSummary.status,
    modelsStatus: modelsCheck?.status,
    modelsCheckMs: modelsCheck?.durationMs,
    modelCount: modelsCheck?.modelCount,
    chatStatus: chatCheck?.status,
    chatCheckMs: chatCheck?.durationMs,
    firstTokenMs: chatCheck?.firstTokenMs,
    replyLength: chatCheck?.replyLength,
    exitCode: stopSummary?.exitCode ?? startSummary.exitCode,
    reason: startSummary.reason ?? chatCheck?.reason ?? modelsCheck?.reason
  });
}

async function checkModels(baseURL, alias) {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(createModelsURL(baseURL), {
      method: "GET",
      headers: { Accept: "application/json" }
    }, modelsTimeoutMs);

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
      status: modelIds.includes(alias) ? "ready" : "model_missing",
      durationMs: Date.now() - startedAt,
      modelCount: modelIds.length
    };
  } catch (error) {
    return {
      status: "service_unreachable",
      durationMs: Date.now() - startedAt,
      reason: classifyFetchError(error)
    };
  }
}

async function checkChat(baseURL, alias) {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(createChatCompletionsURL(baseURL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: alias,
        messages: [{ role: "user", content: "ping" }],
        temperature: 0.2,
        max_tokens: 32,
        stream: true
      })
    }, chatTimeoutMs);

    if (!response.ok || !response.body) {
      return {
        status: "chat_failed",
        durationMs: Date.now() - startedAt,
        reason: `chat_http_${response.status}`
      };
    }

    const stream = await readSseSummary(response.body, startedAt);

    return {
      status: stream.replyLength > 0 ? "ready" : "chat_failed",
      durationMs: Date.now() - startedAt,
      firstTokenMs: stream.firstTokenMs,
      replyLength: stream.replyLength,
      reason: stream.replyLength > 0
        ? undefined
        : stream.sawEvent ? "empty_chat_stream" : "incompatible_chat_stream"
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

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--chat") {
      parsed.chat = true;
      continue;
    }
    if (arg === "--no-chat") {
      parsed.chat = false;
      continue;
    }

    const inline = arg.match(/^--([^=]+)=(.*)$/);

    if (inline) {
      parsed[toCamelCase(inline[1])] = inline[2];
      continue;
    }

    if (arg.startsWith("--")) {
      const value = args[index + 1];
      if (value && !value.startsWith("--")) {
        parsed[toCamelCase(arg.slice(2))] = value;
        index += 1;
      }
    }
  }

  return parsed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
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

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function createModelsURL(value) {
  const url = new URL(value);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/models`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function createChatCompletionsURL(value) {
  const url = new URL(value);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/chat/completions`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
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

function readNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readInteger(value) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function printSummary(summary) {
  console.log(JSON.stringify(removeUndefined({
    ...summary,
    safeSummaryOnly: true
  }), null, 2));
}

function removeUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

main().catch((error) => {
  printSummary({
    ok: false,
    status: "script_failed",
    runtime: runtimeName,
    reason: error instanceof Error ? error.name : "unexpected_error"
  });
  process.exitCode = 1;
});
