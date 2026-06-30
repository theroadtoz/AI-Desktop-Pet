import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LlamaCppRuntimeSummary } from "../src/main/services/local-runtime/llama-cpp-runtime";

const require = createRequire(import.meta.url);
const {
  createLlamaCppRuntimeSettingsStore
} = require("../dist/main/services/local-runtime/llama-cpp-runtime-settings-store.js") as typeof import("../src/main/services/local-runtime/llama-cpp-runtime-settings-store");

const LEAK_MARKER = "DO_NOT_LEAK_LLAMA_CPP_SETTINGS";

test("settings store starts disabled and safe view omits complete local paths", () => {
  const fixture = createFixture();

  try {
    const store = createLlamaCppRuntimeSettingsStore({ userDataPath: fixture.userDataPath });
    const view = store.getSafeSettingsView();

    assert.equal(view.enabled, false);
    assert.equal(view.status, "disabled");
    assert.equal(view.safeSummaryOnly, true);
    assert.equal(view.executableConfigured, false);
    assert.equal(view.modelConfigured, false);
    assert.equal(JSON.stringify(view).includes(LEAK_MARKER), false);
  } finally {
    fixture.cleanup();
  }
});

test("path setters save complete paths for main and expose only basenames in safe view", () => {
  const fixture = createFixture();

  try {
    const store = createLlamaCppRuntimeSettingsStore({ userDataPath: fixture.userDataPath });
    const executableView = store.setExecutablePath(fixture.executablePath);
    const modelView = store.setModelPath(fixture.modelPath);
    const settingsFile = readSettingsFile(fixture.userDataPath);

    assert.equal(executableView.executableConfigured, true);
    assert.equal(executableView.executableName, "llama-server.exe");
    assert.equal(modelView.modelConfigured, true);
    assert.equal(modelView.modelName, "model.gguf");
    assert.equal(JSON.stringify(executableView).includes(LEAK_MARKER), false);
    assert.equal(JSON.stringify(modelView).includes(LEAK_MARKER), false);
    assert.equal(settingsFile.executablePath, fixture.executablePath);
    assert.equal(settingsFile.modelPath, fixture.modelPath);
  } finally {
    fixture.cleanup();
  }
});

test("updateSettings normalizes unsafe connection and runtime values", () => {
  const fixture = createFixture();

  try {
    const store = createLlamaCppRuntimeSettingsStore({ userDataPath: fixture.userDataPath });
    const view = store.updateSettings({
      enabled: true,
      alias: String.raw`C:\unsafe\model`,
      host: "127.0.0.1 /bad",
      port: 70_000,
      ctxSize: -1,
      startupTimeoutMs: 0,
      stopTimeoutMs: 600_001,
      healthPollIntervalMs: Number.NaN
    } as Parameters<typeof store.updateSettings>[0]);

    assert.equal(view.enabled, true);
    assert.equal(view.alias, "ai-desktop-pet-local");
    assert.equal(view.host, "127.0.0.1");
    assert.equal(view.port, undefined);
    assert.equal(view.ctxSize, 2048);
    assert.equal(view.startupTimeoutMs, 30_000);
    assert.equal(view.stopTimeoutMs, 5_000);
    assert.equal(view.healthPollIntervalMs, 200);
  } finally {
    fixture.cleanup();
  }
});

test("updateSettings clears optional port and falls back when numeric fields are blanked", () => {
  const fixture = createFixture();

  try {
    const store = createLlamaCppRuntimeSettingsStore({ userDataPath: fixture.userDataPath });

    store.updateSettings({
      enabled: true,
      port: 4321,
      ctxSize: 4096
    });

    const view = store.updateSettings({
      port: null,
      ctxSize: null
    });

    assert.equal(view.enabled, true);
    assert.equal(view.port, undefined);
    assert.equal(view.ctxSize, 2048);
  } finally {
    fixture.cleanup();
  }
});

test("getRuntimeConfig returns complete main-only runtime settings", () => {
  const fixture = createFixture();

  try {
    const store = createLlamaCppRuntimeSettingsStore({ userDataPath: fixture.userDataPath });

    store.setExecutablePath(fixture.executablePath);
    store.setModelPath(fixture.modelPath);
    store.updateSettings({
      enabled: true,
      host: "127.0.0.1",
      port: 4321,
      ctxSize: 4096,
      alias: "local-test",
      startupTimeoutMs: 12_000,
      stopTimeoutMs: 3_000,
      healthPollIntervalMs: 250
    });

    const config = store.getRuntimeConfig();

    assert.deepEqual(config, {
      enabled: true,
      executablePath: fixture.executablePath,
      modelPath: fixture.modelPath,
      host: "127.0.0.1",
      port: 4321,
      ctxSize: 4096,
      alias: "local-test",
      startupTimeoutMs: 12_000,
      stopTimeoutMs: 3_000,
      healthPollIntervalMs: 250
    });
  } finally {
    fixture.cleanup();
  }
});

test("safe view merges runtime summary without leaking complete local paths", () => {
  const fixture = createFixture();

  try {
    const store = createLlamaCppRuntimeSettingsStore({ userDataPath: fixture.userDataPath });

    store.setExecutablePath(fixture.executablePath);
    store.setModelPath(fixture.modelPath);
    store.updateSettings({ enabled: true });

    const view = store.getSafeSettingsView({
      runtime: "llama.cpp",
      enabled: true,
      status: "timeout",
      safeSummaryOnly: true,
      executableConfigured: true,
      modelConfigured: true,
      baseURLHost: "127.0.0.1:4321",
      reason: "health_timeout",
      executablePath: fixture.executablePath,
      modelPath: fixture.modelPath
    } as LlamaCppRuntimeSummary);

    assert.equal(view.status, "timeout");
    assert.equal(view.baseURLHost, "127.0.0.1:4321");
    assert.equal(view.reason, "health_timeout");
    assert.equal(view.executableName, "llama-server.exe");
    assert.equal(view.modelName, "model.gguf");
    assert.equal(JSON.stringify(view).includes(LEAK_MARKER), false);
  } finally {
    fixture.cleanup();
  }
});

function createFixture(): {
  userDataPath: string;
  executablePath: string;
  modelPath: string;
  cleanup(): void;
} {
  const userDataPath = mkdtempSync(join(tmpdir(), `${LEAK_MARKER}-user-data-`));
  const localRoot = join(userDataPath, `${LEAK_MARKER}-local-runtime`);

  return {
    userDataPath,
    executablePath: join(localRoot, "bin", "llama-server.exe"),
    modelPath: join(localRoot, "models", "model.gguf"),
    cleanup() {
      rmSync(userDataPath, { recursive: true, force: true });
    }
  };
}

function readSettingsFile(userDataPath: string): {
  executablePath?: string;
  modelPath?: string;
} {
  return JSON.parse(
    readFileSync(join(userDataPath, "config", "llama-cpp-runtime.json"), "utf8")
  ) as {
    executablePath?: string;
    modelPath?: string;
  };
}
