const providerId = "local-openai-compatible";
const runtime = "ollama";
const baseURL = "http://localhost:11434/v1";
const model = "qwen3.5:2b-q4_K_M";
const modelsTimeoutMs = 5_000;
const chatTimeoutMs = 60_000;

async function main() {
  const startedAt = Date.now();
  const host = readBaseURLHost(baseURL);
  const modelsCheck = await checkModels();

  if (modelsCheck.status !== "ready") {
    printSummary({
      ok: false,
      status: modelsCheck.status,
      providerId,
      runtime,
      model,
      baseURLHost: host,
      durationMs: Date.now() - startedAt,
      modelsCheckMs: modelsCheck.durationMs,
      modelCount: modelsCheck.modelCount,
      reason: modelsCheck.reason
    });
    return;
  }

  const chatCheck = await checkChat();

  printSummary({
    ok: chatCheck.status === "ready",
    status: chatCheck.status,
    providerId,
    runtime,
    model,
    baseURLHost: host,
    durationMs: Date.now() - startedAt,
    modelsCheckMs: modelsCheck.durationMs,
    chatCheckMs: chatCheck.durationMs,
    modelCount: modelsCheck.modelCount,
    firstTokenMs: chatCheck.firstTokenMs,
    replyLength: chatCheck.replyLength,
    reason: chatCheck.reason
  });
}

async function checkModels() {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(createModelsURL(baseURL), {
      method: "GET",
      headers: { Accept: "application/json" }
    }, modelsTimeoutMs);

    if (!response.ok) {
      return {
        status: "not_installed_or_unreachable",
        durationMs: Date.now() - startedAt,
        reason: `models_http_${response.status}`
      };
    }

    const modelIds = parseModelIds(await response.json());

    if (!modelIds) {
      return {
        status: "not_installed_or_unreachable",
        durationMs: Date.now() - startedAt,
        reason: "models_response_incompatible"
      };
    }

    return {
      status: modelIds.includes(model) ? "ready" : "model_missing",
      durationMs: Date.now() - startedAt,
      modelCount: modelIds.length
    };
  } catch (error) {
    return {
      status: "not_installed_or_unreachable",
      durationMs: Date.now() - startedAt,
      reason: classifyFetchError(error)
    };
  }
}

async function checkChat() {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(createChatCompletionsURL(baseURL), {
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
    }, chatTimeoutMs);

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
    status: "chat_failed",
    providerId,
    runtime,
    model,
    baseURLHost: readBaseURLHost(baseURL),
    reason: error instanceof Error ? error.name : "unexpected_error"
  });
});
