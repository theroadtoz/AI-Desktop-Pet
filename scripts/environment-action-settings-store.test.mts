import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createEnvironmentActionSettingsStore } = require(
  "../dist/main/services/config/environment-action-settings-store.js"
) as typeof import("../src/main/services/config/environment-action-settings-store");

test("environment settings store defaults fresh, partial, and corrupt records to v4 enabled values", async () => {
  await withStore(async (userDataPath) => {
    const store = createEnvironmentActionSettingsStore({ userDataPath });
    const defaults = { basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: true };
    assert.deepEqual(store.getSettings(), defaults);
    await mkdir(dirname(store.getSettingsPath()), { recursive: true });
    await writeFile(store.getSettingsPath(), '{"musicEnabled":false}', "utf8");
    assert.deepEqual(createEnvironmentActionSettingsStore({ userDataPath }).getSettings(), defaults);
    await writeFile(store.getSettingsPath(), "not-json", "utf8");
    assert.deepEqual(createEnvironmentActionSettingsStore({ userDataPath }).getSettings(), defaults);
  });
});

test("v3 migration is lazy and the next save writes v4 without gameEnabled or unknown keys", async () => {
  await withStore(async (userDataPath) => {
    const store = createEnvironmentActionSettingsStore({ userDataPath });
    await mkdir(dirname(store.getSettingsPath()), { recursive: true });
    const v3 = {
      version: 3,
      basicEnabled: true,
      musicEnabled: false,
      gameEnabled: false,
      userSelected: { basicEnabled: false, musicEnabled: true, gameEnabled: true }
    };
    await writeFile(store.getSettingsPath(), JSON.stringify(v3), "utf8");
    const migrated = createEnvironmentActionSettingsStore({ userDataPath });
    assert.deepEqual(migrated.getSettings(), {
      basicEnabled: true,
      musicEnabled: false,
      explicitGameContextEnabled: false
    });
    assert.deepEqual(JSON.parse(await readFile(store.getSettingsPath(), "utf8")), v3);

    assert.deepEqual(migrated.saveSettings({ basicEnabled: false, processName: "must-not-persist" }), {
      basicEnabled: false,
      musicEnabled: false,
      explicitGameContextEnabled: false
    });
    const written = JSON.parse(await readFile(store.getSettingsPath(), "utf8")) as Record<string, unknown>;
    assert.deepEqual(written, {
      version: 4,
      basicEnabled: false,
      musicEnabled: false,
      explicitGameContextEnabled: false,
      userSelected: { basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: true }
    });
    assert.equal("gameEnabled" in written, false);
    assert.equal("processName" in written, false);
  });
});

test("v2 and legacy selections survive restart and old update keys have no authority", async () => {
  await withStore(async (userDataPath) => {
    const store = createEnvironmentActionSettingsStore({ userDataPath });
    await mkdir(dirname(store.getSettingsPath()), { recursive: true });
    await writeFile(store.getSettingsPath(), JSON.stringify({
      version: 2,
      musicEnabled: false,
      gameEnabled: true,
      userSelected: { musicEnabled: true, gameEnabled: false }
    }), "utf8");
    const migrated = createEnvironmentActionSettingsStore({ userDataPath });
    assert.deepEqual(migrated.getSettings(), {
      basicEnabled: true,
      musicEnabled: false,
      explicitGameContextEnabled: true
    });
    assert.deepEqual(migrated.saveSettings({ gameEnabled: false } as unknown), {
      basicEnabled: true,
      musicEnabled: false,
      explicitGameContextEnabled: true
    });
    assert.deepEqual(createEnvironmentActionSettingsStore({ userDataPath }).getSettings(), {
      basicEnabled: true,
      musicEnabled: false,
      explicitGameContextEnabled: true
    });

    await writeFile(store.getSettingsPath(), '{"musicEnabled":false,"gameEnabled":false}', "utf8");
    assert.deepEqual(createEnvironmentActionSettingsStore({ userDataPath }).getSettings(), {
      basicEnabled: false,
      musicEnabled: false,
      explicitGameContextEnabled: false
    });
  });
});

test("environment runtime evening date remains separate from v4 settings", async () => {
  await withStore(async (userDataPath) => {
    const store = createEnvironmentActionSettingsStore({ userDataPath });
    assert.equal(store.getEveningDateKey(), null);
    store.saveEveningDateKey("2026-07-20");
    assert.equal(store.getEveningDateKey(), "2026-07-20");
    assert.deepEqual(JSON.parse(await readFile(store.getRuntimeStatePath(), "utf8")), {
      lastEveningDateKey: "2026-07-20"
    });
  });
});

async function withStore(run: (userDataPath: string) => Promise<void>): Promise<void> {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-environment-actions-"));
  try {
    await run(userDataPath);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
}
