import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("environment action IPC and basic-page controls use closed settings only", async () => {
  const [appSource, preloadSource, html] = await Promise.all([
    readFile("src/main/app.ts", "utf8"),
    readFile("src/preload/chat-preload.ts", "utf8"),
    readFile("src/renderer/chat/index.html", "utf8")
  ]);
  assert.match(appSource, /environmentActions:get-settings/);
  assert.match(appSource, /environmentActions:get-status/);
  assert.match(appSource, /environmentActions:set-settings/);
  assert.match(appSource, /powerMonitor\.on\("resume", handleSystemResume\)/);
  assert.match(appSource, /desktopContextMonitor\.resetStability\(\)/);
  assert.match(appSource, /powerMonitor\.removeListener\("resume", handleSystemResume\)/);
  assert.match(preloadSource, /environmentActionApi/);
  assert.match(preloadSource, /DEFAULT_ENVIRONMENT_ACTION_SETTINGS/);
  assert.match(preloadSource, /environmentActions:get-status/);
  assert.doesNotMatch(preloadSource, /mediaPlaying|gamePresence/);
  assert.match(html, /id="settings-basic-page"[\s\S]*id="environment-action-settings-title"/);
  assert.match(html, /id="environment-music-enabled"/);
  assert.match(html, /id="environment-game-enabled"/);
});
