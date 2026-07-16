import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getAccessoryIdsForLegacyPreset,
  getLegacyAccessoryPresetId,
  getPetAccessoryModeLayer,
  MAX_PET_ACCESSORY_SELECTION,
  normalizeStoredPetAccessorySelection,
  parsePetAccessorySelection,
  PET_ACCESSORY_CATALOG,
  PET_ACCESSORY_GROUPS,
  resolvePetAccessorySelection
} from "../src/shared/pet-accessory.ts";

test("public accessory catalog is closed and contains no renderer implementation details", async () => {
  assert.deepEqual(PET_ACCESSORY_CATALOG, [
    { id: "ghost", label: "小幽灵", group: "companion", availability: "available" },
    { id: "bow", label: "蝴蝶结", group: "attire", availability: "available" },
    { id: "glasses", label: "眼镜", group: "facewear", availability: "available" },
    { id: "hat", label: "帽子", group: "headwear", availability: "available" },
    { id: "staff", label: "法杖", group: "held-prop", availability: "available" },
    { id: "game-controller", label: "手柄", group: "held-prop", availability: "available" },
    { id: "microphone", label: "麦克风", group: "held-prop", availability: "available" }
  ]);
  assert.deepEqual(PET_ACCESSORY_GROUPS, ["companion", "attire", "facewear", "headwear", "held-prop"]);

  const source = await readFile(new URL("../src/shared/pet-accessory.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /expressionName|partIds|Param\d+|Part\d+|motion3|model3|[\\/]model[\\/]/i);
  assert.doesNotMatch(PET_ACCESSORY_CATALOG.map((item) => item.id).join(","), /dark|happy|sad|angry|excited/);
});

test("strict accessory selection accepts canonical cross-group combinations", () => {
  assert.equal(MAX_PET_ACCESSORY_SELECTION, 5);
  assert.deepEqual(parsePetAccessorySelection([]), []);
  assert.deepEqual(
    parsePetAccessorySelection(["hat", "ghost", "glasses", "bow", "microphone"]),
    ["ghost", "bow", "glasses", "hat", "microphone"]
  );
});

test("strict accessory selection rejects unknown, duplicate, overlong, and held-prop conflicts", () => {
  assert.equal(parsePetAccessorySelection(["Part53"]), null);
  assert.equal(parsePetAccessorySelection(["dark"]), null);
  assert.equal(parsePetAccessorySelection(["glasses", "glasses"]), null);
  assert.equal(parsePetAccessorySelection(["staff", "game-controller"]), null);
  assert.equal(parsePetAccessorySelection(["staff", "microphone"]), null);
  assert.equal(parsePetAccessorySelection(["game-controller", "microphone"]), null);
  assert.equal(parsePetAccessorySelection(new Array(MAX_PET_ACCESSORY_SELECTION + 1).fill("ghost")), null);
  assert.equal(parsePetAccessorySelection("glasses"), null);
});

test("stored selection tolerantly filters unknown, duplicate, and conflicting ids", () => {
  assert.deepEqual(
    normalizeStoredPetAccessorySelection([
      "microphone",
      "ghost",
      "Part53",
      "microphone",
      "staff",
      "hat",
      "glasses"
    ]),
    ["ghost", "glasses", "hat", "microphone"]
  );
  assert.deepEqual(normalizeStoredPetAccessorySelection(null), []);
});

test("legacy none and glasses presets adapt to canonical selections", () => {
  assert.deepEqual(getAccessoryIdsForLegacyPreset("none"), []);
  assert.deepEqual(getAccessoryIdsForLegacyPreset("glasses"), ["glasses"]);
  assert.equal(getLegacyAccessoryPresetId([]), "none");
  assert.equal(getLegacyAccessoryPresetId(["ghost", "glasses"]), "glasses");
  assert.equal(getLegacyAccessoryPresetId(["ghost", "hat"]), "none");
});

test("work mode overrides facewear without changing other user groups", () => {
  const userAccessoryIds = ["ghost", "hat", "staff"] as const;
  const resolution = resolvePetAccessorySelection({
    userAccessoryIds,
    modeLayer: getPetAccessoryModeLayer("work")
  });

  assert.deepEqual(userAccessoryIds, ["ghost", "hat", "staff"]);
  assert.deepEqual(resolution.accessoryIds, ["ghost", "glasses", "hat", "staff"]);
  assert.equal(resolution.sourceByGroup.facewear, "mode");
  assert.equal(resolution.sourceByGroup.companion, "user");
  assert.equal(resolution.sourceByGroup["held-prop"], "user");
});

test("action layer has highest group-level priority and can explicitly clear a group", () => {
  const resolution = resolvePetAccessorySelection({
    userAccessoryIds: ["ghost", "glasses", "staff"],
    modeLayer: getPetAccessoryModeLayer("work"),
    actionLayer: {
      source: "action",
      overriddenGroups: ["facewear", "held-prop"],
      accessoryIds: ["game-controller"]
    }
  });

  assert.deepEqual(resolution.accessoryIds, ["ghost", "game-controller"]);
  assert.equal(resolution.sourceByGroup.facewear, "action");
  assert.equal(resolution.sourceByGroup["held-prop"], "action");
});

test("chat preload exposes strict selection IPC and no renderer command surface", async () => {
  const preload = await readFile(new URL("../src/preload/chat-preload.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");

  assert.match(preload, /setAccessorySelection/);
  assert.match(preload, /pet-presentation:set-accessory-selection/);
  assert.match(preload, /setAccessoryPreset/);
  assert.doesNotMatch(preload, /setPartOpacity|setExpressionAsset|Param\d+|Part\d+|motion3|model3/);
  assert.match(main, /ipcMain\.handle\("pet-presentation:set-accessory-selection"/);
  assert.match(main, /const accessoryIds = parsePetAccessorySelection\(value\)/);
  assert.match(main, /!isChatSender\(event\) \|\| !accessoryIds/);
  assert.match(main, /savePetAccessorySelection\(getAccessoryIdsForLegacyPreset\(presetId\)\)/);
});
