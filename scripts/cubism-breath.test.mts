import assert from "node:assert/strict";
import test from "node:test";
import { findBreathParameterId } from "../src/renderer/pet/live2d/cubism-breath.ts";

test("findBreathParameterId returns only an existing ParamBreath parameter", () => {
  const breathId = { isEqual: (id: string) => id === "ParamBreath" };
  const model = {
    getParameterCount: () => 2,
    getParameterId: (index: number) => index === 1 ? breathId : { isEqual: () => false }
  };

  assert.equal(findBreathParameterId(model as never), breathId);
});

test("findBreathParameterId safely degrades when ParamBreath is absent", () => {
  const model = {
    getParameterCount: () => 1,
    getParameterId: () => ({ isEqual: () => false })
  };

  assert.equal(findBreathParameterId(model as never), null);
});
