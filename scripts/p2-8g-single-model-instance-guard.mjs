import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");

function assertSourceIncludes(pattern, description) {
  assert.match(appSource, pattern, description);
}

assertSourceIncludes(/function ensurePetWindow\(reason: string\): BrowserWindow \{/, "ensurePetWindow exists in the main process");
assertSourceIncludes(/function showExistingPetWindow\(reason: string\): BrowserWindow \| null \{/, "showExistingPetWindow exists in the main process");
assertSourceIncludes(/app\.on\("second-instance", \(\) => \{[\s\S]*ensurePetWindow\("second_instance"\)/, "second-instance reuses the pet guard");
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
    repeatedEnsureCreatesOneWindow: "passed",
    rendererRecoveryReplacesWindow: "passed"
  }
}, null, 2));
