import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PET_ACCESSORY_CATALOG, PET_ACCESSORY_GROUPS } from "../src/shared/pet-accessory.ts";

const runnerSource = readFileSync("scripts/p2-11e-companion-control-shelf-real-ui.mjs", "utf8");
const chatIndexSource = readFileSync("src/renderer/chat/index.html", "utf8");
const chatMainSource = readFileSync("src/renderer/chat/main.ts", "utf8");

test("current chat accessory UI exposes grouped controls instead of a single legacy toggle", () => {
  const availableItems = PET_ACCESSORY_CATALOG.filter((item) => item.availability === "available");
  const availableGroups = new Set(availableItems.map((item) => item.group));

  assert.ok(PET_ACCESSORY_GROUPS.length >= 2);
  assert.ok(availableGroups.size >= 2);
  assert.match(chatIndexSource, /id="pet-accessory-groups"/u);
  assert.match(chatIndexSource, /id="save-pet-accessory-button"/u);
  assert.match(chatIndexSource, /id="shelf-accessory-button"/u);
  assert.match(chatMainSource, /const groupName = `pet-accessory-\$\{group\}`;/u);
  assert.match(chatMainSource, /radio\.type = "radio";/u);
  assert.match(chatMainSource, /accessoryLabel: `已选 \$\{currentPetAccessoryIds\.length\} 类`/u);
});

test("p2-11e runner verifies grouped accessory reachability without hardcoding the old glasses label", () => {
  for (const token of [
    "ACCESSORY_CLASS_COUNT_PATTERN",
    "readAccessoryEntryState",
    "#pet-accessory-groups .pet-accessory-group",
    "#save-pet-accessory-button",
    "countSelectedAccessoryClasses",
    "selectedAccessory",
    "statusText.includes(selectedAccessory.label)",
    "checkedNonNone[0]?.value === selectedAccessory.value"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token), "u"));
  }

  assert.doesNotMatch(runnerSource, /includes\((["'])眼镜\1\)/u);
  assert.doesNotMatch(runnerSource, /(["'])glasses\1/u);
});

test("p2-11e runner preserves privacy, action echo, and other shelf gates", () => {
  for (const token of [
    "MODEL_DETAIL_LEAK_PATTERN",
    "accessoryUiDoesNotLeakModelDetails",
    "privacyOutput",
    "finalUiDoesNotLeakModelDetails",
    "#shelf-scale-button",
    "#shelf-lock-button",
    "#shortcut-list",
    "HEAD_PAT_SAFE_ECHO_MESSAGE",
    "PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE",
    "desktopLayout",
    "narrowLayout"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token), "u"));
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
