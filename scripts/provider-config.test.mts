import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PROVIDER_CONFIG,
  FAKE_PROVIDER_CONFIG,
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

test("default provider config recommends explicit local Ollama path", () => {
  assert.deepEqual(DEFAULT_PROVIDER_CONFIG, {
    providerId: "local-openai-compatible",
    displayName: "Ollama 本地模型",
    baseURL: "http://localhost:11434/v1",
    model: "qwen3.5:2b-q4_K_M",
    localPresetId: "ollama",
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
    model: "qwen3.5:2b-q4_K_M",
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
    model: "qwen3.5:2b-q4_K_M",
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

test("local OpenAI-compatible provider parser rejects invalid local config", () => {
  assert.equal(parseProviderConfig({
    providerId: "local-openai-compatible",
    displayName: "Ollama 本地模型",
    baseURL: "",
    model: "qwen3.5:2b-q4_K_M",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  }), null);

  assert.equal(parseProviderConfig({
    providerId: "local-openai-compatible",
    displayName: "Ollama 本地模型",
    baseURL: "http://localhost:11434/v1",
    model: "qwen3.5:2b-q4_K_M",
    temperature: 0.7,
    maxTokens: 0,
    timeoutMs: 60000
  }), null);
});

test("provider factory does not require real api key for local provider", () => {
  const provider = createChatProviderFromConfig({
    config: {
      providerId: "local-openai-compatible",
      displayName: "Ollama 本地模型",
      baseURL: "http://localhost:11434/v1",
      model: "qwen3.5:2b-q4_K_M",
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

test("provider factory keeps fake and cloud provider fallback behavior", () => {
  const fakeProvider = createChatProviderFromConfig({
    config: { providerId: "fake", displayName: "Fake Provider" },
    getApiKey() {
      return null;
    }
  });
  const missingKeyProvider = createChatProviderFromConfig({
    config: {
      providerId: "openai-compatible",
      displayName: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyRef: "openai-compatible-default",
      temperature: 0.7,
      maxTokens: 1024,
      timeoutMs: 60000
    },
    getApiKey() {
      return null;
    }
  });
  const cloudProvider = createChatProviderFromConfig({
    config: {
      providerId: "openai-compatible",
      displayName: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
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
  assert.equal(missingKeyProvider.id, "fake");
  assert.equal(cloudProvider.id, "openai-compatible");
});
