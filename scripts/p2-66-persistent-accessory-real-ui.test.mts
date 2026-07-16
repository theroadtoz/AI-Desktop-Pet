import assert from "node:assert/strict";
import test from "node:test";

import {
  hasPrivateAccessorySurface,
  matchesAccessorySelection,
  signatureChanged
} from "./p2-66-persistent-accessory-real-ui.mjs";

test("P2-66 runner recognizes canonical persisted selections", () => {
  assert.equal(matchesAccessorySelection(["ghost", "bow", "hat", "staff"], ["ghost", "bow", "hat", "staff"]), true);
  assert.equal(matchesAccessorySelection(["staff", "hat"], ["hat", "staff"]), false);
  assert.equal(matchesAccessorySelection(["ghost", "ghost"], ["ghost"]), false);
});

test("P2-66 runner treats screenshot hashes or byte lengths as visual changes", () => {
  assert.equal(signatureChanged({ hash: "a", length: 10 }, { hash: "b", length: 10 }), true);
  assert.equal(signatureChanged({ hash: "a", length: 10 }, { hash: "a", length: 11 }), true);
  assert.equal(signatureChanged({ hash: "a", length: 10 }, { hash: "a", length: 10 }), false);
});

test("P2-66 runner rejects private renderer details in the public accessory surface", () => {
  assert.equal(hasPrivateAccessorySurface({ apiKeys: ["getPreferences"], radioValues: [{ value: "glasses" }] }), false);
  assert.equal(hasPrivateAccessorySurface({ accessoryParameter: "Param66" }), true);
  assert.equal(hasPrivateAccessorySurface({ nested: { expressionName: "glasses" } }), true);
});
