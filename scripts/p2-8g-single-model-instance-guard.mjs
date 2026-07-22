import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
const secondInstanceSource = appSource.slice(
  appSource.indexOf('app.on("second-instance", () => {'),
  appSource.indexOf('app.on("child-process-gone"', appSource.indexOf('app.on("second-instance", () => {'))
);

function assertSourceIncludes(pattern, description) {
  assert.match(appSource, pattern, description);
}

function assertSecondInstanceIncludes(pattern, description) {
  assert.match(secondInstanceSource, pattern, description);
}

assertSourceIncludes(/function ensurePetWindow\(reason: string\): BrowserWindow \{/, "ensurePetWindow exists in the main process");
assertSourceIncludes(/function showExistingPetWindow\(reason: string\): BrowserWindow \| null \{/, "showExistingPetWindow exists in the main process");
assertSecondInstanceIncludes(/ensurePetWindow\("second_instance"\)/, "second-instance reuses the pet guard");
assertSecondInstanceIncludes(/if \(openChatWindowAdapter\) \{[\s\S]*openChatWindowAdapter\(\);/, "second-instance uses the shared chat adapter when available");
assertSecondInstanceIncludes(/else \{\s*pendingChatWindowOpen = true;/, "unbound second-instance caches one chat open for adapter binding");
assertSourceIncludes(/let openChatWindowAdapter: \(\(\) => void\) \| null = null;/, "main process keeps a narrow chat adapter reference");
assertSourceIncludes(/let pendingChatWindowOpen = false;/, "main process keeps a one-shot pending chat-open flag");
assertSourceIncludes(/openChatWindowAdapter = openChatWindow;/, "bootstrap binds the shared chat adapter");
assertSourceIncludes(/openChatWindowAdapter = openChatWindow;\s*if \(pendingChatWindowOpen\) \{\s*pendingChatWindowOpen = false;\s*openChatWindowAdapter\(\);/, "adapter binding consumes the pending chat-open once");
assertSourceIncludes(/function quiesceApp\(\): void \{[\s\S]*openChatWindowAdapter = null;\s*pendingChatWindowOpen = false;/, "quiesce clears chat-open adapter state");
assert.doesNotMatch(secondInstanceSource, /showChatWindow\(chatWindow\);\s*focusChatInput\(chatWindow\);/, "second-instance no longer directly shows and focuses chat");
assertSourceIncludes(/app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*ensurePetWindow\("startup"\)/, "startup uses the pet guard");
assertSourceIncludes(/app\.on\("activate", \(\) => \{[\s\S]*ensurePetWindow\("activate"\)/, "activate uses the pet guard");
assertSourceIncludes(/render-process-gone[\s\S]*rebuildPetWindow\("renderer_process_gone"\)/, "renderer crash recovery uses rebuildPetWindow");
assertSourceIncludes(/pointerController\?\.dispose\(\);[\s\S]*petWindow\.destroy\(\);[\s\S]*petWindow = createRecoverablePetWindow\(\);/, "rebuild disposes the pointer controller and destroys the old pet window before replacement");
assertSourceIncludes(/pet_window_duplicate_prevented/, "duplicate prevention telemetry is emitted");
assertSourceIncludes(/pet_window_rebuilt/, "rebuild telemetry is emitted");

const directCreateCalls = [...appSource.matchAll(/\bcreatePetWindow\(\)/g)].length;
assert.equal(directCreateCalls, 1, "createPetWindow is only called by createRecoverablePetWindow");

const directCreateRecoverableCalls = [...appSource.matchAll(/\bcreateRecoverablePetWindow\(\)/g)].length;
assert.equal(directCreateRecoverableCalls, 3, "createRecoverablePetWindow only appears in its declaration, ensurePetWindow, and rebuildPetWindow");

function createPendingChatOpenHarness() {
  let adapter = null;
  let chatWindow = null;
  let pendingChatWindowOpen = false;
  let openCount = 0;

  function secondInstance() {
    if (adapter) {
      adapter();
    } else {
      pendingChatWindowOpen = true;
    }
  }

  function bindAdapter() {
    adapter = () => {
      openCount += 1;
      chatWindow = { destroyed: false };
    };
    if (pendingChatWindowOpen) {
      pendingChatWindowOpen = false;
      adapter();
    }
  }

  function setChatWindow() {
    chatWindow = { destroyed: false };
  }

  function quiesce() {
    adapter = null;
    pendingChatWindowOpen = false;
  }

  return {
    secondInstance,
    bindAdapter,
    setChatWindow,
    quiesce,
    get openCount() {
      return openCount;
    },
    get pendingChatWindowOpen() {
      return pendingChatWindowOpen;
    }
  };
}

const earlySecondInstance = createPendingChatOpenHarness();
earlySecondInstance.secondInstance();
earlySecondInstance.secondInstance();
assert.equal(earlySecondInstance.pendingChatWindowOpen, true, "early launches keep one pending open");
earlySecondInstance.bindAdapter();
assert.equal(earlySecondInstance.openCount, 1, "adapter binding consumes the early launch exactly once");
earlySecondInstance.secondInstance();
assert.equal(earlySecondInstance.openCount, 2, "later launches use the bound adapter");

const quiescedSecondInstance = createPendingChatOpenHarness();
quiescedSecondInstance.secondInstance();
quiescedSecondInstance.quiesce();
quiescedSecondInstance.bindAdapter();
assert.equal(quiescedSecondInstance.openCount, 0, "quiesce discards an unconsumed pending open");

const existingChatBeforeBinding = createPendingChatOpenHarness();
existingChatBeforeBinding.setChatWindow();
existingChatBeforeBinding.secondInstance();
existingChatBeforeBinding.bindAdapter();
assert.equal(existingChatBeforeBinding.openCount, 1, "an existing chat window still consumes the standard pending open after adapter binding");

class FakePetWindow {
  constructor(id) {
    this.id = id;
    this.destroyed = false;
    this.restored = false;
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
  }
}

function createFakeGuard() {
  let petWindow = null;
  let pointerDisposals = 0;
  let createCount = 0;
  const events = [];

  function log(type, payload = {}) {
    events.push({ type, payload });
  }

  function restore(window) {
    window.restored = true;
  }

  function createRecoverablePetWindow() {
    createCount += 1;
    return new FakePetWindow(createCount);
  }

  function disposePointer() {
    pointerDisposals += 1;
  }

  function showExistingPetWindow(reason) {
    if (!petWindow || petWindow.isDestroyed()) {
      return null;
    }

    restore(petWindow);
    log("pet_window_duplicate_prevented", { reason });
    log("pet_window_reuse", { reason });
    return petWindow;
  }

  function ensurePetWindow(reason) {
    const existingPetWindow = showExistingPetWindow(reason);

    if (existingPetWindow) {
      return existingPetWindow;
    }

    petWindow = createRecoverablePetWindow();
    log("pet_window_created", { reason });
    return petWindow;
  }

  function rebuildPetWindow(reason) {
    const oldWindow = petWindow;
    disposePointer();

    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.destroy();
    }

    petWindow = createRecoverablePetWindow();
    log("pet_window_rebuilt", { reason });
    return { oldWindow, nextWindow: petWindow };
  }

  return {
    ensurePetWindow,
    rebuildPetWindow,
    get createCount() {
      return createCount;
    },
    get pointerDisposals() {
      return pointerDisposals;
    },
    get events() {
      return events;
    }
  };
}

const guard = createFakeGuard();
const firstWindow = guard.ensurePetWindow("startup");

for (let index = 0; index < 10; index += 1) {
  assert.equal(guard.ensurePetWindow(`repeat_${index}`), firstWindow);
}

assert.equal(guard.createCount, 1, "multiple ensure calls keep one pet window");
assert.equal(firstWindow.restored, true, "reused pet window is restored");
assert.equal(
  guard.events.filter((event) => event.type === "pet_window_duplicate_prevented").length,
  10,
  "each repeated ensure records duplicate prevention"
);

const recovery = guard.rebuildPetWindow("renderer_process_gone");
assert.equal(recovery.oldWindow.isDestroyed(), true, "rebuild destroys the old pet window");
assert.notEqual(recovery.nextWindow, recovery.oldWindow, "rebuild creates a replacement pet window");
assert.equal(guard.createCount, 2, "rebuild creates exactly one replacement");
assert.equal(guard.pointerDisposals, 1, "rebuild releases the previous pointer controller");

console.log(JSON.stringify({
  result: "passed",
  checks: {
    sourceGuardEntrypoints: "passed",
    pendingChatOpenTiming: "passed",
    repeatedEnsureCreatesOneWindow: "passed",
    rendererRecoveryReplacesWindow: "passed"
  }
}, null, 2));
