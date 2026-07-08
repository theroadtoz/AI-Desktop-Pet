import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PROACTIVE_COMPANION_SETTINGS
} = require("../dist/shared/proactive-companion-settings.js") as typeof import("../src/shared/proactive-companion-settings");
const {
  createProactiveCompanionSettingsStore
} = require("../dist/main/services/config/proactive-companion-settings-store.js") as typeof import("../src/main/services/config/proactive-companion-settings-store");

test("proactive companion settings store falls back to defaults for missing or corrupted config", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-proactive-companion-settings-"));

  try {
    const store = createProactiveCompanionSettingsStore({ userDataPath });
    const settingsPath = join(userDataPath, "config", "proactive-companion-settings.json");

    assert.deepEqual(store.getSettings(), DEFAULT_PROACTIVE_COMPANION_SETTINGS);
    assert.equal(store.getSettingsPath(), settingsPath);

    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, "not-json", "utf8");
    assert.deepEqual(
      createProactiveCompanionSettingsStore({ userDataPath }).getSettings(),
      DEFAULT_PROACTIVE_COMPANION_SETTINGS
    );

    await writeFile(settingsPath, JSON.stringify({
      cadence: "unknown",
      memorySourceBubbles: "false",
      searchSourceBubbles: null
    }), "utf8");
    assert.deepEqual(
      createProactiveCompanionSettingsStore({ userDataPath }).getSettings(),
      DEFAULT_PROACTIVE_COMPANION_SETTINGS
    );
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("proactive companion settings store persists normalized settings", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-proactive-companion-settings-"));

  try {
    const store = createProactiveCompanionSettingsStore({ userDataPath });
    const savedSettings = store.saveSettings({
      cadence: "quiet",
      memorySourceBubbles: false,
      searchSourceBubbles: false
    });

    assert.deepEqual(savedSettings, {
      cadence: "quiet",
      memorySourceBubbles: false,
      searchSourceBubbles: false
    });
    assert.deepEqual(
      createProactiveCompanionSettingsStore({ userDataPath }).getSettings(),
      savedSettings
    );
    assert.deepEqual(JSON.parse(await readFile(store.getSettingsPath(), "utf8")), savedSettings);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("proactive companion settings store ignores invalid update fields and keeps safe current values", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-proactive-companion-settings-"));

  try {
    const store = createProactiveCompanionSettingsStore({ userDataPath });

    const quietSettings = {
      cadence: "quiet",
      memorySourceBubbles: false,
      searchSourceBubbles: false
    } as const;

    assert.deepEqual(store.saveSettings({
      cadence: "quiet",
      memorySourceBubbles: false,
      searchSourceBubbles: false
    }), quietSettings);

    assert.deepEqual(store.saveSettings({
      cadence: "自由 prompt",
      memorySourceBubbles: "false",
      searchSourceBubbles: 0
    }), quietSettings);
    assert.deepEqual(
      createProactiveCompanionSettingsStore({ userDataPath }).getSettings(),
      quietSettings
    );
    assert.deepEqual(store.saveSettings(null), quietSettings);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
