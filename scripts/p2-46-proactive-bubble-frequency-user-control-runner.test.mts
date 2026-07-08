import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync(
  "scripts/p2-46-proactive-bubble-frequency-user-control-real-ui.mjs",
  "utf8"
);
const mainSource = readFileSync("src/main/app.ts", "utf8");
const petPreloadSource = readFileSync("src/preload/pet-preload.ts", "utf8");
const petRendererSource = readFileSync("src/renderer/pet/main.ts", "utf8");

test("p2-46 package command builds and runs the proactive bubble user control runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-46-proactive-bubble-frequency-user-control"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-46-proactive-bubble-frequency-user-control-real-ui.mjs"
  );
});

test("p2-46 runner is included in the live2d parameter verification path", () => {
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/p2-46-proactive-bubble-frequency-user-control-runner\.test\.mts/
  );
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/proactive-companion-settings\.test\.mts/
  );
});

test("p2-46 runner uses real UI harness, FakeProvider isolation, acceptance telemetry, and cleanup", () => {
  for (const token of [
    "createRealUiRunContext",
    "startElectron",
    "connectToElectron",
    "waitForWindow",
    "readPrivacyCheckText",
    "assertNoScreenshotResidue",
    "cleanupRealUiRun",
    "AI_DESKTOP_PET_PROVIDER: \"fake\"",
    "AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: \"1\"",
    "provider: \"fake\"",
    "providerFixture: \"FakeProvider\"",
    "safeSummaryOnly: true"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-46 runner validates off cadence and source toggles through safe settings", () => {
  for (const token of [
    "runOffCadenceCase",
    "runSourceToggleCase",
    "proactiveCompanionApi",
    "proactive_bubbles_off",
    "cadence",
    "memorySourceBubbles",
    "searchSourceBubbles",
    "runtimeOffBubbleState",
    "idle_presence_memory_safe",
    "idle_presence_search_citation",
    "memory-safe-pulse",
    "search-citation-pulse"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-46 off cadence clears an already visible renderer bubble without action semantics", () => {
  assert.match(mainSource, /function clearPetProactiveSpeechBubble/);
  assert.match(mainSource, /petWindow\.webContents\.send\("pet:clear-proactive-speech-bubble"\)/);
  assert.match(petPreloadSource, /onClearProactiveSpeechBubble/);
  assert.match(petPreloadSource, /ipcRenderer\.on\("pet:clear-proactive-speech-bubble"/);
  assert.match(petRendererSource, /onClearProactiveSpeechBubble\(\(\) =>/);
  assert.match(petRendererSource, /clearProactiveSpeechBubble\(\)/);
});

test("p2-46 runner keeps output to safe summaries and checks cleanup", () => {
  const forbiddenList = extractConstArraySource("forbiddenOutputPatterns");
  for (const token of [
    "safeQuery",
    "snippet",
    "domain",
    "url",
    "title",
    "providerMessages",
    "factCardBody",
    "memoryCardBody",
    "requestBody",
    "Authorization",
    "textContent",
    "bubbleText"
  ]) {
    assert.match(forbiddenList, new RegExp(escapeRegExp(token), "i"));
  }

  assert.match(runnerSource, /delete payload\.eventId/);
  assert.match(runnerSource, /privacyOutputSafe/);
  assert.match(runnerSource, /noScreenshotResidue/);
});

function extractConstArraySource(name: string): string {
  const pattern = new RegExp(`const ${escapeRegExp(name)} = \\[[\\s\\S]*?\\];`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing const array ${name}`);
  return match[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
