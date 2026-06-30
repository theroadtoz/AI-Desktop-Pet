import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type {
  LlamaCppRuntimeStatus,
  LlamaCppRuntimeSummary
} from "../src/main/services/local-runtime/llama-cpp-runtime";

const require = createRequire(import.meta.url);
const {
  createLlamaCppProviderHandoff
} = require("../dist/main/services/local-runtime/llama-cpp-provider-handoff.js") as typeof import("../src/main/services/local-runtime/llama-cpp-provider-handoff");
const {
  DEFAULT_PROVIDER_CONFIG
} = require("../dist/main/services/config/provider-config-store.js") as typeof import("../src/main/services/config/provider-config-store");

const EXPECTED_OLLAMA_DEFAULT = {
  providerId: "local-openai-compatible",
  displayName: "Ollama 本地模型",
  baseURL: "http://localhost:11434/v1",
  model: "qwen2.5:3b-instruct",
  localPresetId: "ollama",
  temperature: 0.7,
  maxTokens: 240,
  timeoutMs: 60000
};
const FAKE_FULL_PATH_MARKER = "DO_NOT_LEAK_FAKE_FULL_LLAMA_PATH";

test("ready llama.cpp runtime creates local OpenAI-compatible handoff config", () => {
  const handoff = createLlamaCppProviderHandoff(
    createRuntimeSummary(),
    "http://127.0.0.1:4321/v1?debug=1#ignored"
  );

  assert.ok(handoff);
  assert.deepEqual(handoff.providerConfig, {
    providerId: "local-openai-compatible",
    displayName: "llama.cpp 本地模型",
    baseURL: "http://127.0.0.1:4321/v1",
    model: "ai-desktop-pet-local",
    localPresetId: "custom-local",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  });
  assert.deepEqual(handoff.safeSummary, {
    runtime: "llama.cpp",
    enabled: true,
    status: "ready",
    safeSummaryOnly: true,
    executableConfigured: true,
    modelConfigured: true,
    providerId: "local-openai-compatible",
    localPresetId: "custom-local",
    baseURLHost: "127.0.0.1:4321",
    alias: "ai-desktop-pet-local"
  });
});

test("non-ready llama.cpp runtime statuses do not hand off provider config", () => {
  const blockedStatuses: LlamaCppRuntimeStatus[] = [
    "disabled",
    "missing_binary",
    "missing_model",
    "timeout",
    "error",
    "exited",
    "starting"
  ];

  for (const status of blockedStatuses) {
    assert.equal(
      createLlamaCppProviderHandoff(
        createRuntimeSummary({ status }),
        "http://127.0.0.1:4321/v1"
      ),
      null,
      status
    );
  }
});

test("invalid baseURL or alias does not hand off provider config", () => {
  const invalidBaseURLs = [
    null,
    "",
    "not-a-url",
    "ftp://127.0.0.1:4321/v1",
    "http://user:pass@127.0.0.1:4321/v1"
  ];

  for (const baseURL of invalidBaseURLs) {
    assert.equal(createLlamaCppProviderHandoff(createRuntimeSummary(), baseURL), null);
  }

  assert.equal(
    createLlamaCppProviderHandoff(
      createRuntimeSummary({ alias: `C:\\fake\\${FAKE_FULL_PATH_MARKER}\\model.gguf` }),
      "http://127.0.0.1:4321/v1"
    ),
    null
  );
  assert.equal(
    createLlamaCppProviderHandoff(
      createRuntimeSummary({ alias: `/fake/${FAKE_FULL_PATH_MARKER}/model.gguf` }),
      "http://127.0.0.1:4321/v1"
    ),
    null
  );
});

test("handoff output omits unexpected complete-path-like runtime fields", () => {
  const summary = {
    ...createRuntimeSummary(),
    executablePath: `C:\\fake\\${FAKE_FULL_PATH_MARKER}\\llama-server.exe`,
    modelPath: `C:\\fake\\${FAKE_FULL_PATH_MARKER}\\model.gguf`,
    stderr: `raw stderr ${FAKE_FULL_PATH_MARKER}`
  } as unknown as LlamaCppRuntimeSummary;
  const handoff = createLlamaCppProviderHandoff(summary, "http://127.0.0.1:4321/v1");

  assert.ok(handoff);
  assert.equal(JSON.stringify(handoff).includes(FAKE_FULL_PATH_MARKER), false);
});

test("llama.cpp handoff does not change the default Ollama provider config", () => {
  const before = JSON.stringify(DEFAULT_PROVIDER_CONFIG);

  assert.deepEqual(DEFAULT_PROVIDER_CONFIG, EXPECTED_OLLAMA_DEFAULT);
  assert.ok(createLlamaCppProviderHandoff(createRuntimeSummary(), "http://127.0.0.1:4321/v1"));
  assert.deepEqual(DEFAULT_PROVIDER_CONFIG, EXPECTED_OLLAMA_DEFAULT);
  assert.equal(JSON.stringify(DEFAULT_PROVIDER_CONFIG), before);
});

function createRuntimeSummary(
  overrides: Partial<LlamaCppRuntimeSummary> = {}
): LlamaCppRuntimeSummary {
  return {
    runtime: "llama.cpp",
    enabled: true,
    status: "ready",
    safeSummaryOnly: true,
    executableConfigured: true,
    modelConfigured: true,
    baseURLHost: "127.0.0.1:4321",
    alias: "ai-desktop-pet-local",
    ...overrides
  };
}
