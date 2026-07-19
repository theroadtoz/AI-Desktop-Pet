import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createEnvironmentActionSettingsStore
} = require("../dist/main/services/config/environment-action-settings-store.js") as typeof import("../src/main/services/config/environment-action-settings-store");

test("environment action settings store persists only normalized closed settings", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-environment-actions-"));
  try {
    const store = createEnvironmentActionSettingsStore({ userDataPath });
    assert.deepEqual(store.getSettings(), { musicEnabled: false, gameEnabled: false });
    assert.deepEqual(store.saveSettings({ musicEnabled: true, processName: "must-not-persist" }), {
      musicEnabled: true,
      gameEnabled: false
    });
    assert.deepEqual(JSON.parse(await readFile(store.getSettingsPath(), "utf8")), {
      musicEnabled: true,
      gameEnabled: false
    });

    assert.equal(store.getEveningDateKey(), null);
    store.saveEveningDateKey("2026-07-19");
    assert.equal(store.getEveningDateKey(), "2026-07-19");
    assert.deepEqual(JSON.parse(await readFile(store.getRuntimeStatePath(), "utf8")), {
      lastEveningDateKey: "2026-07-19"
    });
    assert.equal(
      createEnvironmentActionSettingsStore({ userDataPath }).getEveningDateKey(),
      "2026-07-19"
    );

    await mkdir(dirname(store.getSettingsPath()), { recursive: true });
    await writeFile(store.getSettingsPath(), "not-json", "utf8");
    assert.deepEqual(createEnvironmentActionSettingsStore({ userDataPath }).getSettings(), {
      musicEnabled: false,
      gameEnabled: false
    });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
