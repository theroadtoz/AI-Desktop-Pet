import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  checkProviderHealth,
  createModelsURL
} = require("../dist/main/services/chat/provider-health.js") as typeof import("../src/main/services/chat/provider-health");

test("models URL preserves /v1 base path", () => {
  assert.equal(
    createModelsURL("http://localhost:11434/v1").toString(),
    "http://localhost:11434/v1/models"
  );
  assert.equal(
    createModelsURL("http://localhost:11434/v1/").toString(),
    "http://localhost:11434/v1/models"
  );
});

test("provider health detects ready and model_missing responses", async () => {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    assert.equal(request.url, "/v1/models");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "qwen2.5:3b-instruct" }, { id: "other-local-model" }] }));
  });

  try {
    await listen(server);
    const baseURL = localBaseURL(server);
    const ready = await checkProviderHealth({
      request: {
        providerId: "local-openai-compatible",
        baseURL,
        model: "qwen2.5:3b-instruct",
        timeoutMs: 500,
        localPresetId: "ollama"
      }
    });
    const missing = await checkProviderHealth({
      request: {
        providerId: "local-openai-compatible",
        baseURL,
        model: "missing-model",
        timeoutMs: 500,
        localPresetId: "ollama"
      }
    });

    assert.equal(ready.status, "ready");
    assert.equal(ready.modelCount, 2);
    assert.equal(ready.localPresetId, "ollama");
    assert.equal(missing.status, "model_missing");
    assert.equal(missing.modelCount, 2);
  } finally {
    await close(server);
  }
});

test("provider health detects incompatible responses", async () => {
  const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ models: ["qwen2.5:3b-instruct"] }));
  });

  try {
    await listen(server);
    const result = await checkProviderHealth({
      request: {
        providerId: "local-openai-compatible",
        baseURL: localBaseURL(server),
        model: "qwen2.5:3b-instruct",
        timeoutMs: 500,
        localPresetId: "custom-local"
      }
    });

    assert.equal(result.status, "incompatible_response");
  } finally {
    await close(server);
  }
});

test("provider health detects service_unreachable", async () => {
  const port = await getClosedPort();
  const result = await checkProviderHealth({
    request: {
      providerId: "local-openai-compatible",
      baseURL: `http://127.0.0.1:${port}/v1`,
      model: "qwen2.5:3b-instruct",
      timeoutMs: 200,
      localPresetId: "custom-local"
    }
  });

  assert.equal(result.status, "service_unreachable");
});

test("provider health detects timeout and cancellation", async () => {
  const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "qwen2.5:3b-instruct" }] }));
    }, 100);
  });

  try {
    await listen(server);
    const baseURL = localBaseURL(server);
    const timeout = await checkProviderHealth({
      request: {
        providerId: "local-openai-compatible",
        baseURL,
        model: "qwen2.5:3b-instruct",
        timeoutMs: 10,
        localPresetId: "ollama"
      }
    });
    const controller = new AbortController();
    const cancelledPromise = checkProviderHealth({
      request: {
        providerId: "local-openai-compatible",
        baseURL,
        model: "qwen2.5:3b-instruct",
        timeoutMs: 500,
        localPresetId: "ollama"
      },
      signal: controller.signal
    });

    controller.abort();
    const cancelled = await cancelledPromise;

    assert.equal(timeout.status, "timeout");
    assert.equal(cancelled.status, "cancelled");
  } finally {
    await close(server);
  }
});

test("cloud health returns missing_api_key without network request", async () => {
  let requestCount = 0;
  const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
    requestCount += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "cloud-model" }] }));
  });

  try {
    await listen(server);
    const result = await checkProviderHealth({
      request: {
        providerId: "openai-compatible",
        baseURL: localBaseURL(server),
        model: "cloud-model",
        timeoutMs: 500
      },
      apiKey: null
    });

    assert.equal(result.status, "missing_api_key");
    assert.equal(requestCount, 0);
  } finally {
    await close(server);
  }
});

function localBaseURL(server: ReturnType<typeof createServer>): string {
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  return `http://127.0.0.1:${address.port}/v1`;
}

function getClosedPort(): Promise<number> {
  const server = createServer();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.equal(typeof address, "object");
      assert.ok(address);
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

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
