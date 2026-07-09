import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const appSource = readFileSync(join(process.cwd(), "src", "main", "app.ts"), "utf8");
const packageSource = readFileSync(join(process.cwd(), "package.json"), "utf8");
const realUiRunnerSource = readFileSync(
  join(process.cwd(), "scripts", "p2-53-startup-local-model-immediate-dialogue-real-ui.mjs"),
  "utf8"
);

function extractFunction(name: string): string {
  const start = appSource.indexOf(`function ${name}`);

  assert.notEqual(start, -1, `Expected ${name} to exist`);

  const nextFunction = appSource.indexOf("\nfunction ", start + 1);
  return appSource.slice(start, nextFunction === -1 ? appSource.length : nextFunction);
}

test("startup runtime provider falls back to immediate local fake dialogue instead of static embedded URL", () => {
  const getCurrentProviderConfig = extractFunction("getCurrentProviderConfig");
  const getRuntimeProviderConfig = extractFunction("getRuntimeProviderConfig");
  const createProviderFromCurrentConfig = extractFunction("createProviderFromCurrentConfig");

  assert.match(appSource, /const STARTUP_LOCAL_FALLBACK_PROVIDER_CONFIG: ProviderConfig = \{\s+providerId: "fake",\s+displayName: "本地即时对话"\s+\};/);
  assert.match(getCurrentProviderConfig, /return savedConfig \?\? providerConfigStore\?\.getConfig\(\) \?\? DEFAULT_PROVIDER_CONFIG;/);
  assert.match(getRuntimeProviderConfig, /return STARTUP_LOCAL_FALLBACK_PROVIDER_CONFIG;/);
  assert.match(createProviderFromCurrentConfig, /config: getRuntimeProviderConfig\(\)/);
});

test("default embedded static config cannot override managed handoff provider configs", () => {
  const getCurrentProviderConfig = extractFunction("getCurrentProviderConfig");
  const isDefaultEmbeddedLlamaCppConfig = extractFunction("isDefaultEmbeddedLlamaCppConfig");

  assert.match(getCurrentProviderConfig, /savedConfig && !isDefaultEmbeddedLlamaCppConfig\(savedConfig\)/);
  assert.match(getCurrentProviderConfig, /if \(bundledLlamaCppProviderConfig\) \{\s+return bundledLlamaCppProviderConfig;\s+\}/);
  assert.match(getCurrentProviderConfig, /if \(managedLlamaCppProviderConfig\) \{\s+return managedLlamaCppProviderConfig;\s+\}/);
  assert.match(isDefaultEmbeddedLlamaCppConfig, /localPresetId === "embedded-llama-cpp"/);
  assert.match(isDefaultEmbeddedLlamaCppConfig, /config\.baseURL === DEFAULT_PROVIDER_CONFIG\.baseURL/);
  assert.match(isDefaultEmbeddedLlamaCppConfig, /config\.model === DEFAULT_PROVIDER_CONFIG\.model/);
});

test("bundled runtime miss or startup error refreshes provider so chat can stay on fallback", () => {
  const startBundledLlamaCppRuntimeNow = extractFunction("startBundledLlamaCppRuntimeNow");

  assert.match(startBundledLlamaCppRuntimeNow, /if \(!resolved\.config\) \{[\s\S]*options\.refreshProvider\?\.\(\);[\s\S]*return resolved\.safeSummary;/);
  assert.match(startBundledLlamaCppRuntimeNow, /catch \{[\s\S]*options\.refreshProvider\?\.\(\);[\s\S]*const errorSummary/);
});

test("chat error copy does not send embedded local failures toward Ollama", () => {
  const getChatErrorMessage = extractFunction("getChatErrorMessage");

  assert.doesNotMatch(getChatErrorMessage, /Ollama|ollama|推荐本地模型|baseURL|127\.0\.0\.1:8080/);
});

test("P2-53 real UI runner starts without provider env and checks immediate dialogue fallback", () => {
  assert.match(packageSource, /"accept:p2-53-startup-local-model-immediate-dialogue": "npm run build && node --no-warnings scripts\/p2-53-startup-local-model-immediate-dialogue-real-ui\.mjs"/);
  assert.match(realUiRunnerSource, /AI_DESKTOP_PET_PROVIDER: ""/);
  assert.match(realUiRunnerSource, /AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT/);
  assert.match(realUiRunnerSource, /runtimeUsesImmediateFallback/);
  assert.match(realUiRunnerSource, /firstMessageGetsPetReply/);
  assert.match(realUiRunnerSource, /noMisleadingStartupError/);
});
