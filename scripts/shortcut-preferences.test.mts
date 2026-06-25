import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createShortcutPreferencesStore } = require("../dist/main/services/config/shortcut-preferences-store.js") as typeof import("../src/main/services/config/shortcut-preferences-store");
const { createShortcutRegistry } = require("../dist/main/services/shortcut-registry.js") as typeof import("../src/main/services/shortcut-registry");
const {
  DEFAULT_SHORTCUT_PREFERENCES,
  DEFAULT_TOGGLE_PET_LOCK_ACCELERATOR,
  TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID,
  updateShortcutPreference,
  validateShortcutAccelerator
} = require("../dist/shared/shortcut-preferences.js") as typeof import("../src/shared/shortcut-preferences");

test("shortcut preferences keep Tab+0 as the default lock accelerator", () => {
  assert.deepEqual(DEFAULT_SHORTCUT_PREFERENCES, {
    shortcuts: [{
      actionId: TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID,
      accelerator: DEFAULT_TOGGLE_PET_LOCK_ACCELERATOR
    }]
  });
});

test("shortcut validation rejects unknown actions, bare keys, duplicates and diagnostic conflicts", () => {
  assert.deepEqual(updateShortcutPreference(DEFAULT_SHORTCUT_PREFERENCES, "missing", "Ctrl+Shift+0"), {
    ok: false,
    reason: "未知快捷键动作。"
  });
  assert.deepEqual(validateShortcutAccelerator("L"), {
    ok: false,
    reason: "不能使用容易截获普通输入的单键快捷键。"
  });
  assert.deepEqual(validateShortcutAccelerator("Ctrl+Alt+Shift+L"), {
    ok: false,
    reason: "不能占用开发诊断快捷键。"
  });
  assert.deepEqual(validateShortcutAccelerator("Tab+0"), {
    ok: true,
    accelerator: "Tab+0"
  });
});

test("shortcut store falls back to defaults when the config file is damaged", () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "shortcut-store-"));

  try {
    const store = createShortcutPreferencesStore({ userDataPath });
    mkdirSync(join(userDataPath, "config"), { recursive: true });
    writeFileSync(store.getPreferencesPath(), "{ damaged", "utf8");
    assert.deepEqual(store.getPreferences(), DEFAULT_SHORTCUT_PREFERENCES);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("shortcut registry updates, persists and triggers only known handlers", () => {
  const callbacks = new Map<string, () => void>();
  const saved: unknown[] = [];
  let toggleCount = 0;
  const registry = createShortcutRegistry({
    initialPreferences: DEFAULT_SHORTCUT_PREFERENCES,
    register(accelerator, callback) {
      callbacks.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) {
      callbacks.delete(accelerator);
    },
    isRegistered(accelerator) {
      return callbacks.has(accelerator);
    },
    savePreferences(preferences) {
      saved.push(preferences);
      return preferences;
    },
    handlers: {
      togglePetLock() {
        toggleCount += 1;
      }
    }
  });

  assert.equal(registry.registerAll()[0].accelerator, "Tab+0");
  callbacks.get("Tab+0")?.();
  assert.equal(toggleCount, 1);

  const result = registry.updateShortcut("togglePetLock", "Ctrl+Shift+0");
  assert.equal(result.ok, true);
  assert.equal(callbacks.has("Tab+0"), false);
  assert.equal(callbacks.has("Ctrl+Shift+0"), true);
  assert.equal(saved.length, 1);
});

test("shortcut registry keeps the old accelerator when registration fails", () => {
  const callbacks = new Map<string, () => void>();
  const registry = createShortcutRegistry({
    initialPreferences: DEFAULT_SHORTCUT_PREFERENCES,
    register(accelerator, callback) {
      if (accelerator === "Ctrl+Shift+0") {
        return false;
      }

      callbacks.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) {
      callbacks.delete(accelerator);
    },
    isRegistered(accelerator) {
      return callbacks.has(accelerator);
    },
    savePreferences(preferences) {
      return preferences;
    },
    handlers: {
      togglePetLock() {}
    }
  });

  registry.registerAll();
  const result = registry.updateShortcut("togglePetLock", "Ctrl+Shift+0");
  assert.equal(result.ok, false);
  assert.equal(callbacks.has("Tab+0"), true);
  assert.equal(callbacks.has("Ctrl+Shift+0"), false);
  assert.equal(registry.getShortcutViews()[0]?.accelerator, "Tab+0");
});
