import assert from "node:assert/strict";
import test from "node:test";
import {
  PET_LOCK_SHORTCUT,
  createPetLockShortcut
} from "../src/main/services/pet-lock-shortcut.ts";

test("pet lock shortcut registers Tab+0 and toggles through callback", () => {
  let registeredAccelerator: string | undefined;
  let callback: (() => void) | null = null;
  let isLocked = false;

  const shortcut = createPetLockShortcut({
    register(accelerator, nextCallback) {
      registeredAccelerator = accelerator;
      callback = nextCallback;
      return true;
    },
    unregister() {},
    onTriggered() {
      isLocked = !isLocked;
    }
  });

  assert.deepEqual(shortcut.register(), {
    accelerator: PET_LOCK_SHORTCUT,
    registered: true,
    reason: "registered"
  });
  assert.equal(registeredAccelerator, "Tab+0");

  callback?.();
  assert.equal(isLocked, true);
  callback?.();
  assert.equal(isLocked, false);
});

test("pet lock shortcut registration failure is reported without throwing", () => {
  const shortcut = createPetLockShortcut({
    register() {
      return false;
    },
    unregister() {
      throw new Error("unregister must not run for failed registration");
    },
    onTriggered() {
      throw new Error("unregistered shortcut must not trigger");
    }
  });

  assert.deepEqual(shortcut.register(), {
    accelerator: PET_LOCK_SHORTCUT,
    registered: false,
    reason: "unavailable"
  });
  shortcut.unregister();
});

test("pet lock shortcut does not register twice", () => {
  let registerCount = 0;
  let unregisterCount = 0;

  const shortcut = createPetLockShortcut({
    register() {
      registerCount += 1;
      return true;
    },
    unregister() {
      unregisterCount += 1;
    },
    onTriggered() {}
  });

  assert.equal(shortcut.register().reason, "registered");
  assert.equal(shortcut.register().reason, "already_registered");
  assert.equal(registerCount, 1);

  shortcut.unregister();
  assert.equal(unregisterCount, 1);
  assert.equal(shortcut.isRegistered(), false);
});
