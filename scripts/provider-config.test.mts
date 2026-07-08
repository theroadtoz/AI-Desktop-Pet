import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PROVIDER_CONFIG,
  FAKE_PROVIDER_CONFIG,
  createProviderConfigStore,
  createProviderTelemetryPayload,
  parseProviderConfig
} = require("../dist/main/services/config/provider-config-store.js") as typeof import("../src/main/services/config/provider-config-store");
const {
  createChatProviderFromConfig
} = require("../dist/main/services/chat/provider-factory.js") as typeof import("../src/main/services/chat/provider-factory");
const {
  readEnvProviderConfig
} = require("../dist/main/services/config/env-config.js") as typeof import("../src/main/services/config/env-config");

const emptyEnvCwd = join(process.cwd(), ".tmp-does-not-exist-for-provider-config-tests");
const minimalChatRequest = {
  requestVersion: 1,
  conversationId: "00000000-0000-4000-8000-000000000001",
  messages: [{
    id: "00000000-0000-4000-8000-000000000002",
    role: "user" as const,
    content: "你好"
  }]
};

test("default provider config recommends embedded local model path", () => {
  assert.deepEqual(DEFAULT_PROVIDER_CONFIG, {
    providerId: "local-openai-compatible",
    displayName: "内置本地模型",
    baseURL: "http://127.0.0.1:8080/v1",
    model: "ai-desktop-pet-local",
    localPresetId: "embedded-llama-cpp",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  });
  assert.deepEqual(FAKE_PROVIDER_CONFIG, {
    providerId: "fake",
    displayName: "Fake Provider"
  });
});

test("local OpenAI-compatible provider parser accepts local config without api key", () => {
  const config = parseProviderConfig({
    providerId: "local-openai-compatible",
    displayName: "Ollama 本地模型",
    baseURL: "http://localhost:11434/v1",
    model: "qwen2.5:3b-instruct",
    localPresetId: "ollama",
    apiKeyRef: "should-not-be-saved",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  });

  assert.deepEqual(config, {
    providerId: "local-openai-compatible",
    displayName: "Ollama 本地模型",
    baseURL: "http://localhost:11434/v1",
    model: "qwen2.5:3b-instruct",
    localPresetId: "ollama",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  });
});

test("env provider keeps fake explicit and local env uses recommended defaults", () => {
  const fake = readEnvProviderConfig({
    cwd: emptyEnvCwd,
    env: { AI_DESKTOP_PET_PROVIDER: "fake" }
  });
  const local = readEnvProviderConfig({
    cwd: emptyEnvCwd,
    env: { AI_DESKTOP_PET_PROVIDER: "local-openai-compatible" }
  });

  assert.deepEqual(fake?.providerConfig, FAKE_PROVIDER_CONFIG);
  assert.equal(fake?.apiKey, null);
  assert.deepEqual(local?.providerConfig, DEFAULT_PROVIDER_CONFIG);
  assert.equal(local?.apiKey, null);
});

test("env provider ignores external OpenAI-compatible chat configuration", () => {
  const external = readEnvProviderConfig({
    cwd: emptyEnvCwd,
    env: {
      AI_DESKTOP_PET_PROVIDER: "openai-compatible",
      AI_DESKTOP_PET_BASE_URL: "https://api.example.com/v1",
      AI_DESKTOP_PET_MODEL: "external-chat-model",
      AI_DESKTOP_PET_API_KEY: "sk-test-should-not-be-used"
    }
  });

  assert.equal(external, null);
});

test("local provider telemetry records preset and host without key material", () => {
  const payload = createProviderTelemetryPayload({
    providerId: "local-openai-compatible",
    displayName: "LM Studio",
    baseURL: "http://localhost:1234/v1",
    model: "local-model",
    localPresetId: "lm-studio",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  }, "file");

  assert.equal(payload.providerId, "local-openai-compatible");
  assert.equal(payload.localPresetId, "lm-studio");
  assert.equal(payload.baseURLHost, "localhost:1234");
  assert.equal("apiKey" in payload, false);
  assert.equal(payload.apiKeyRef, undefined);
});

test("local OpenAI-compatible provider parser accepts embedded preset id", () => {
  const config = parseProviderConfig({
    providerId: "local-openai-compatible",
    displayName: "内置本地模型",
    baseURL: "http://127.0.0.1:8080/v1",
    model: "ai-desktop-pet-local",
    localPresetId: "embedded-llama-cpp",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  });

  assert.equal(config?.providerId, "local-openai-compatible");
  assert.equal(config?.providerId === "local-openai-compatible" ? config.localPresetId : undefined, "embedded-llama-cpp");
});

test("local OpenAI-compatible provider parser rejects invalid local config", () => {
  assert.equal(parseProviderConfig({
    providerId: "local-openai-compatible",
    displayName: "Ollama 本地模型",
    baseURL: "",
    model: "qwen2.5:3b-instruct",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  }), null);

  assert.equal(parseProviderConfig({
    providerId: "local-openai-compatible",
    displayName: "Ollama 本地模型",
    baseURL: "http://localhost:11434/v1",
    model: "qwen2.5:3b-instruct",
    temperature: 0.7,
    maxTokens: 0,
    timeoutMs: 60000
  }), null);
});

test("provider config store migrates legacy external provider file to local recommendation", () => {
  const userDataPath = createTempUserDataPath();
  const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];

  try {
    writeProviderConfig(userDataPath, {
      providerId: "openai-compatible",
      displayName: "Legacy external provider",
      baseURL: "https://legacy-cloud.example/v1",
      model: "legacy-cloud-model",
      apiKeyRef: "openai-compatible-default",
      temperature: 0.7,
      maxTokens: 1024,
      timeoutMs: 60000
    });

    const store = createProviderConfigStore({
      userDataPath,
      logTelemetry(type, payload) {
        events.push({ type, payload });
      }
    });

    assert.deepEqual(store.getConfig(), DEFAULT_PROVIDER_CONFIG);
    assert.equal(store.hasConfig(), true);
    assert.ok(events.some((event) => (
      event.type === "provider_config_migrated" &&
      event.payload?.reason === "external_model_disabled" &&
      event.payload?.toProviderId === "local-openai-compatible"
    )));
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("provider config store migrates custom external OpenAI-compatible providers to local recommendation", () => {
  const userDataPath = createTempUserDataPath();
  const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const customConfig = {
    providerId: "openai-compatible" as const,
    displayName: "External OpenAI-compatible",
    baseURL: "https://api.example.com/v1",
    model: "external-chat-model",
    apiKeyRef: "custom-external-key",
    temperature: 0.5,
    maxTokens: 512,
    timeoutMs: 30000
  };

  try {
    writeProviderConfig(userDataPath, customConfig);

    const store = createProviderConfigStore({
      userDataPath,
      logTelemetry(type, payload) {
        events.push({ type, payload });
      }
    });

    assert.deepEqual(store.getConfig(), DEFAULT_PROVIDER_CONFIG);
    assert.ok(events.some((event) => (
      event.type === "provider_config_migrated" &&
      event.payload?.reason === "external_model_disabled" &&
      event.payload?.toProviderId === "local-openai-compatible"
    )));
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("provider config store refuses to persist external OpenAI-compatible providers", () => {
  const userDataPath = createTempUserDataPath();

  try {
    const store = createProviderConfigStore({ userDataPath });
    const saved = store.saveConfig({
      providerId: "openai-compatible",
      displayName: "External OpenAI-compatible",
      baseURL: "https://api.example.com/v1",
      model: "external-chat-model",
      apiKeyRef: "custom-external-key",
      temperature: 0.5,
      maxTokens: 512,
      timeoutMs: 30000
    });

    assert.deepEqual(saved, DEFAULT_PROVIDER_CONFIG);
    assert.deepEqual(store.getConfig(), DEFAULT_PROVIDER_CONFIG);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("diagnostic script reports local recommendation for empty userData", () => {
  const userDataPath = createTempUserDataPath();

  try {
    const result = spawnSync(process.execPath, ["scripts/check-provider-config.js", userDataPath], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /configFileExists: false/);
    assert.match(result.stdout, /configSource: default/);
    assert.match(result.stdout, /providerId: local-openai-compatible/);
    assert.match(result.stdout, /baseURL: http:\/\/127\.0\.0\.1:8080\/v1/);
    assert.match(result.stdout, /model: ai-desktop-pet-local/);
    assert.match(result.stdout, /apiKeyExists: false/);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("provider factory does not require real api key for local provider", () => {
  const provider = createChatProviderFromConfig({
    config: {
      providerId: "local-openai-compatible",
      displayName: "Ollama 本地模型",
      baseURL: "http://localhost:11434/v1",
      model: "qwen2.5:3b-instruct",
      temperature: 0.7,
      maxTokens: 240,
      timeoutMs: 60000
    },
    getApiKey() {
      throw new Error("local provider must not request a stored key");
    }
  });

  assert.equal(provider.id, "local-openai-compatible");
});

test("provider factory keeps explicit fake and blocks external or unavailable real providers", async () => {
  const fakeProvider = createChatProviderFromConfig({
    config: { providerId: "fake", displayName: "Fake Provider" },
    getApiKey() {
      return null;
    }
  });
  const missingKeyProvider = createChatProviderFromConfig({
    config: {
      providerId: "openai-compatible",
      displayName: "External OpenAI-compatible",
      baseURL: "https://api.example.com/v1",
      model: "external-chat-model",
      apiKeyRef: "openai-compatible-default",
      temperature: 0.7,
      maxTokens: 1024,
      timeoutMs: 60000
    },
    getApiKey() {
      return null;
    }
  });
  const invalidLocalProvider = createChatProviderFromConfig({
    config: {
      providerId: "local-openai-compatible",
      displayName: "Ollama 本地模型",
      baseURL: "not a url",
      model: "qwen2.5:3b-instruct",
      temperature: 0.7,
      maxTokens: 240,
      timeoutMs: 60000
    },
    getApiKey() {
      throw new Error("local provider must not request a stored key");
    }
  });
  const cloudProvider = createChatProviderFromConfig({
    config: {
      providerId: "openai-compatible",
      displayName: "External OpenAI-compatible",
      baseURL: "https://api.example.com/v1",
      model: "external-chat-model",
      apiKeyRef: "openai-compatible-default",
      temperature: 0.7,
      maxTokens: 1024,
      timeoutMs: 60000
    },
    getApiKey() {
      return "test-key";
    }
  });

  assert.equal(fakeProvider.id, "fake");
  assert.equal(missingKeyProvider.id, "openai-compatible");
  assert.equal(invalidLocalProvider.id, "local-openai-compatible");
  assert.equal(cloudProvider.id, "openai-compatible");
  await assert.rejects(
    missingKeyProvider.streamReply(minimalChatRequest, {
      signal: new AbortController().signal,
      onDelta() {}
    }),
    { name: "provider_invalid_config" }
  );
  await assert.rejects(
    cloudProvider.streamReply(minimalChatRequest, {
      signal: new AbortController().signal,
      onDelta() {}
    }),
    { name: "provider_invalid_config" }
  );
  await assert.rejects(
    invalidLocalProvider.streamReply(minimalChatRequest, {
      signal: new AbortController().signal,
      onDelta() {}
    }),
    { name: "provider_invalid_config" }
  );
});

function createTempUserDataPath(): string {
  return mkdtempSync(join(tmpdir(), "ai-desktop-pet-provider-"));
}

function writeProviderConfig(userDataPath: string, config: unknown): void {
  const configDirectory = join(userDataPath, "config");
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(join(configDirectory, "provider-config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
