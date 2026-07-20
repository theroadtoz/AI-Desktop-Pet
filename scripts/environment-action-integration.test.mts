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
  for (const [eventName, handlerName] of [
    ["lock-screen", "handleSystemLock"],
    ["unlock-screen", "handleSystemUnlock"],
    ["suspend", "handleSystemSuspend"],
    ["resume", "handleSystemResume"]
  ]) {
    assert.match(appSource, new RegExp(`powerMonitor\\.on\\("${eventName}", ${handlerName}\\)`));
    assert.match(appSource, new RegExp(`powerMonitor\\.removeListener\\("${eventName}", ${handlerName}\\)`));
  }
  assert.match(appSource, /getSystemIdleTime\(\)[\s\S]*powerMonitor\.getSystemIdleTime\(\)/);
  assert.doesNotMatch(appSource, /onStableGamePresence/);
  assert.doesNotMatch(appSource, /currentEnvironmentActionSettings\.gameEnabled\)[\s\S]{0,120}updateStableGamePresence/);
  assert.match(preloadSource, /environmentActionApi/);
  assert.match(preloadSource, /defaultEnvironmentActionSettings/);
  assert.match(preloadSource, /environmentActions:get-status/);
  assert.match(preloadSource, /hasExactKeys\(status, \["providerStatus", "monitorStatus", "mediaCapability", "gameCapability"\]\)/);
  assert.doesNotMatch(preloadSource, /mediaPlaying|gamePresence/);
  assert.match(html, /id="settings-basic-page"[\s\S]*id="environment-action-settings-title"/);
  assert.match(html, /id="environment-basic-enabled"/);
  assert.match(html, /id="environment-music-enabled"/);
  assert.match(html, /id="environment-game-enabled"/);
  assert.match(html, /默认启用/);
  assert.match(html, /游戏环境感知当前不可用，也不会扫描正在运行的游戏/);
  assert.doesNotMatch(html, /感知正在运行的游戏/);
});
