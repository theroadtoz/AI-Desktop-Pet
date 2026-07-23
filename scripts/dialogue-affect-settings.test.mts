import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_DIALOGUE_AFFECT_SETTINGS,
  DIALOGUE_AFFECT_SETTINGS_SCHEMA_VERSION,
  createDialogueAffectSettingsRecord,
  normalizeDialogueAffectSettings,
  resolveDialogueAffectSettingsRecord
} = require("../dist/shared/dialogue-affect-settings.js") as typeof import("../src/shared/dialogue-affect-settings");
const { createDialogueAffectSettingsStore } = require(
  "../dist/main/services/config/dialogue-affect-settings-store.js"
) as typeof import("../src/main/services/config/dialogue-affect-settings-store");

test("dialogue affect settings default to enabled and preserve an explicit opt-out", () => {
  assert.equal(DIALOGUE_AFFECT_SETTINGS_SCHEMA_VERSION, 1);
  assert.deepEqual(DEFAULT_DIALOGUE_AFFECT_SETTINGS, { enabled: true });
  assert.deepEqual(normalizeDialogueAffectSettings(null), { enabled: true });
  assert.deepEqual(resolveDialogueAffectSettingsRecord({ version: 1, enabled: false }), { enabled: false });
  assert.deepEqual(createDialogueAffectSettingsRecord({ enabled: false }), {
    version: 1,
    enabled: false
  });
});

test("dialogue affect store rejects malformed records and writes only the versioned opt-out", async () => {
  await withStore(async (userDataPath) => {
    const store = createDialogueAffectSettingsStore({ userDataPath });
    assert.deepEqual(store.getSettings(), { enabled: true });

    await mkdir(dirname(store.getSettingsPath()), { recursive: true });
    await writeFile(store.getSettingsPath(), '{"enabled":false}', "utf8");
    assert.deepEqual(createDialogueAffectSettingsStore({ userDataPath }).getSettings(), { enabled: true });

    await writeFile(store.getSettingsPath(), "not-json", "utf8");
    assert.deepEqual(createDialogueAffectSettingsStore({ userDataPath }).getSettings(), { enabled: true });

    assert.deepEqual(store.saveSettings({ enabled: false, extra: "must-not-persist" }), { enabled: false });
    assert.deepEqual(JSON.parse(await readFile(store.getSettingsPath(), "utf8")), {
      version: 1,
      enabled: false
    });
    assert.deepEqual(await readdir(dirname(store.getSettingsPath())), [
      "dialogue-affect-settings.json"
    ]);
  });
});

test("future dialogue affect schema preserves explicit opt-out and unknown fields when updated", async () => {
  await withStore(async (userDataPath) => {
    const settingsPath = join(userDataPath, "config", "dialogue-affect-settings.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, JSON.stringify({
      version: 2,
      enabled: false,
      futurePolicy: "preserve-me"
    }), "utf8");

    const store = createDialogueAffectSettingsStore({ userDataPath });
    assert.deepEqual(store.getSettings(), { enabled: false });
    assert.deepEqual(store.saveSettings({ enabled: true }), { enabled: true });
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
      version: 2,
      enabled: true,
      futurePolicy: "preserve-me"
    });
  });
});

test("failed dialogue affect writes keep the previous in-memory setting and clean temporary files", async () => {
  await withStore(async (userDataPath) => {
    const store = createDialogueAffectSettingsStore({ userDataPath });
    await mkdir(store.getSettingsPath(), { recursive: true });

    assert.throws(() => store.saveSettings({ enabled: false }));
    assert.deepEqual(store.getSettings(), { enabled: true });
    assert.deepEqual(await readdir(dirname(store.getSettingsPath())), [
      "dialogue-affect-settings.json"
    ]);
  });
});

test("dialogue affect preload exposes only the enabled setting update", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");
  const invocations: unknown[][] = [];
  let dialogueAffectApi: {
    getSettings(): Promise<unknown>;
    setSettings(update: unknown): Promise<unknown>;
  } | undefined;
  const contextBridge = {
    exposeInMainWorld(name: string, value: unknown) {
      if (name === "dialogueAffectApi") {
        dialogueAffectApi = value as typeof dialogueAffectApi;
      }
    }
  };
  const ipcRenderer = {
    invoke(...args: unknown[]) {
      invocations.push(args);
      return Promise.resolve(args[0] === "dialogueAffect:get-settings" ? { enabled: false } : { enabled: false });
    },
    on() {},
    removeListener() {}
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", preload)(
    (id: string) => {
      assert.equal(id, "electron");
      return { contextBridge, ipcRenderer };
    },
    module.exports,
    module
  );

  assert.ok(dialogueAffectApi);
  assert.deepEqual(await dialogueAffectApi.getSettings(), { enabled: false });
  assert.deepEqual(await dialogueAffectApi.setSettings({ enabled: false }), { enabled: false });
  await assert.rejects(dialogueAffectApi.setSettings({ enabled: false, extra: true }), {
    message: "Invalid dialogue affect settings"
  });
  assert.deepEqual(invocations, [
    ["dialogueAffect:get-settings"],
    ["dialogueAffect:set-settings", { enabled: false }]
  ]);
});

async function withStore(run: (userDataPath: string) => Promise<void>): Promise<void> {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-dialogue-affect-"));
  try {
    await run(userDataPath);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
}
