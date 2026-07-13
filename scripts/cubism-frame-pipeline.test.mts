import assert from "node:assert/strict";
import test from "node:test";
import { updateCubismFrame } from "../src/renderer/pet/live2d/cubism-frame-pipeline.ts";

function createParameterModel(initialValues: Record<string, number>) {
  const parameterIds = Object.keys(initialValues);
  const values = parameterIds.map((parameterId) => initialValues[parameterId]);

  return {
    getParameterCount: () => parameterIds.length,
    getParameterId: (index: number) => ({
      isEqual: (parameterId: string) => parameterIds[index] === parameterId
    }),
    getParameterValueByIndex: (index: number) => values[index],
    setParameterValueByIndex: (index: number, value: number) => {
      values[index] = value;
    },
    loadParameters: () => undefined,
    saveParameters: () => undefined,
    update: () => undefined,
    value(parameterId: string) {
      return values[parameterIds.indexOf(parameterId)];
    }
  };
}

test("updateCubismFrame protects motion-owned parameters from every later layer", () => {
  const model = createParameterModel({ ParamAngleY: 0 });
  const overwriteOwnedParameter = () => model.setParameterValueByIndex(0, -2.2);

  updateCubismFrame(model as never, 1 / 60, {
    applyMotion: () => {
      model.setParameterValueByIndex(0, 15);
      return new Set(["ParamAngleY"]);
    },
    applyLook: overwriteOwnedParameter,
    applyPose: overwriteOwnedParameter,
    applyDrag: overwriteOwnedParameter,
    applyPhysicsInputs: overwriteOwnedParameter,
    evaluatePhysics: overwriteOwnedParameter,
    applyExpression: overwriteOwnedParameter,
    applyMicroExpression: overwriteOwnedParameter,
    applyBreath: overwriteOwnedParameter
  });

  assert.equal(model.value("ParamAngleY"), 15);
});

test("updateCubismFrame keeps non-conflicting writes from protected layers", () => {
  const model = createParameterModel({ ParamAngleY: 0, ParamBodyAngleX: 0 });
  const writeParameters = () => {
    model.setParameterValueByIndex(0, -2.2);
    model.setParameterValueByIndex(1, model.getParameterValueByIndex(1) + 1);
  };

  updateCubismFrame(model as never, 1 / 60, {
    applyMotion: () => {
      model.setParameterValueByIndex(0, 15);
      return new Set(["ParamAngleY"]);
    },
    applyLook: writeParameters,
    evaluatePhysics: writeParameters,
    applyBreath: writeParameters
  });

  assert.equal(model.value("ParamAngleY"), 15);
  assert.equal(model.value("ParamBodyAngleX"), 3);
});

test("updateCubismFrame restores owned parameters when a layer throws", () => {
  const model = createParameterModel({ ParamAngleY: 0, ParamBodyAngleX: 0 });

  assert.throws(
    () => updateCubismFrame(model as never, 1 / 60, {
      applyMotion: () => {
        model.setParameterValueByIndex(0, 15);
        return new Set(["ParamAngleY"]);
      },
      applyExpression: () => {
        model.setParameterValueByIndex(0, -2.2);
        model.setParameterValueByIndex(1, 4);
        throw new Error("expression failed");
      }
    }),
    /expression failed/
  );

  assert.equal(model.value("ParamAngleY"), 15);
  assert.equal(model.value("ParamBodyAngleX"), 4);
});

test("updateCubismFrame runs layers without protection for empty ownership", () => {
  const calls: string[] = [];
  const model = createParameterModel({ ParamAngleY: 0 });

  updateCubismFrame(model as never, 1 / 60, {
    applyMotion: () => new Set<string>(),
    applyLook: () => {
      calls.push("look");
      model.setParameterValueByIndex(0, -2.2);
    },
    applyBreath: () => {
      calls.push("breath");
      model.setParameterValueByIndex(0, 1.5);
    }
  });

  assert.deepEqual(calls, ["look", "breath"]);
  assert.equal(model.value("ParamAngleY"), 1.5);
});

test("updateCubismFrame applies parameter layers in the fixed order", () => {
  const calls: string[] = [];
  const model = {
    getParameterCount: () => 0,
    loadParameters: () => calls.push("load"),
    saveParameters: () => calls.push("save"),
    update: () => calls.push("update")
  };

  updateCubismFrame(model as never, 1 / 60, {
    applyMotion: () => {
      calls.push("motion");
      return new Set<string>();
    },
    applyLook: () => calls.push("look"),
    applyPose: () => calls.push("pose"),
    applyDrag: () => calls.push("drag"),
    applyPhysicsInputs: () => calls.push("physics-inputs"),
    evaluatePhysics: () => calls.push("physics"),
    applyExpression: () => calls.push("expression"),
    applyMicroExpression: () => calls.push("micro-expression"),
    applyBreath: () => calls.push("breath")
  });

  assert.deepEqual(calls, [
    "load",
    "motion",
    "look",
    "pose",
    "drag",
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
    getParameterCount: () => 0,
    loadParameters: () => calls.push("load"),
    saveParameters: () => calls.push("save"),
    update: () => calls.push("update")
  };

  updateCubismFrame(model as never, 1 / 60, {});

  assert.deepEqual(calls, ["load", "save", "update"]);
});
