import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync("scripts/p2-47-presence-regression-pack.mjs", "utf8");
const p2_46RunnerSource = readFileSync(
  "scripts/p2-46-proactive-bubble-frequency-user-control-real-ui.mjs",
  "utf8"
);
const sandboxedPreloadTest = readFileSync("scripts/sandboxed-preload.test.mts", "utf8");
const mainSource = readFileSync("src/main/app.ts", "utf8");
const chatPreloadSource = readFileSync("src/preload/chat-preload.ts", "utf8");
const petPreloadSource = readFileSync("src/preload/pet-preload.ts", "utf8");
const petRendererSource = readFileSync("src/renderer/pet/main.ts", "utf8");
const ipcContractSource = readFileSync("src/shared/ipc-contract.ts", "utf8");

test("p2-47 package command builds once and runs the presence regression pack", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-47-presence-regression-pack"],
    "npm run build && node --no-warnings scripts/p2-47-presence-regression-pack.mjs"
  );
});

test("p2-47 runner is included in the live2d parameter verification path", () => {
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/p2-47-presence-regression-pack-runner\.test\.mts/
  );
  assert.match(
    packageJson.scripts?.["test:history"] ?? "",
    /scripts\/proactive-companion-settings-store\.test\.mts/
  );
  assert.equal(
    packageJson.scripts?.verify,
    "npm run build && npm run typecheck && npm run test:live2d-parameters && npm run test:history"
  );
});

test("p2-47 runner serializes the current desktop presence regression chain", () => {
  for (const token of [
    "scripts/p2-25b-edge-positioning-half-body-presence-real-ui.mjs",
    "scripts/p2-34-companion-presence-idle-mode-cadence-real-ui.mjs",
    "scripts/p2-45-proactive-bubble-action-expression-linkage-real-ui.mjs",
    "scripts/p2-46-proactive-bubble-frequency-user-control-real-ui.mjs",
    "edge positioning and half-body desktop presence",
    "startup idle mode focus quiet sleep and chat-open cadence",
    "sourced proactive bubble action and expression linkage",
    "proactive bubble cadence source toggles and runtime off clearing",
    "serialExecution: true"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-47 runner keeps output safe and cleans targeted residue", () => {
  for (const token of [
    "safeSummaryOnly: true",
    "sanitize(output)",
    "findScreenshotResidue",
    "removeNewTmpDirs",
    "knownOldPreserved",
    "privacyOutputSafe",
    "[REDACTED_LOCAL_PATH]",
    "[REDACTED_PROVIDER_BODY]",
    "[REDACTED_PROMPT]"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  const forbiddenList = extractConstArraySource(runnerSource, "return ![");
  for (const token of [
    "eventId",
    "safeQuery",
    "snippet",
    "providerMessages",
    "factCardBody",
    "memoryCardBody",
    "requestBody",
    "Authorization",
    "textContent",
    "bubbleText",
    "expressionName"
  ]) {
    assert.match(forbiddenList, new RegExp(escapeRegExp(token), "i"));
  }
});

test("p2-47 locks the detection-derived preload and clear-bubble contracts", () => {
  assert.match(sandboxedPreloadTest, /sandboxed chat preload has no relative runtime dependencies/);
  assert.ok(sandboxedPreloadTest.includes('require\\(["\']\\.{1,2}\\//'));
  assert.ok(sandboxedPreloadTest.includes('import\\(["\']\\.{1,2}\\//'));
  assert.match(chatPreloadSource, /import type \{[\s\S]*ProactiveCompanionSettings[\s\S]*\} from "\.\.\/shared\/proactive-companion-settings";/);
  assert.doesNotMatch(chatPreloadSource, /^import\s+(?!type)[^\n]*from "\.\.\/shared\//m);
  assert.doesNotMatch(petPreloadSource, /^import\s+(?!type)[^\n]*from "\.\.\/shared\//m);
  assert.doesNotMatch(chatPreloadSource, /PROACTIVE_COMPANION_CADENCES/);
  assert.doesNotMatch(chatPreloadSource, /normalizeProactiveCompanionSettings/);
  assert.match(chatPreloadSource, /const proactiveCompanionCadences = \["normal", "quiet", "off"\] as const/);
  assert.match(chatPreloadSource, /const defaultProactiveCompanionSettings: ProactiveCompanionSettings = \{[\s\S]*cadence: "normal"[\s\S]*memorySourceBubbles: true[\s\S]*searchSourceBubbles: true[\s\S]*\}/);
  assert.match(chatPreloadSource, /const proactiveCompanionApi: ProactiveCompanionApi = \{[\s\S]*getSettings\(\)[\s\S]*setSettings\(update\)[\s\S]*onSettingsChanged\(handler\)[\s\S]*\}/);
  assert.match(chatPreloadSource, /exposeInMainWorld\("proactiveCompanionApi", proactiveCompanionApi\)/);

  const clearPetBubbleBody = extractBetween(
    mainSource,
    "function clearPetProactiveSpeechBubble(): void {",
    "function getRuntimeProactiveSpeechBubbleTimeBand"
  );
  assert.match(clearPetBubbleBody, /markProactiveSpeechBubbleHidden\(\)/);
  assert.match(clearPetBubbleBody, /petWindow\.webContents\.send\("pet:clear-proactive-speech-bubble"\)/);
  assert.doesNotMatch(clearPetBubbleBody, /sendPetActionTrigger|pet:action-trigger/);
  assert.match(mainSource, /if \(currentProactiveCompanionSettings\.cadence === "off"\) \{[\s\S]*cancelStartupProactiveSpeechBubbleTimer\(\)[\s\S]*cancelIdleProactiveSpeechBubbleTimer\(\)[\s\S]*clearPetProactiveSpeechBubble\(\)[\s\S]*nextIdleProactiveSpeechBubbleReason = "idle_presence";[\s\S]*\} else \{/);
  assert.match(mainSource, /ipcMain\.handle\("proactiveCompanion:get-settings", \(event\) => \{[\s\S]*if \(!isChatSender\(event\)[\s\S]*throw new Error\("Unauthorized proactive companion settings request"\)/);
  assert.match(mainSource, /ipcMain\.handle\("proactiveCompanion:set-settings", \(event, update: unknown\) => \{[\s\S]*if \(!isChatSender\(event\)[\s\S]*throw new Error\("Unauthorized proactive companion settings request"\)/);

  assert.match(petPreloadSource, /onClearProactiveSpeechBubble/);
  assert.match(petRendererSource, /onClearProactiveSpeechBubble\(\(\) =>/);
  const rendererClearBody = extractBetween(
    petRendererSource,
    "function clearProactiveSpeechBubble(): void {",
    "function showProactiveSpeechBubble"
  );
  for (const token of [
    "proactiveSpeechBubble.textContent = \"\"",
    "proactiveSpeechBubble.dataset.state = \"hidden\"",
    "delete proactiveSpeechBubble.dataset.lineId",
    "delete proactiveSpeechBubble.dataset.reason",
    "proactiveSpeechBubble.setAttribute(\"aria-hidden\", \"true\")"
  ]) {
    assert.match(rendererClearBody, new RegExp(escapeRegExp(token)));
  }
  assert.match(ipcContractSource, /onClearProactiveSpeechBubble\(handler: \(\) => void\): \(\) => void/);

  assert.match(p2_46RunnerSource, /runtimeOffBubbleState/);
  assert.match(p2_46RunnerSource, /source:disable-visible-bubble/);
});

test("p2-47 locks p2-46 real UI safe-output failure and privacy shape", () => {
  const forbiddenList = extractArrayDeclaration(p2_46RunnerSource, "forbiddenOutputPatterns");
  for (const token of [
    "eventId",
    "safeContextTag",
    "contextTag",
    ".env",
    "sk-",
    "complete prompt",
    "system prompt",
    "providerMessages",
    "userMessage",
    "assistantMessage",
    "messageText",
    "bubbleText",
    "textContent",
    "factCardBody",
    "memoryCardBody",
    "memory title",
    "memory content",
    "history summary",
    "safeQuery",
    "snippet",
    "domain",
    "url",
    "title",
    "raw MCP",
    "apiKey",
    "Authorization",
    "motionPath",
    "expressionName",
    "partId",
    "resourcePath"
  ]) {
    assert.match(forbiddenList, new RegExp(escapeRegExp(token), "i"));
  }

  const failureCatchBody = extractBetween(
    p2_46RunnerSource,
    "} catch (error) {",
    "  } finally {"
  );
  assert.match(failureCatchBody, /failureCategory: classifyError\(error\)/);
  assert.match(failureCatchBody, /failureStep: currentStep/);
  assert.match(failureCatchBody, /errorName: error instanceof Error \? error\.name : "Error"/);
  assert.doesNotMatch(failureCatchBody, /error\.message|\.stack|error:/);
  assert.match(p2_46RunnerSource, /checks\.privacyOutputSafe = isSafeOutput\(summary\) &&/);
  assert.match(p2_46RunnerSource, /writeResult\(summary\)/);
});

function extractConstArraySource(source: string, start: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  const endIndex = source.indexOf("].some((pattern) => pattern.test(text));", startIndex);
  assert.notEqual(endIndex, -1, "missing forbidden pattern array ending");
  return source.slice(startIndex, endIndex);
}

function extractArrayDeclaration(source: string, name: string): string {
  const pattern = new RegExp(`const ${escapeRegExp(name)} = \\[[\\s\\S]*?\\];`);
  const match = source.match(pattern);
  assert.ok(match, `missing const array ${name}`);
  return match[0];
}

function extractBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing end ${end}`);
  return source.slice(startIndex, endIndex);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
