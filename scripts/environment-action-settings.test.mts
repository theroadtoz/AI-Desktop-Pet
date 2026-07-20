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

test("environment action settings default on for absent and partial values", () => {
  assert.deepEqual(DEFAULT_ENVIRONMENT_ACTION_SETTINGS, {
    basicEnabled: true,
    musicEnabled: true,
    gameEnabled: true
  });
  assert.deepEqual(normalizeEnvironmentActionSettings(null), DEFAULT_ENVIRONMENT_ACTION_SETTINGS);
  assert.deepEqual(normalizeEnvironmentActionSettings({ musicEnabled: false }), {
    basicEnabled: true,
    musicEnabled: true,
    gameEnabled: true
  });
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({}), {
    settings: DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
    userSelected: { basicEnabled: false, musicEnabled: false, gameEnabled: false }
  });
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({ musicEnabled: false }), {
    settings: DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
    userSelected: { basicEnabled: false, musicEnabled: false, gameEnabled: false }
  });
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({ version: 1, musicEnabled: false, gameEnabled: false }), {
    settings: DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
    userSelected: { basicEnabled: false, musicEnabled: false, gameEnabled: false }
  });
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({
    version: 3,
    musicEnabled: false,
    gameEnabled: false,
    userSelected: { basicEnabled: true, musicEnabled: true, gameEnabled: true }
  }), {
    settings: DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
    userSelected: { basicEnabled: false, musicEnabled: false, gameEnabled: false }
  });
});

test("environment action settings persist an explicit selection marker", () => {
  const record = createEnvironmentActionSettingsRecord(
    { basicEnabled: false, musicEnabled: false, gameEnabled: true },
    { basicEnabled: true, musicEnabled: true, gameEnabled: false }
  );
  assert.deepEqual(record, {
    version: ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION,
    basicEnabled: false,
    musicEnabled: false,
    gameEnabled: true,
    userSelected: { basicEnabled: true, musicEnabled: true, gameEnabled: false }
  });
  assert.deepEqual(resolveEnvironmentActionSettingsRecord(record), {
    settings: { basicEnabled: false, musicEnabled: false, gameEnabled: true },
    userSelected: { basicEnabled: true, musicEnabled: true, gameEnabled: false }
  });
});

test("v2 explicit media and game choices migrate with basic enabled", () => {
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({
    version: 2,
    musicEnabled: false,
    gameEnabled: true,
    userSelected: { musicEnabled: true, gameEnabled: false }
  }), {
    settings: { basicEnabled: true, musicEnabled: false, gameEnabled: true },
    userSelected: { basicEnabled: false, musicEnabled: true, gameEnabled: false }
  });
});

test("complete unversioned legacy double opt-out remains fully disabled", () => {
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({
    musicEnabled: false,
    gameEnabled: false
  }), {
    settings: { basicEnabled: false, musicEnabled: false, gameEnabled: false },
    userSelected: { basicEnabled: true, musicEnabled: true, gameEnabled: true }
  });
});

test("future records preserve false values that carry explicit user selection proof", () => {
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({
    version: 999,
    basicEnabled: true,
    musicEnabled: false,
    gameEnabled: true,
    userSelected: { basicEnabled: false, musicEnabled: true, gameEnabled: false }
  }), {
    settings: { basicEnabled: true, musicEnabled: false, gameEnabled: true },
    userSelected: { basicEnabled: false, musicEnabled: true, gameEnabled: false }
  });
});
