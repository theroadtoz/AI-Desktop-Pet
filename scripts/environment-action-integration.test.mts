import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("environment action IPC stays closed while visible UI has no writable environment toggles", async () => {
  const [appSource, preloadSource, html, settingsSource] = await Promise.all([
    readFile("src/main/app.ts", "utf8"),
    readFile("src/preload/chat-preload.ts", "utf8"),
    readFile("src/renderer/chat/index.html", "utf8"),
    readFile("src/shared/environment-action-settings.ts", "utf8")
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
  assert.doesNotMatch(html, /id="environment-action-settings-title"/);
  const hiddenLegacyStart = html.indexOf('<div hidden aria-hidden="true">');
  assert.ok(hiddenLegacyStart >= 0);
  for (const id of [
    "environment-basic-enabled",
    "environment-music-enabled",
    "environment-explicit-game-context-enabled"
  ]) {
    const index = html.indexOf(`id="${id}"`);
    assert.ok(index > hiddenLegacyStart, `${id} must remain outside visible settings UI`);
    assert.equal(html.indexOf(`id="${id}"`, index + 1), -1, `${id} must not have a visible duplicate`);
  }
  assert.match(
    settingsSource,
    /DEFAULT_ENVIRONMENT_ACTION_SETTINGS[\s\S]*basicEnabled: true,[\s\S]*musicEnabled: true,[\s\S]*explicitGameContextEnabled: true/
  );
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
