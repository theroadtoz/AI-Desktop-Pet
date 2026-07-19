import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
  normalizeEnvironmentActionSettings
} = require("../dist/shared/environment-action-settings.js") as typeof import("../src/shared/environment-action-settings");

test("environment action settings are default-off and normalize to booleans", () => {
  assert.deepEqual(DEFAULT_ENVIRONMENT_ACTION_SETTINGS, {
    musicEnabled: false,
    gameEnabled: false
  });
  assert.deepEqual(normalizeEnvironmentActionSettings(null), DEFAULT_ENVIRONMENT_ACTION_SETTINGS);
  assert.deepEqual(normalizeEnvironmentActionSettings({ musicEnabled: true, gameEnabled: false }), {
    musicEnabled: true,
    gameEnabled: false
  });
  assert.deepEqual(normalizeEnvironmentActionSettings({ musicEnabled: "true", gameEnabled: 1 }), {
    musicEnabled: false,
    gameEnabled: false
  });
});
