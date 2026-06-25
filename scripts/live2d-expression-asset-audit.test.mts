import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { auditWitchExpressionAssets, validateExpressionAsset } from "./live2d-expression-asset-audit.mts";

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

  assert.deepEqual(checkedInResult, auditWitchExpressionAssets());
});
