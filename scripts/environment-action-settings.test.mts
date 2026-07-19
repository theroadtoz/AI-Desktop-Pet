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
    musicEnabled: true,
    gameEnabled: true
  });
  assert.deepEqual(normalizeEnvironmentActionSettings(null), DEFAULT_ENVIRONMENT_ACTION_SETTINGS);
  assert.deepEqual(normalizeEnvironmentActionSettings({ musicEnabled: false }), {
    musicEnabled: true,
    gameEnabled: true
  });
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({}), {
    settings: DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
    userSelected: { musicEnabled: false, gameEnabled: false }
  });
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({ musicEnabled: false }), {
    settings: DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
    userSelected: { musicEnabled: false, gameEnabled: false }
  });
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({ version: 1, musicEnabled: false, gameEnabled: false }), {
    settings: DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
    userSelected: { musicEnabled: false, gameEnabled: false }
  });
});

test("environment action settings persist an explicit selection marker", () => {
  const record = createEnvironmentActionSettingsRecord(
    { musicEnabled: false, gameEnabled: true },
    { musicEnabled: true, gameEnabled: false }
  );
  assert.deepEqual(record, {
    version: ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION,
    musicEnabled: false,
    gameEnabled: true,
    userSelected: { musicEnabled: true, gameEnabled: false }
  });
  assert.deepEqual(resolveEnvironmentActionSettingsRecord(record), {
    settings: { musicEnabled: false, gameEnabled: true },
    userSelected: { musicEnabled: true, gameEnabled: false }
  });
});

test("ambiguous legacy double opt-out remains disabled for privacy", () => {
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({ musicEnabled: false, gameEnabled: false }), {
    settings: { musicEnabled: false, gameEnabled: false },
    userSelected: { musicEnabled: true, gameEnabled: true }
  });
});

test("future records preserve false values that carry explicit user selection proof", () => {
  assert.deepEqual(resolveEnvironmentActionSettingsRecord({
    version: 999,
    musicEnabled: false,
    gameEnabled: true,
    userSelected: { musicEnabled: true, gameEnabled: false }
  }), {
    settings: { musicEnabled: false, gameEnabled: true },
    userSelected: { musicEnabled: true, gameEnabled: false }
  });
});
