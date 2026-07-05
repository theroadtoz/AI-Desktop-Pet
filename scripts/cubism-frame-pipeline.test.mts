import assert from "node:assert/strict";
import test from "node:test";
import { updateCubismFrame } from "../src/renderer/pet/live2d/cubism-frame-pipeline.ts";

test("updateCubismFrame applies parameter layers in the fixed order", () => {
  const calls: string[] = [];
  const model = {
    loadParameters: () => calls.push("load"),
    saveParameters: () => calls.push("save"),
    update: () => calls.push("update")
  };

  updateCubismFrame(model as never, 1 / 60, {
    applyMotion: () => calls.push("motion"),
    applyPhysicsInputs: () => calls.push("physics-inputs"),
    evaluatePhysics: () => calls.push("physics"),
    applyExpression: () => calls.push("expression"),
    applyMicroExpression: () => calls.push("micro-expression"),
    applyBreath: () => calls.push("breath")
  });

  assert.deepEqual(calls, [
    "load",
    "motion",
    "physics-inputs",
    "save",
    "physics",
    "expression",
    "micro-expression",
    "breath",
    "update"
  ]);
});

test("updateCubismFrame safely skips unavailable parameter layers", () => {
  const calls: string[] = [];
  const model = {
    loadParameters: () => calls.push("load"),
    saveParameters: () => calls.push("save"),
    update: () => calls.push("update")
  };

  updateCubismFrame(model as never, 1 / 60, {});

  assert.deepEqual(calls, ["load", "save", "update"]);
});
