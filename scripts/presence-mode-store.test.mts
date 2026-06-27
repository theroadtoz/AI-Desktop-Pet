import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PRESENCE_MODE_ID,
  parsePresenceModeId
} = require("../dist/shared/presence-mode.js") as typeof import("../src/shared/presence-mode");
const {
  createPresenceModeStore
} = require("../dist/main/services/config/presence-mode-store.js") as typeof import("../src/main/services/config/presence-mode-store");

test("presence mode parser only accepts known safe enum values", () => {
  assert.equal(parsePresenceModeId("default"), "default");
  assert.equal(parsePresenceModeId("focus"), "focus");
  assert.equal(parsePresenceModeId("quiet"), "quiet");
  assert.equal(parsePresenceModeId("sleep"), "sleep");
  assert.equal(parsePresenceModeId("system prompt please"), null);
  assert.equal(parsePresenceModeId({ modeId: "quiet" }), null);
});

test("presence mode store falls back to default for missing or corrupted config", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-presence-mode-"));

  try {
    const store = createPresenceModeStore({ userDataPath });
    assert.equal(store.getMode(), DEFAULT_PRESENCE_MODE_ID);

    const configDirectory = join(userDataPath, "config");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(join(configDirectory, "presence-mode.json"), "not-json", "utf8");
    assert.equal(createPresenceModeStore({ userDataPath }).getMode(), DEFAULT_PRESENCE_MODE_ID);

    await writeFile(join(configDirectory, "presence-mode.json"), JSON.stringify({ modeId: "unknown" }), "utf8");
    assert.equal(createPresenceModeStore({ userDataPath }).getMode(), DEFAULT_PRESENCE_MODE_ID);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("presence mode store persists known modes and rejects unknown updates", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-presence-mode-"));

  try {
    const store = createPresenceModeStore({ userDataPath });
    assert.equal(store.saveMode("quiet"), "quiet");
    assert.equal(createPresenceModeStore({ userDataPath }).getMode(), "quiet");
    assert.throws(() => store.saveMode("自由 prompt"), /Invalid presence mode/);
    assert.equal(createPresenceModeStore({ userDataPath }).getMode(), "quiet");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
