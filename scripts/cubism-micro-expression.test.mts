import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMicroExpressionTarget,
  createCubismMicroExpressionController,
  discoverMicroExpressionParameters,
  MICRO_EXPRESSION_PARAMETER_IDS
} from "../src/renderer/pet/live2d/cubism-micro-expression.ts";

type TestParameter = {
  name: string;
  minimum: number;
  maximum: number;
  base: number;
};

function createModel(parameters: readonly TestParameter[]) {
  const writes: Array<{ name: string; value: number }> = [];
  const ids = parameters.map((parameter) => ({
    name: parameter.name,
    isEqual: (candidate: string) => parameter.name === candidate
  }));

  return {
    writes,
    getParameterCount: () => parameters.length,
    getParameterId: (index: number) => ids[index],
    getParameterMinimumValue: (index: number) => parameters[index].minimum,
    getParameterMaximumValue: (index: number) => parameters[index].maximum,
    getParameterDefaultValue: (index: number) => parameters[index].base,
    setParameterValueById: (id: { name: string }, value: number) => writes.push({ name: id.name, value })
  };
}

const PARAMETERS = [
  { name: "ParamEyeLSmile", minimum: -1, maximum: 1, base: 0 },
  { name: "ParamEyeRSmile", minimum: -1, maximum: 1, base: 0 },
  { name: "ParamBrowLY", minimum: -1, maximum: 1, base: 0 },
  { name: "ParamBreath", minimum: -1, maximum: 1, base: 0 },
  { name: "ParamAngleX", minimum: -30, maximum: 30, base: 0 }
] as const;

test("micro-expression discovery uses only the audited parameter whitelist", () => {
  const model = createModel(PARAMETERS);
  const parameters = discoverMicroExpressionParameters(model as never);

  assert.deepEqual(parameters.map((parameter) => parameter.name), MICRO_EXPRESSION_PARAMETER_IDS);
  assert.equal(parameters.some((parameter) => parameter.name === "ParamBreath"), false);
});

test("micro-expression targets are normalized to each parameter range", () => {
  const model = createModel(PARAMETERS);
  const parameter = discoverMicroExpressionParameters(model as never)[0];

  assert.equal(calculateMicroExpressionTarget(parameter, 0.06), 0.12);
  assert.equal(calculateMicroExpressionTarget(parameter, 100), 1);
  assert.equal(calculateMicroExpressionTarget(parameter, -100), -1);
});

test("micro expressions are low-amplitude and smooth back to base when cleared", () => {
  const model = createModel(PARAMETERS);
  const controller = createCubismMicroExpressionController(model as never);

  controller.setEmotion("happy");
  controller.update(model as never, 1 / 60);

  assert.deepEqual(model.writes.map((write) => write.name), [
    "ParamEyeLSmile",
    "ParamEyeRSmile",
    "ParamBrowLY"
  ]);
  assert.ok(model.writes.every((write) => write.value >= -1 && write.value <= 1));
  assert.ok(model.writes[0].value > 0 && model.writes[0].value < 0.12);

  model.writes.length = 0;
  controller.clear();
  controller.update(model as never, 1 / 60);
  assert.equal(model.writes.length, 3);
  assert.ok(model.writes[0].value > 0 && model.writes[0].value < 0.12);

  for (let index = 0; index < 20; index += 1) {
    controller.update(model as never, 0.1);
  }

  const writesAfterSettling = model.writes.length;
  controller.update(model as never, 1 / 60);
  assert.equal(model.writes.length, writesAfterSettling);

  controller.setEmotion("happy");
  controller.update(model as never, 1 / 60);
  const latestWrite = model.writes.at(-3);
  assert.ok(latestWrite && latestWrite.value > 0 && latestWrite.value < 0.12);
});

test("micro-expression intensity scales low and medium targets below high targets", () => {
  const model = createModel(PARAMETERS);
  const controller = createCubismMicroExpressionController(model as never);

  controller.setEmotion("happy", "low");
  controller.update(model as never, 1);
  const lowSmile = model.writes[0].value;

  model.writes.length = 0;
  controller.clear(true);
  controller.setEmotion("happy", "medium");
  controller.update(model as never, 1);
  const mediumSmile = model.writes[0].value;

  model.writes.length = 0;
  controller.clear(true);
  controller.setEmotion("happy", "high");
  controller.update(model as never, 1);
  const highSmile = model.writes[0].value;

  assert.ok(lowSmile > 0);
  assert.ok(lowSmile < mediumSmile);
  assert.ok(mediumSmile < highSmile);
  assert.ok(highSmile <= 0.12);
});

test("neutral clears every micro-expression parameter target", () => {
  const model = createModel(PARAMETERS);
  const controller = createCubismMicroExpressionController(model as never);

  controller.setEmotion("confused", "high");
  controller.update(model as never, 1 / 60);
  model.writes.length = 0;

  controller.setEmotion("neutral", "low");
  controller.update(model as never, 1);

  assert.equal(model.writes.length, 3);
  assert.ok(model.writes.every((write) => Math.abs(write.value) < 0.001));
});

test("immediate clearing prevents micro-expression writes during emphasis playback", () => {
  const model = createModel(PARAMETERS);
  const controller = createCubismMicroExpressionController(model as never);

  controller.setEmotion("happy");
  controller.update(model as never, 1 / 60);
  model.writes.length = 0;

  controller.clear(true);
  controller.update(model as never, 1 / 60);

  assert.deepEqual(model.writes, []);
});
