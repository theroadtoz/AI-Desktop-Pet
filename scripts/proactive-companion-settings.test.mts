import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PROACTIVE_COMPANION_SETTINGS,
  PROACTIVE_COMPANION_CADENCES,
  getProactiveCompanionIdleIntervalMs,
  isProactiveCompanionCadence,
  normalizeProactiveCompanionSettings,
  shouldQueueProactiveCompanionSourceBubble
} = require("../dist/shared/proactive-companion-settings.js") as typeof import("../src/shared/proactive-companion-settings");

test("proactive companion settings normalize only accepts safe settings", () => {
  assert.deepEqual(PROACTIVE_COMPANION_CADENCES, ["normal", "quiet", "off"]);
  assert.deepEqual(DEFAULT_PROACTIVE_COMPANION_SETTINGS, {
    cadence: "normal",
    memorySourceBubbles: true,
    searchSourceBubbles: true
  });

  assert.equal(isProactiveCompanionCadence("normal"), true);
  assert.equal(isProactiveCompanionCadence("quiet"), true);
  assert.equal(isProactiveCompanionCadence("off"), true);
  assert.equal(isProactiveCompanionCadence("system prompt please"), false);
  assert.equal(isProactiveCompanionCadence({ cadence: "quiet" }), false);

  assert.deepEqual(normalizeProactiveCompanionSettings(null), DEFAULT_PROACTIVE_COMPANION_SETTINGS);
  assert.deepEqual(normalizeProactiveCompanionSettings(undefined), DEFAULT_PROACTIVE_COMPANION_SETTINGS);
  assert.deepEqual(normalizeProactiveCompanionSettings({
    cadence: "quiet",
    memorySourceBubbles: false,
    searchSourceBubbles: false
  }), {
    cadence: "quiet",
    memorySourceBubbles: false,
    searchSourceBubbles: false
  });
  assert.deepEqual(normalizeProactiveCompanionSettings({
    cadence: "off",
    memorySourceBubbles: false
  }), {
    cadence: "off",
    memorySourceBubbles: false,
    searchSourceBubbles: true
  });
  assert.deepEqual(normalizeProactiveCompanionSettings({
    cadence: "自由 prompt",
    memorySourceBubbles: "false",
    searchSourceBubbles: 0
  }), DEFAULT_PROACTIVE_COMPANION_SETTINGS);
});

test("proactive companion idle interval handles normal quiet and off cadence", () => {
  assert.equal(
    getProactiveCompanionIdleIntervalMs(DEFAULT_PROACTIVE_COMPANION_SETTINGS, 5_432.2),
    5_432
  );
  assert.equal(
    getProactiveCompanionIdleIntervalMs(DEFAULT_PROACTIVE_COMPANION_SETTINGS, Number.NaN),
    12 * 60_000
  );

  assert.equal(
    getProactiveCompanionIdleIntervalMs({
      ...DEFAULT_PROACTIVE_COMPANION_SETTINGS,
      cadence: "quiet"
    }, 1_000),
    30 * 60_000
  );
  assert.equal(
    getProactiveCompanionIdleIntervalMs({
      ...DEFAULT_PROACTIVE_COMPANION_SETTINGS,
      cadence: "quiet"
    }, 15 * 60_000),
    45 * 60_000
  );
  assert.equal(
    getProactiveCompanionIdleIntervalMs({
      ...DEFAULT_PROACTIVE_COMPANION_SETTINGS,
      cadence: "quiet"
    }, 100, { acceptance: true }),
    1_800
  );
  assert.equal(
    getProactiveCompanionIdleIntervalMs({
      ...DEFAULT_PROACTIVE_COMPANION_SETTINGS,
      cadence: "off"
    }, 12 * 60_000),
    null
  );
});

test("proactive companion source gate respects source toggles and off cadence", () => {
  assert.equal(shouldQueueProactiveCompanionSourceBubble(
    DEFAULT_PROACTIVE_COMPANION_SETTINGS,
    "memory"
  ), true);
  assert.equal(shouldQueueProactiveCompanionSourceBubble(
    DEFAULT_PROACTIVE_COMPANION_SETTINGS,
    "search"
  ), true);

  assert.equal(shouldQueueProactiveCompanionSourceBubble({
    cadence: "normal",
    memorySourceBubbles: false,
    searchSourceBubbles: true
  }, "memory"), false);
  assert.equal(shouldQueueProactiveCompanionSourceBubble({
    cadence: "normal",
    memorySourceBubbles: false,
    searchSourceBubbles: true
  }, "search"), true);
  assert.equal(shouldQueueProactiveCompanionSourceBubble({
    cadence: "quiet",
    memorySourceBubbles: true,
    searchSourceBubbles: false
  }, "memory"), true);
  assert.equal(shouldQueueProactiveCompanionSourceBubble({
    cadence: "quiet",
    memorySourceBubbles: true,
    searchSourceBubbles: false
  }, "search"), false);
  assert.equal(shouldQueueProactiveCompanionSourceBubble({
    cadence: "off",
    memorySourceBubbles: true,
    searchSourceBubbles: true
  }, "memory"), false);
  assert.equal(shouldQueueProactiveCompanionSourceBubble({
    cadence: "off",
    memorySourceBubbles: true,
    searchSourceBubbles: true
  }, "search"), false);
});
