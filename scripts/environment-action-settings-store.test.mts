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

const alwaysEnabled = {
  basicEnabled: true,
  musicEnabled: true,
  explicitGameContextEnabled: true
};

test("environment settings store normalizes old opt-outs and ignores later disable requests", async () => {
  await withStore(async (userDataPath) => {
    const store = createEnvironmentActionSettingsStore({ userDataPath });
    await mkdir(dirname(store.getSettingsPath()), { recursive: true });
    await writeFile(store.getSettingsPath(), JSON.stringify({
      version: 3,
      basicEnabled: false,
      musicEnabled: false,
      gameEnabled: false,
      userSelected: { basicEnabled: true, musicEnabled: true, gameEnabled: true }
    }), "utf8");

    const migrated = createEnvironmentActionSettingsStore({ userDataPath });
    assert.deepEqual(migrated.getSettings(), alwaysEnabled);
    assert.deepEqual(migrated.saveSettings({
      basicEnabled: false,
      musicEnabled: false,
      explicitGameContextEnabled: false
    }), alwaysEnabled);
    assert.deepEqual(JSON.parse(await readFile(store.getSettingsPath(), "utf8")), {
      version: 4,
      ...alwaysEnabled,
      userSelected: {
        basicEnabled: false,
        musicEnabled: false,
        explicitGameContextEnabled: false
      }
    });
    assert.deepEqual(createEnvironmentActionSettingsStore({ userDataPath }).getSettings(), alwaysEnabled);
  });
});

test("environment runtime evening date remains separate from settings", async () => {
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
