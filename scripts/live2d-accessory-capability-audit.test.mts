import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { auditWitchAccessoryCapabilities } from "./live2d-accessory-capability-audit.mts";

test("accessory audit covers manifest expressions, the idle motion, model references, and project hit areas", async () => {
  const audit = await auditWitchAccessoryCapabilities();

  assert.equal(audit.modelParameterCount, 279);
  assert.equal(audit.entries.filter((entry) => entry.sourceType === "manifest-expression").length, 12);
  assert.equal(audit.entries.filter((entry) => entry.sourceType === "manifest-idle-motion").length, 1);
  assert.equal(audit.entries.filter((entry) => entry.sourceType === "model3-file-reference").length, 5);
  assert.equal(audit.entries.filter((entry) => entry.sourceType === "project-hit-area").length, 2);
  assert.deepEqual(audit.model3Declarations, {
    hasMotions: false,
    hasUserData: false,
    hasHitAreas: false
  });
  assert.equal(audit.entries.every((entry) => entry.loadable), true);
  assert.equal(audit.entries.every((entry) => entry.staticChecks.parameterValuesInRange), true);
});

test("no unverified resource is admitted as a switchable preset", async () => {
  const audit = await auditWitchAccessoryCapabilities();
  const byName = new Map(audit.entries.map((entry) => [entry.name, entry]));

  assert.equal(audit.switchablePresetCount, 0);
  assert.equal(audit.p25dScope, "do-not-implement-accessory-selector");
  assert.equal(byName.get("happy")?.category, "presentation-only");
  assert.equal(byName.get("gestureMic")?.category, "presentation-only");
  assert.equal(byName.get("glasses")?.category, "unconfirmed");
  assert.equal(byName.get("idleMotion")?.category, "presentation-only");
});

test("checked-in P2-5C machine-readable result matches the current model assets", async () => {
  const resultPath = resolve(import.meta.dirname, "../docs/P2-5C_ACCESSORY_CAPABILITY_AUDIT_RESULT.json");
  const checkedInResult = JSON.parse(readFileSync(resultPath, "utf8"));

  assert.deepEqual(checkedInResult, await auditWitchAccessoryCapabilities());
});
