import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CubismAccessoryController,
  createCubismAccessoryController
} from "../src/renderer/pet/live2d/cubism-accessory-controller.ts";
import { updateCubismFrame } from "../src/renderer/pet/live2d/cubism-frame-pipeline.ts";
import {
  resolvePetAccessorySelection,
  type PetAccessoryId
} from "../src/shared/pet-accessory.ts";

const ACCESSORY_PARAMETER_NAMES = [
  "Param61",
  "Param62",
  "Param64",
  "Param65",
  "Param66",
  "Param71",
  "Param72"
] as const;

const PARAMETER_NAMES = [
  "Param59",
  "Param60",
  ...ACCESSORY_PARAMETER_NAMES,
  "ParamBodyAngleX"
] as const;

type AccessoryParameterName = (typeof ACCESSORY_PARAMETER_NAMES)[number];
type ParameterName = (typeof PARAMETER_NAMES)[number];

class FakeParameterId {
  private readonly value: string;

  public constructor(value: string) {
    this.value = value;
  }

  public isEqual(candidate: string): boolean {
    return this.value === candidate;
  }
}

function createFakeModel() {
  const values = new Map<ParameterName, number>(PARAMETER_NAMES.map((name) => [name, -1]));

  return {
    model: {
      getParameterCount: () => PARAMETER_NAMES.length,
      getParameterId: (index: number) => new FakeParameterId(PARAMETER_NAMES[index] ?? "unknown"),
      getParameterDefaultValue: () => 0,
      getParameterValueByIndex: (index: number) => values.get(PARAMETER_NAMES[index] ?? "Param61") ?? 0,
      setParameterValueByIndex: (index: number, value: number) => {
        const name = PARAMETER_NAMES[index];
        if (name) {
          values.set(name, value);
        }
      },
      loadParameters: () => undefined,
      saveParameters: () => undefined,
      update: () => undefined
    },
    set(name: ParameterName, value: number): void {
      values.set(name, value);
    },
    setAll(value: number): void {
      for (const name of PARAMETER_NAMES) {
        values.set(name, value);
      }
    },
    value(name: ParameterName): number {
      return values.get(name) ?? Number.NaN;
    },
    snapshot(): Record<AccessoryParameterName, number> {
      return Object.fromEntries(ACCESSORY_PARAMETER_NAMES.map((name) => [name, values.get(name) ?? Number.NaN])) as Record<
        AccessoryParameterName,
        number
      >;
    }
  };
}

function selection(accessoryIds: readonly PetAccessoryId[]) {
  return resolvePetAccessorySelection({ userAccessoryIds: accessoryIds });
}

const ZERO_TARGETS: Record<AccessoryParameterName, number> = {
  Param61: 0,
  Param62: 0,
  Param64: 0,
  Param65: 0,
  Param66: 0,
  Param71: 0,
  Param72: 0
};

test("Cubism accessory controller applies the fixed seven-item manifest and zeros unselected parameters", () => {
  const cases: ReadonlyArray<readonly [PetAccessoryId, Partial<Record<AccessoryParameterName, number>>]> = [
    ["ghost", { Param64: 30 }],
    ["bow", { Param65: 30 }],
    ["glasses", { Param66: 30 }],
    ["hat", { Param71: 30 }],
    ["staff", { Param72: 30 }],
    ["game-controller", { Param61: 30, Param62: 0 }],
    ["microphone", { Param61: 0, Param62: 30 }]
  ];

  for (const [accessoryId, expectedTargets] of cases) {
    const fake = createFakeModel();
    const controller = createCubismAccessoryController(fake.model as never);

    controller.setResolvedSelection(selection([accessoryId]));
    controller.update(fake.model as never);

    assert.deepEqual(fake.snapshot(), { ...ZERO_TARGETS, ...expectedTargets }, accessoryId);
  }
});

test("temporary accessories replace only their group and restore the latest resolved selection", () => {
  const fake = createFakeModel();
  const controller = new CubismAccessoryController(fake.model as never);

  controller.setResolvedSelection(selection(["ghost", "bow", "hat", "microphone"]));
  controller.setTemporaryAccessory("staff");
  controller.update(fake.model as never);
  assert.deepEqual(fake.snapshot(), {
    ...ZERO_TARGETS,
    Param64: 30,
    Param65: 30,
    Param71: 30,
    Param72: 30
  });

  controller.setResolvedSelection(resolvePetAccessorySelection({
    userAccessoryIds: ["ghost", "bow", "hat", "game-controller"],
    modeLayer: {
      source: "mode",
      overriddenGroups: ["facewear"],
      accessoryIds: ["glasses"]
    }
  }));
  controller.update(fake.model as never);
  assert.equal(fake.snapshot().Param72, 30, "the active held-prop override remains in force");
  assert.equal(fake.snapshot().Param66, 30, "a non-conflicting mode override remains visible");

  controller.restoreResolvedSelection();
  controller.update(fake.model as never);
  assert.deepEqual(fake.snapshot(), {
    ...ZERO_TARGETS,
    Param61: 30,
    Param64: 30,
    Param65: 30,
    Param66: 30,
    Param71: 30
  });
});

test("the frame-final accessory layer corrects late expression parameter writes and reloads", () => {
  const resolved = selection(["ghost", "bow", "glasses", "hat", "microphone"]);
  const first = createFakeModel();
  const firstController = createCubismAccessoryController(first.model as never);
  firstController.setResolvedSelection(resolved);

  first.setAll(17);
  firstController.update(first.model as never);
  assert.deepEqual(first.snapshot(), {
    ...ZERO_TARGETS,
    Param62: 30,
    Param64: 30,
    Param65: 30,
    Param66: 30,
    Param71: 30
  });

  const reloaded = createFakeModel();
  const reloadedController = createCubismAccessoryController(reloaded.model as never);
  reloadedController.setResolvedSelection(resolved);
  reloadedController.update(reloaded.model as never);
  assert.deepEqual(reloaded.snapshot(), first.snapshot());
});

test("motion-owned eyes, held props, and body survive later layers while other accessories stay persistent", () => {
  const fake = createFakeModel();
  const controller = createCubismAccessoryController(fake.model as never);
  controller.setResolvedSelection(selection(["ghost", "bow", "glasses", "hat", "game-controller"]));

  updateCubismFrame(fake.model as never, 1 / 60, {
    applyMotion: () => {
      fake.set("Param59", 0);
      fake.set("Param60", 30);
      fake.set("Param61", 0);
      fake.set("Param62", 30);
      fake.set("Param72", 0);
      fake.set("ParamBodyAngleX", -12);
      return new Set([
        "Param59",
        "Param60",
        "Param61",
        "Param62",
        "Param72",
        "ParamBodyAngleX"
      ]);
    },
    applyExpression: () => {
      for (const parameterName of PARAMETER_NAMES) {
        fake.set(parameterName, 18);
      }
    },
    applyAccessory: () => controller.update(fake.model as never)
  });

  assert.equal(fake.value("Param59"), 0);
  assert.equal(fake.value("Param60"), 30);
  assert.equal(fake.value("Param61"), 0);
  assert.equal(fake.value("Param62"), 30);
  assert.equal(fake.value("Param72"), 0);
  assert.equal(fake.value("ParamBodyAngleX"), -12);
  assert.deepEqual(fake.snapshot(), {
    Param61: 0,
    Param62: 30,
    Param64: 30,
    Param65: 30,
    Param66: 30,
    Param71: 30,
    Param72: 0
  });
});

test("released ownership restores the latest persistent selection on the next frame", () => {
  const fake = createFakeModel();
  const controller = createCubismAccessoryController(fake.model as never);
  controller.setResolvedSelection(selection(["ghost", "game-controller"]));

  updateCubismFrame(fake.model as never, 1 / 60, {
    applyMotion: () => {
      fake.set("Param61", 0);
      fake.set("Param62", 30);
      fake.set("Param72", 0);
      return new Set(["Param61", "Param62", "Param72"]);
    },
    applyAccessory: () => controller.update(fake.model as never)
  });
  assert.equal(fake.value("Param62"), 30);

  controller.setResolvedSelection(selection(["bow", "staff"]));
  updateCubismFrame(fake.model as never, 1 / 60, {
    applyMotion: () => new Set(),
    applyAccessory: () => controller.update(fake.model as never)
  });

  assert.deepEqual(fake.snapshot(), {
    ...ZERO_TARGETS,
    Param65: 30,
    Param72: 30
  });
});

test("Cubism model wires accessories as an explicit protected frame layer", async () => {
  const source = await readFile(
    new URL("../src/renderer/pet/live2d/cubism-model.ts", import.meta.url),
    "utf8"
  );
  const frameStart = source.indexOf("updateCubismFrame(model, deltaSeconds");
  const frameEnd = source.indexOf("return sample;", frameStart);
  const frameSource = source.slice(frameStart, frameEnd);

  const expressionIndex = frameSource.indexOf("expressionController.update");
  const breathIndex = frameSource.indexOf("breathController?.update");
  const accessoryLayerIndex = frameSource.indexOf("applyAccessory:");
  const accessoryUpdateIndex = frameSource.indexOf("accessoryController?.update");

  assert.ok(expressionIndex >= 0 && expressionIndex < accessoryLayerIndex);
  assert.ok(breathIndex >= 0 && breathIndex < accessoryLayerIndex);
  assert.ok(accessoryLayerIndex >= 0 && accessoryLayerIndex < accessoryUpdateIndex);
  assert.doesNotMatch(frameSource, /retainNonAccessoryMotionParameterIds/u);
});
