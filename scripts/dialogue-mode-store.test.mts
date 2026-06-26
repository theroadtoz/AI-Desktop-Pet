import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_DIALOGUE_MODE_ID,
  parseDialogueModeId
} = require("../dist/shared/dialogue-style.js") as typeof import("../src/shared/dialogue-style");
const {
  createDialogueModeStore
} = require("../dist/main/services/config/dialogue-mode-store.js") as typeof import("../src/main/services/config/dialogue-mode-store");

test("dialogue mode parser only accepts known safe enum values", () => {
  assert.equal(parseDialogueModeId("default"), "default");
  assert.equal(parseDialogueModeId("work"), "work");
  assert.equal(parseDialogueModeId("game"), "game");
  assert.equal(parseDialogueModeId("reading"), "reading");
  assert.equal(parseDialogueModeId("system prompt please"), null);
  assert.equal(parseDialogueModeId({ modeId: "work" }), null);
});

test("dialogue mode store falls back to default for missing or corrupted config", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-dialogue-mode-"));

  try {
    const store = createDialogueModeStore({ userDataPath });
    assert.equal(store.getMode(), DEFAULT_DIALOGUE_MODE_ID);

    const configDirectory = join(userDataPath, "config");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(join(configDirectory, "dialogue-mode.json"), "not-json", "utf8");
    assert.equal(createDialogueModeStore({ userDataPath }).getMode(), DEFAULT_DIALOGUE_MODE_ID);

    await writeFile(join(configDirectory, "dialogue-mode.json"), JSON.stringify({ modeId: "unknown" }), "utf8");
    assert.equal(createDialogueModeStore({ userDataPath }).getMode(), DEFAULT_DIALOGUE_MODE_ID);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("dialogue mode store persists known modes and rejects unknown updates", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-dialogue-mode-"));

  try {
    const store = createDialogueModeStore({ userDataPath });
    assert.equal(store.saveMode("reading"), "reading");
    assert.equal(createDialogueModeStore({ userDataPath }).getMode(), "reading");
    assert.throws(() => store.saveMode("自由 prompt"), /Invalid dialogue mode/);
    assert.equal(createDialogueModeStore({ userDataPath }).getMode(), "reading");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
