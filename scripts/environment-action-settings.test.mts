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

const alwaysEnabled = {
  basicEnabled: true,
  musicEnabled: true,
  explicitGameContextEnabled: true
};
const noUserSelection = {
  basicEnabled: false,
  musicEnabled: false,
  explicitGameContextEnabled: false
};

test("environment sensing is always enabled regardless of legacy or future settings", () => {
  assert.equal(ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION, 4);
  assert.deepEqual(DEFAULT_ENVIRONMENT_ACTION_SETTINGS, alwaysEnabled);

  for (const value of [
    null,
    { musicEnabled: false, gameEnabled: false },
    {
      version: 2,
      musicEnabled: false,
      gameEnabled: false,
      userSelected: { musicEnabled: true, gameEnabled: true }
    },
    {
      version: 3,
      basicEnabled: false,
      musicEnabled: false,
      gameEnabled: false,
      userSelected: { basicEnabled: true, musicEnabled: true, gameEnabled: true }
    },
    {
      version: 999,
      basicEnabled: false,
      musicEnabled: false,
      explicitGameContextEnabled: false,
      userSelected: { basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: true }
    }
  ]) {
    assert.deepEqual(normalizeEnvironmentActionSettings(value), alwaysEnabled);
    assert.deepEqual(resolveEnvironmentActionSettingsRecord(value), {
      settings: alwaysEnabled,
      userSelected: noUserSelection
    });
  }
});

test("persisted environment records cannot encode an opt-out", () => {
  assert.deepEqual(createEnvironmentActionSettingsRecord(
    { basicEnabled: false, musicEnabled: false, explicitGameContextEnabled: false },
    { basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: true }
  ), {
    version: 4,
    ...alwaysEnabled,
    userSelected: noUserSelection
  });
});
