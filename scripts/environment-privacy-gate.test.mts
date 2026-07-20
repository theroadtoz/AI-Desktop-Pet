import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("raw environment snapshot remains main-only and outside public contracts", () => {
  const app = readFileSync("src/main/app.ts", "utf8");
  const preload = readFileSync("src/preload/chat-preload.ts", "utf8");
  const renderer = readFileSync("src/renderer/chat/main.ts", "utf8");
  const ipcContract = readFileSync("src/shared/ipc-contract.ts", "utf8");
  const provider = readFileSync(
    "src/main/services/desktop-context/windows-desktop-context-provider.ts",
    "utf8"
  );

  for (const source of [preload, renderer, ipcContract]) {
    assert.doesNotMatch(source, /CompanionEnvironmentSnapshot|companion-environment/);
    assert.doesNotMatch(source, /idleSeconds|interruptibility|full-screen-activity/);
  }
  assert.match(app, /coarseUserStateCoordinator\.updateEnvironment\(desktopContextMonitor\.getSnapshot\(\)\)/);
  assert.doesNotMatch(app, /updateStableGamePresence\(/);
  assert.doesNotMatch(provider, /Get-Process|Win32_Process|GetForegroundWindow|MainWindowTitle/);
  assert.doesNotMatch(provider, /TryGetMediaProperties|SourceAppUserModelId|TimelineProperties/);
});

test("public environment status is a strict health and capability envelope", () => {
  const preload = readFileSync("src/preload/chat-preload.ts", "utf8");
  assert.match(
    preload,
    /hasExactKeys\(status, \["providerStatus", "monitorStatus", "mediaCapability", "gameCapability"\]\)/
  );
  assert.doesNotMatch(preload, /mediaPlaying|gamePresence|updatedAtMs|stableSinceMs|changedAtMs/);
});

test("coarse state stays main-only and cannot select actions, model input, telemetry, or bubbles", () => {
  const coarse = readFileSync(
    "src/main/services/automatic-situation/coarse-user-state-coordinator.ts",
    "utf8"
  );
  const publicSources = [
    readFileSync("src/preload/chat-preload.ts", "utf8"),
    readFileSync("src/renderer/chat/main.ts", "utf8"),
    readFileSync("src/shared/ipc-contract.ts", "utf8")
  ];
  for (const source of publicSources) {
    assert.doesNotMatch(source, /CoarseUserState|coarse-user-state-coordinator/);
  }
  assert.doesNotMatch(coarse, /pet-action|Motion3|telemetry|speech-bubble|chat-provider|MCP|renderer/iu);
  assert.doesNotMatch(coarse, /snapshot\.game|\.source|\.capability|\.confidence|updatedAtMs|changedAtMs|stableSinceMs/);
});
