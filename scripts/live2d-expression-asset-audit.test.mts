import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PET_EXPRESSION_PRESET_CATALOG } from "../src/shared/interaction-action-catalog.ts";
import { auditWitchExpressionAssets, validateExpressionAsset } from "./live2d-expression-asset-audit.mts";

function legacyAuditProjection<T extends { expressionPresets?: unknown }>(audit: T): Omit<T, "expressionPresets"> {
  const { expressionPresets, ...legacyAudit } = audit;
  return legacyAudit;
}

test("witch expression assets are parseable and use only CDI3 parameters", () => {
  const audit = auditWitchExpressionAssets();

  assert.equal(audit.expressionAssetCount, 12);
  assert.equal(audit.entries.every((entry) => entry.parameters.length > 0), true);
  assert.equal(audit.entries.every((entry) => entry.parameters.every((parameter) => parameter.blend === "Add")), true);
  assert.equal(audit.entries.every((entry) => entry.fadeInTime === null && entry.fadeOutTime === null), true);
});

test("all chat emotions and unmapped expression assets have an audit entry", () => {
  const audit = auditWitchExpressionAssets();
  const mapped = new Map(audit.entries.flatMap((entry) => entry.mappedEmotions.map((emotion) => [emotion, entry.name])));

  assert.deepEqual([...mapped.keys()].sort(), ["angry", "confused", "happy", "sad", "surprised"]);
  assert.equal(audit.entries.filter((entry) => entry.mappedEmotions.length === 0).length, 7);
  assert.equal(audit.entries.every((entry) => entry.classificationBasis === "static-inference"), true);
});

test("mapped expressions retain the manifest mappings and non-emotion assets stay manual-only", () => {
  const audit = auditWitchExpressionAssets();
  const byName = new Map(audit.entries.map((entry) => [entry.name, entry]));

  assert.deepEqual(byName.get("happy")?.mappedEmotions, ["happy"]);
  assert.deepEqual(byName.get("sad")?.mappedEmotions, ["sad"]);
  assert.deepEqual(byName.get("angry")?.mappedEmotions, ["angry"]);
  assert.deepEqual(byName.get("excited")?.mappedEmotions, ["surprised"]);
  assert.deepEqual(byName.get("dark")?.mappedEmotions, ["confused"]);
  assert.equal(byName.get("staff")?.suggestedUsage, "manual-only");
  assert.equal(byName.get("gestureMic")?.suggestedUsage, "manual-only");
});

test("expression preset catalog classifies every manifest expression without exposing resource paths", () => {
  const audit = auditWitchExpressionAssets();
  const auditedExpressionNames = audit.entries.map((entry) => entry.name).sort();
  const presetExpressionNames = audit.expressionPresets
    .map((entry) => entry.expressionName)
    .sort();

  assert.deepEqual(presetExpressionNames, auditedExpressionNames);
  assert.deepEqual(
    audit.expressionPresets.map((entry) => entry.expressionName).sort(),
    Object.values(PET_EXPRESSION_PRESET_CATALOG).map((entry) => entry.expressionName).sort()
  );

  for (const preset of audit.expressionPresets) {
    assert.equal(preset.allowedPresenceModes.length > 0, true);
    assert.equal(preset.allowedDialogueModes.length > 0, true);
    assert.match(preset.category, /^(emotion|micro-expression|gesture-like|prop-or-appearance|uncertain-or-needs-visual-check)$/);
    assert.match(preset.intensity, /^(low|medium|high)$/);
    assert.equal(preset.restorePolicy, "restore-persistent-expression");
    assert.equal(/[\\/]|\.(exp3|motion3)\.json/i.test(preset.expressionName), false);
  }

  const byName = new Map(audit.expressionPresets.map((entry) => [entry.expressionName, entry]));

  assert.equal(byName.get("happy")?.category, "emotion");
  assert.equal(byName.get("sad")?.category, "emotion");
  assert.equal(byName.get("angry")?.category, "emotion");
  assert.equal(byName.get("excited")?.category, "emotion");
  assert.equal(byName.get("dark")?.category, "emotion");
  assert.equal(byName.get("staff")?.category, "prop-or-appearance");
  assert.equal(byName.get("hat")?.category, "prop-or-appearance");
  assert.equal(byName.get("bow")?.category, "prop-or-appearance");
  assert.equal(byName.get("glasses")?.category, "prop-or-appearance");
  assert.equal(byName.get("gestureGame")?.category, "gesture-like");
  assert.equal(byName.get("gestureMic")?.category, "gesture-like");
  assert.equal(byName.get("ghost")?.category, "uncertain-or-needs-visual-check");
  assert.equal(byName.get("ghost")?.visualRisk, "needs-visual-check");
  assert.deepEqual(byName.get("glasses")?.suggestedActionTypes, ["reading", "readingIdle", "readingThink"]);
  assert.deepEqual(byName.get("gestureGame")?.suggestedActionTypes, ["playGame", "gameReady", "gameCheerLite"]);
  assert.deepEqual(byName.get("happy")?.suggestedActionTypes.includes("shySmile"), true);
});

test("expression validation rejects unknown parameters and illegal fades or blends", () => {
  assert.throws(
    () => validateExpressionAsset({ Parameters: [{ Id: "ParamMissing", Value: 1, Blend: "Add" }] }, ["ParamKnown"], "test"),
    /不存在的参数/
  );
  assert.throws(
    () => validateExpressionAsset({ Parameters: [{ Id: "ParamKnown", Value: 1, Blend: "Invalid" }] }, ["ParamKnown"], "test"),
    /Blend 非法/
  );
  assert.throws(
    () => validateExpressionAsset({ FadeInTime: -1, Parameters: [{ Id: "ParamKnown", Value: 1, Blend: "Add" }] }, ["ParamKnown"], "test"),
    /FadeInTime 必须是非负有限数值/
  );
});

test("local machine-readable audit matches the current model assets", () => {
  const resultPath = resolve(import.meta.dirname, "../docs/P2-5A_LIVE2D_EXPRESSION_ASSET_AUDIT_RESULT.json");
  const checkedInResult = JSON.parse(readFileSync(resultPath, "utf8"));

  assert.deepEqual(legacyAuditProjection(checkedInResult), legacyAuditProjection(auditWitchExpressionAssets()));
});
