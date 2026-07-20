import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
  ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION,
  createEnvironmentActionSettingsRecord,
  normalizeEnvironmentActionSettings,
  resolveEnvironmentActionSettingsRecord
} = require("../dist/shared/environment-action-settings.js") as typeof import("../src/shared/environment-action-settings");

const defaults = {
  basicEnabled: true,
  musicEnabled: true,
  explicitGameContextEnabled: true
};
const unselected = {
  basicEnabled: false,
  musicEnabled: false,
  explicitGameContextEnabled: false
};

test("v4 environment settings default safely and persist only the explicit-game field", () => {
  assert.equal(ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION, 4);
  assert.deepEqual(DEFAULT_ENVIRONMENT_ACTION_SETTINGS, defaults);
  assert.deepEqual(normalizeEnvironmentActionSettings(null), defaults);
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({ musicEnabled: false }), {
    settings: defaults,
    userSelected: unselected
  });

  const record = createEnvironmentActionSettingsRecord(
    { basicEnabled: false, musicEnabled: false, explicitGameContextEnabled: true },
    { basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: false }
  );
  assert.deepEqual(record, {
    version: 4,
    basicEnabled: false,
    musicEnabled: false,
    explicitGameContextEnabled: true,
    userSelected: { basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: false }
  });
  assert.equal("gameEnabled" in record, false);
  assert.deepEqual(resolveEnvironmentActionSettingsRecord(record), {
    settings: { basicEnabled: false, musicEnabled: false, explicitGameContextEnabled: true },
    userSelected: { basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: false }
  });
});

test("v3 explicit game choices migrate one-to-one while unselected game uses the v4 default", () => {
  for (const gameEnabled of [true, false]) {
    assert.deepEqual(resolveEnvironmentActionSettingsRecord({
      version: 3,
      basicEnabled: true,
      musicEnabled: true,
      gameEnabled,
      userSelected: { basicEnabled: false, musicEnabled: false, gameEnabled: true }
    }), {
      settings: { basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: gameEnabled },
      userSelected: { basicEnabled: false, musicEnabled: false, explicitGameContextEnabled: true }
    });
  }

  assert.deepEqual(resolveEnvironmentActionSettingsRecord({
    version: 3,
    basicEnabled: false,
    musicEnabled: false,
    gameEnabled: false,
    userSelected: { basicEnabled: false, musicEnabled: false, gameEnabled: false }
  }), {
    settings: defaults,
    userSelected: unselected
  });
});

test("v2 and complete unversioned privacy choices migrate into the v4 meaning", () => {
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({
    version: 2,
    musicEnabled: false,
    gameEnabled: false,
    userSelected: { musicEnabled: true, gameEnabled: true }
  }), {
    settings: { basicEnabled: true, musicEnabled: false, explicitGameContextEnabled: false },
    userSelected: { basicEnabled: false, musicEnabled: true, explicitGameContextEnabled: true }
  });

  assert.deepEqual(resolveEnvironmentActionSettingsRecord({ musicEnabled: false, gameEnabled: false }), {
    settings: { basicEnabled: false, musicEnabled: false, explicitGameContextEnabled: false },
    userSelected: { basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: true }
  });
});

test("future records may preserve proven v4 selections but invalid versioned records default", () => {
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({
    version: 999,
    basicEnabled: true,
    musicEnabled: false,
    explicitGameContextEnabled: false,
    userSelected: { basicEnabled: false, musicEnabled: true, explicitGameContextEnabled: true }
  }), {
    settings: { basicEnabled: true, musicEnabled: false, explicitGameContextEnabled: false },
    userSelected: { basicEnabled: false, musicEnabled: true, explicitGameContextEnabled: true }
  });
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({
    version: 4,
    musicEnabled: false,
    gameEnabled: false,
    userSelected: { basicEnabled: true, musicEnabled: true, gameEnabled: true }
  }), {
    settings: defaults,
    userSelected: unselected
  });
});
