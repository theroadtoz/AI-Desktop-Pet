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
  assert.match(appSource, /coarseUserStateCoordinator\?\.handleUserMessage\(submittedMessage\.content\)/);
  assert.match(appSource, /setExplicitGameContextEnabled/);
  assert.doesNotMatch(appSource, /updateStableGamePresence|stable-game-signal/);
  assert.match(preloadSource, /environmentActionApi/);
  assert.match(preloadSource, /defaultEnvironmentActionSettings/);
  assert.match(preloadSource, /environmentActions:get-status/);
  assert.match(preloadSource, /hasExactKeys\(status, \["providerStatus", "monitorStatus", "mediaCapability", "gameCapability"\]\)/);
  assert.doesNotMatch(preloadSource, /mediaPlaying|gamePresence/);
  assert.match(html, /id="settings-basic-page"[\s\S]*id="environment-action-settings-title"/);
  assert.match(html, /id="environment-basic-enabled"/);
  assert.match(html, /id="environment-music-enabled"/);
  assert.match(html, /id="environment-explicit-game-context-enabled"/);
  assert.match(html, /使用我明确提到的游戏情境/);
  assert.match(html, /不会检测或扫描系统中的游戏、窗口、进程或路径/);
  assert.doesNotMatch(html, /感知正在运行的游戏/);
  assert.doesNotMatch(html, /游戏环境感知偏好|游戏扫描/);

  const subscribeIndex = appSource.indexOf("desktopContextMonitor.subscribe");
  const initialSnapshotIndex = appSource.indexOf("desktopContextMonitor.getSnapshot()", subscribeIndex);
  const monitorStartIndex = appSource.indexOf("desktopContextMonitor.updateSettings", initialSnapshotIndex);
  assert.ok(subscribeIndex >= 0 && subscribeIndex < initialSnapshotIndex);
  assert.ok(initialSnapshotIndex < monitorStartIndex);

  const shutdownIndex = appSource.indexOf("function quiesceApp");
  const unsubscribeIndex = appSource.indexOf("removeDesktopContextSnapshotListener?.()", shutdownIndex);
  const coarseDisposeIndex = appSource.indexOf("coarseUserStateCoordinator?.dispose()", shutdownIndex);
  const automaticDisposeIndex = appSource.indexOf("automaticSituationCoordinator?.dispose()", shutdownIndex);
  const monitorDisposeIndex = appSource.indexOf("desktopContextMonitor.dispose()", shutdownIndex);
  assert.ok(unsubscribeIndex < coarseDisposeIndex);
  assert.ok(coarseDisposeIndex < automaticDisposeIndex);
  assert.ok(automaticDisposeIndex < monitorDisposeIndex);
});
