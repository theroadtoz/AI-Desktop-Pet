import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_PET_ACCESSORY_PRESET_ID,
  getPetAccessoryPreset,
  isPetAccessoryPresetId,
  PET_ACCESSORY_PRESETS
} from "../src/shared/pet-accessory.ts";
import {
  DEFAULT_PET_PRESENTATION_PREFERENCES,
  parsePetPresentationPreferences,
  parseStoredPetPresentationPreferences
} from "../src/shared/pet-presentation.ts";

test("pet accessory preset ids are a closed whitelist", () => {
  assert.equal(DEFAULT_PET_ACCESSORY_PRESET_ID, "none");
  assert.deepEqual(PET_ACCESSORY_PRESETS.map((preset) => preset.id), ["none", "glasses"]);
  assert.equal(isPetAccessoryPresetId("none"), true);
  assert.equal(isPetAccessoryPresetId("glasses"), true);
  assert.equal(isPetAccessoryPresetId("gestureGame"), false);
  assert.equal(isPetAccessoryPresetId("Part53"), false);
  assert.equal(isPetAccessoryPresetId("dark"), false);
});

test("glasses preset exposes only the audited expression and part", () => {
  assert.deepEqual(getPetAccessoryPreset("none"), {
    id: "none",
    label: "无配件",
    expressionName: null,
    partIds: []
  });
  assert.deepEqual(getPetAccessoryPreset("glasses"), {
    id: "glasses",
    label: "眼镜",
    expressionName: "glasses",
    partIds: ["Part53"]
  });
});

test("pet presentation preferences persist accessory ids and migrate old scale-only data", () => {
  assert.deepEqual(parsePetPresentationPreferences({ petScale: 1.1, accessoryPresetId: "glasses" }), {
    petScale: 1.1,
    accessoryPresetId: "glasses"
  });
  assert.deepEqual(parsePetPresentationPreferences({ petScale: 1.1 }), {
    petScale: 1.1,
    accessoryPresetId: "none"
  });
  assert.deepEqual(parsePetPresentationPreferences({ petScale: 1.1, accessoryPresetId: "Part53" }), {
    petScale: 1.1,
    accessoryPresetId: "none"
  });
});

test("stored pet presentation data falls back safely with accessory fields", () => {
  assert.deepEqual(parseStoredPetPresentationPreferences("not json"), DEFAULT_PET_PRESENTATION_PREFERENCES);
  assert.deepEqual(parseStoredPetPresentationPreferences(JSON.stringify({ petScale: 1.2, accessoryPresetId: "glasses" })), {
    petScale: 1.2,
    accessoryPresetId: "glasses"
  });
  assert.deepEqual(parseStoredPetPresentationPreferences(JSON.stringify({ petScale: 1.2, accessoryPresetId: "gestureGame" })), {
    petScale: 1.2,
    accessoryPresetId: "none"
  });
});

test("chat preload exposes accessory preset IPC without arbitrary part or expression channels", async () => {
  const preload = await readFile(new URL("../src/preload/chat-preload.ts", import.meta.url), "utf8");

  assert.match(preload, /setAccessoryPreset/);
  assert.match(preload, /pet-presentation:set-accessory/);
  assert.doesNotMatch(preload, /setPartOpacity|setExpressionAsset|Part53|gestureGame|dark/);
});

test("pet renderer restores the latest persistent accessory after temporary actions", async () => {
  const source = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");
  const playerSource = await readFile(new URL("../src/renderer/pet/interaction-action-player.ts", import.meta.url), "utf8");

  assert.match(source, /lastAccessoryPresetId/);
  assert.match(source, /getPersistentPresentation:\s*\(\) => \(\{\s*presentation: lastPresentation,\s*accessoryPresetId: lastAccessoryPresetId\s*\}\)/);
  assert.match(source, /interactionActionPlayer\.isActive\(\)/);
  assert.match(playerSource, /const persistent = getPersistentPresentation\(\)/);
  assert.match(playerSource, /applyPresentation\(persistent\.presentation, persistent\.accessoryPresetId\)/);
  assert.match(playerSource, /restoredAccessoryPresetId: persistent\.accessoryPresetId/);
});
