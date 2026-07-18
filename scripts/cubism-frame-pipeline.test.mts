import assert from "node:assert/strict";
import test from "node:test";
import { updateCubismFrame } from "../src/renderer/pet/live2d/cubism-frame-pipeline.ts";

function createParameterModel(
  initialValues: Record<string, number>,
  defaultValues: Record<string, number> = initialValues
) {
  const parameterIds = Object.keys(initialValues);
  const values = parameterIds.map((parameterId) => initialValues[parameterId]);
  const savedValues = [...values];

  return {
    getParameterCount: () => parameterIds.length,
    getParameterId: (index: number) => ({
      isEqual: (parameterId: string) => parameterIds[index] === parameterId
    }),
    getParameterValueByIndex: (index: number) => values[index],
    setParameterValueByIndex: (index: number, value: number) => {
      values[index] = value;
    },
    getParameterDefaultValue: (index: number) => defaultValues[parameterIds[index] ?? ""] ?? 0,
    loadParameters: () => {
      values.splice(0, values.length, ...savedValues);
    },
    saveParameters: () => {
      savedValues.splice(0, savedValues.length, ...values);
    },
    update: () => undefined,
    set(parameterId: string, value: number) {
      values[parameterIds.indexOf(parameterId)] = value;
    },
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

test("updateCubismFrame protects mixed eye, held-prop, arm, and body motion ownership", () => {
  const ownedValues = {
    Param59: 0,
    Param60: 30,
    Param61: 0,
    Param62: 30,
    Param72: 0,
    Param20: 17,
    ParamBodyAngleX: -14
  };
  const model = createParameterModel({ ...ownedValues, Param64: 0 });
  const overwriteMotionParameters = () => {
    for (const parameterId of Object.keys(ownedValues)) {
      model.set(parameterId, -5);
    }
  };

  updateCubismFrame(model as never, 1 / 60, {
    applyMotion: () => {
      for (const [parameterId, value] of Object.entries(ownedValues)) {
        model.set(parameterId, value);
      }
      return new Set(Object.keys(ownedValues));
    },
    applyPose: overwriteMotionParameters,
    evaluatePhysics: overwriteMotionParameters,
    applyExpression: overwriteMotionParameters,
    applyBreath: overwriteMotionParameters,
    applyAccessory: () => {
      overwriteMotionParameters();
      model.set("Param64", 30);
    }
  });

  for (const [parameterId, value] of Object.entries(ownedValues)) {
    assert.equal(model.value(parameterId), value, parameterId);
  }
  assert.equal(model.value("Param64"), 30);
});

test("updateCubismFrame restores released motion parameters before current expression and accessory layers", () => {
  const defaults = {
    Param59: 0,
    Param60: 0,
    Param67: 0,
    Param68: 0,
    Param69: 0,
    Param61: 0,
    Param62: 0,
    Param72: 0
  };
  const model = createParameterModel(defaults, defaults);
  const ownedParameterIds = new Set(Object.keys(defaults));

  updateCubismFrame(model as never, 1 / 60, {
    applyMotion: () => {
      for (const parameterId of ownedParameterIds) {
        model.set(parameterId, 30);
      }
      return ownedParameterIds;
    },
    applyExpression: () => {
      model.set("Param67", 4);
      model.set("Param68", 5);
      model.set("Param69", 6);
    },
    applyAccessory: () => {
      model.set("Param61", 30);
      model.set("Param62", 0);
      model.set("Param72", 0);
    }
  });

  for (const parameterId of ownedParameterIds) {
    assert.equal(model.value(parameterId), 30, parameterId);
  }

  updateCubismFrame(model as never, 1 / 60, {
    applyMotion: () => new Set(),
    applyExpression: () => {
      model.set("Param67", 11);
      model.set("Param68", 12);
      model.set("Param69", 13);
    },
    applyAccessory: () => {
      model.set("Param61", 0);
      model.set("Param62", 0);
      model.set("Param72", 30);
    }
  });

  assert.equal(model.value("Param59"), 0);
  assert.equal(model.value("Param60"), 0);
  assert.equal(model.value("Param67"), 11);
  assert.equal(model.value("Param68"), 12);
  assert.equal(model.value("Param69"), 13);
  assert.equal(model.value("Param61"), 0);
  assert.equal(model.value("Param62"), 0);
  assert.equal(model.value("Param72"), 30);
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
    applyBreath: () => calls.push("breath"),
    applyAccessory: () => calls.push("accessory")
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
    "accessory",
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
