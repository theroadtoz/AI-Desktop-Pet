import assert from "node:assert/strict";
import test from "node:test";
import {
  createDragPhysicsController,
  readPhysicsSourceParameterIds
} from "../src/renderer/pet/live2d/cubism-drag-physics.ts";

function createModel() {
  const values = [0, 0];
  const ids = ["ParamAngleX", "ParamAngleY"];

  return {
    getParameterCount: () => ids.length,
    getParameterId: (index: number) => ({ isEqual: (id: string) => ids[index] === id }),
    getParameterMinimumValue: () => -30,
    getParameterMaximumValue: () => 30,
    getParameterValueByIndex: (index: number) => values[index] ?? 0,
    setParameterValueByIndex: (index: number, value: number) => {
      values[index] = value;
    },
    values
  };
}

function apply(controller: ReturnType<typeof createDragPhysicsController>, model: ReturnType<typeof createModel>): readonly number[] {
  controller.apply(model as never);
  return [...model.values];
}

test("readPhysicsSourceParameterIds returns only declared Parameter sources", () => {
  const physics = {
    PhysicsSettings: [{
      Input: [
        { Source: { Target: "Parameter", Id: "ParamAngleX" } },
        { Source: { Target: "PartOpacity", Id: "ignored" } },
        { Source: { Target: "Parameter", Id: 42 } }
      ]
    }]
  };
  const buffer = new TextEncoder().encode(JSON.stringify(physics)).buffer;

  assert.deepEqual([...readPhysicsSourceParameterIds(buffer)], ["ParamAngleX"]);
});

test("drag physics has zero output before a velocity sample", () => {
  const model = createModel();
  const controller = createDragPhysicsController(model as never, new Set(["ParamAngleX", "ParamAngleY"]));

  controller.start();
  controller.advance(1 / 60);

  assert.deepEqual(apply(controller, model), [0, 0]);
});

test("drag physics normalizes, smooths, and clamps continuous movement", () => {
  const model = createModel();
  const controller = createDragPhysicsController(model as never, new Set(["ParamAngleX", "ParamAngleY"]));

  controller.start();
  controller.sample(0, 0, 0);
  controller.sample(10_000, -10_000, 10);
  controller.advance(1 / 60);
  const [x, y] = apply(controller, model);

  assert.ok(x > 0 && x <= 18);
  assert.ok(y > 0 && y <= 18);
});

test("drag physics follows a direction change without exceeding parameter bounds", () => {
  const model = createModel();
  const controller = createDragPhysicsController(model as never, new Set(["ParamAngleX", "ParamAngleY"]));

  controller.start();
  controller.sample(0, 0, 0);
  controller.sample(200, 0, 20);
  controller.advance(0.1);
  apply(controller, model);
  controller.sample(-200, 0, 40);
  controller.advance(0.1);
  controller.advance(0.1);
  const [x, y] = apply(controller, model);

  assert.ok(x < 0 && x >= -18);
  assert.equal(y, 0);
});

test("drag physics tolerates invalid timestamps and long frame intervals", () => {
  const model = createModel();
  const controller = createDragPhysicsController(model as never, new Set(["ParamAngleX", "ParamAngleY"]));

  controller.start();
  controller.sample(0, 0, 10);
  controller.sample(100, 0, 10);
  controller.sample(100, 0, Number.NaN);
  controller.advance(Number.NaN);
  controller.advance(10);
  const [x, y] = apply(controller, model);

  assert.equal(x, 0);
  assert.equal(y, 0);
});

test("drag physics decays to zero after release", () => {
  const model = createModel();
  const controller = createDragPhysicsController(model as never, new Set(["ParamAngleX", "ParamAngleY"]));

  controller.start();
  controller.sample(0, 0, 0);
  controller.sample(200, 0, 20);
  controller.advance(0.1);
  controller.end();

  for (let index = 0; index < 20; index += 1) {
    controller.advance(0.1);
  }

  const [x] = apply(controller, model);
  assert.ok(Math.abs(x) < 0.001);
});

test("drag physics never writes a parameter absent from physics sources", () => {
  const model = createModel();
  const controller = createDragPhysicsController(model as never, new Set());

  controller.start();
  controller.sample(0, 0, 0);
  controller.sample(200, 0, 20);
  controller.advance(0.1);

  assert.equal(controller.hasInputs(), false);
  assert.deepEqual(apply(controller, model), [0, 0]);
});
