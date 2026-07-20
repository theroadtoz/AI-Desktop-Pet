import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createEnvironmentActionSettingsStore
} = require("../dist/main/services/config/environment-action-settings-store.js") as typeof import("../src/main/services/config/environment-action-settings-store");

test("environment action settings store defaults new, missing, partial, and corrupt records to enabled", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-environment-actions-"));
  try {
    const freshStore = createEnvironmentActionSettingsStore({ userDataPath });
    assert.deepEqual(freshStore.getSettings(), { basicEnabled: true, musicEnabled: true, gameEnabled: true });

    await mkdir(dirname(freshStore.getSettingsPath()), { recursive: true });
    await writeFile(freshStore.getSettingsPath(), '{"musicEnabled":false}', "utf8");
    assert.deepEqual(createEnvironmentActionSettingsStore({ userDataPath }).getSettings(), {
      basicEnabled: true,
      musicEnabled: true,
      gameEnabled: true
    });

    await writeFile(freshStore.getSettingsPath(), JSON.stringify({
      version: 3,
      musicEnabled: false,
      gameEnabled: false,
      userSelected: { basicEnabled: true, musicEnabled: true, gameEnabled: true }
    }), "utf8");
    assert.deepEqual(createEnvironmentActionSettingsStore({ userDataPath }).getSettings(), {
      basicEnabled: true,
      musicEnabled: true,
      gameEnabled: true
    });

    await writeFile(freshStore.getSettingsPath(), "not-json", "utf8");
    assert.deepEqual(createEnvironmentActionSettingsStore({ userDataPath }).getSettings(), {
      basicEnabled: true,
      musicEnabled: true,
      gameEnabled: true
    });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("environment action settings store retains explicit opt-out and persists its proof", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-environment-actions-"));
  try {
    const store = createEnvironmentActionSettingsStore({ userDataPath });
    assert.deepEqual(store.saveSettings({ basicEnabled: false, musicEnabled: false, processName: "must-not-persist" }), {
      basicEnabled: false,
      musicEnabled: false,
      gameEnabled: true
    });
    assert.deepEqual(JSON.parse(await readFile(store.getSettingsPath(), "utf8")), {
      version: 3,
      basicEnabled: false,
      musicEnabled: false,
      gameEnabled: true,
      userSelected: { basicEnabled: true, musicEnabled: true, gameEnabled: false }
    });
    assert.deepEqual(createEnvironmentActionSettingsStore({ userDataPath }).getSettings(), {
      basicEnabled: false,
      musicEnabled: false,
      gameEnabled: true
    });

    assert.equal(store.getEveningDateKey(), null);
    store.saveEveningDateKey("2026-07-19");
    assert.equal(store.getEveningDateKey(), "2026-07-19");
    assert.deepEqual(JSON.parse(await readFile(store.getRuntimeStatePath(), "utf8")), {
      lastEveningDateKey: "2026-07-19"
    });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("environment action settings store migrates v2 explicit media and game selections", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-environment-actions-"));
  try {
    const store = createEnvironmentActionSettingsStore({ userDataPath });
    await mkdir(dirname(store.getSettingsPath()), { recursive: true });
    await writeFile(store.getSettingsPath(), JSON.stringify({
      version: 2,
      musicEnabled: false,
      gameEnabled: true,
      userSelected: { musicEnabled: true, gameEnabled: false }
    }), "utf8");
    const migratedStore = createEnvironmentActionSettingsStore({ userDataPath });
    assert.deepEqual(migratedStore.getSettings(), {
      basicEnabled: true,
      musicEnabled: false,
      gameEnabled: true
    });
    migratedStore.saveSettings({ basicEnabled: false });
    assert.deepEqual(JSON.parse(await readFile(store.getSettingsPath(), "utf8")), {
      version: 3,
      basicEnabled: false,
      musicEnabled: false,
      gameEnabled: true,
      userSelected: { basicEnabled: true, musicEnabled: true, gameEnabled: false }
    });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("environment action settings store preserves complete unversioned legacy opt-out", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-environment-actions-"));
  try {
    const store = createEnvironmentActionSettingsStore({ userDataPath });
    await mkdir(dirname(store.getSettingsPath()), { recursive: true });
    await writeFile(store.getSettingsPath(), '{"musicEnabled":false,"gameEnabled":false}', "utf8");
    const migratedStore = createEnvironmentActionSettingsStore({ userDataPath });
    assert.deepEqual(migratedStore.getSettings(), {
      basicEnabled: false,
      musicEnabled: false,
      gameEnabled: false
    });
    migratedStore.saveSettings({});
    assert.deepEqual(JSON.parse(await readFile(store.getSettingsPath(), "utf8")), {
      version: 3,
      basicEnabled: false,
      musicEnabled: false,
      gameEnabled: false,
      userSelected: { basicEnabled: true, musicEnabled: true, gameEnabled: true }
    });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("saving the other switch preserves a future-version explicit opt-out after reload", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-environment-actions-"));
  try {
    const initialStore = createEnvironmentActionSettingsStore({ userDataPath });
    await mkdir(dirname(initialStore.getSettingsPath()), { recursive: true });
    await writeFile(initialStore.getSettingsPath(), JSON.stringify({
      version: 999,
      basicEnabled: true,
      musicEnabled: false,
      gameEnabled: true,
      userSelected: { basicEnabled: false, musicEnabled: true, gameEnabled: false }
    }), "utf8");
    const migratedStore = createEnvironmentActionSettingsStore({ userDataPath });
    migratedStore.saveSettings({ gameEnabled: false });
    assert.deepEqual(createEnvironmentActionSettingsStore({ userDataPath }).getSettings(), {
      basicEnabled: true,
      musicEnabled: false,
      gameEnabled: false
    });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
