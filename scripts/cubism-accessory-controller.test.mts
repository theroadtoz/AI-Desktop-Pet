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

const PARAMETER_NAMES = [
  "Param61",
  "Param62",
  "Param64",
  "Param65",
  "Param66",
  "Param71",
  "Param72"
] as const;

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
    snapshot(): Record<ParameterName, number> {
      return Object.fromEntries(PARAMETER_NAMES.map((name) => [name, values.get(name) ?? Number.NaN])) as Record<
        ParameterName,
        number
      >;
    }
  };
}

function selection(accessoryIds: readonly PetAccessoryId[]) {
  return resolvePetAccessorySelection({ userAccessoryIds: accessoryIds });
}

const ZERO_TARGETS: Record<ParameterName, number> = {
  Param61: 0,
  Param62: 0,
  Param64: 0,
  Param65: 0,
  Param66: 0,
  Param71: 0,
  Param72: 0
};

test("Cubism accessory controller applies the fixed seven-item manifest and zeros unselected parameters", () => {
  const cases: ReadonlyArray<readonly [PetAccessoryId, Partial<Record<ParameterName, number>>]> = [
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

test("accessory parameters are excluded from native motion ownership", () => {
  const fake = createFakeModel();
  const controller = createCubismAccessoryController(fake.model as never);
  const motionParameterIds = new Set(["ParamAngleX", "Param61", "Param66", "Param72"]);

  assert.deepEqual(
    [...controller.retainNonAccessoryMotionParameterIds(motionParameterIds)],
    ["ParamAngleX"]
  );

  const unrelatedIds = new Set(["ParamAngleX", "ParamBodyAngleY"]);
  assert.equal(controller.retainNonAccessoryMotionParameterIds(unrelatedIds), unrelatedIds);
});

test("accessories remain the final owner when a native motion and expression write the same parameter", () => {
  const fake = createFakeModel();
  const controller = createCubismAccessoryController(fake.model as never);
  controller.setResolvedSelection(selection(["game-controller"]));

  updateCubismFrame(fake.model as never, 1 / 60, {
    applyMotion: () => {
      fake.set("Param61", 9);
      return controller.retainNonAccessoryMotionParameterIds(new Set(["Param61"]));
    },
    applyExpression: () => fake.set("Param61", 18),
    applyBreath: () => controller.update(fake.model as never)
  });

  assert.equal(fake.snapshot().Param61, 30);
  assert.equal(fake.snapshot().Param62, 0);
});

test("Cubism model applies accessories after expression and breath layers in each frame", async () => {
  const source = await readFile(
    new URL("../src/renderer/pet/live2d/cubism-model.ts", import.meta.url),
    "utf8"
  );
  const frameStart = source.indexOf("updateCubismFrame(model, deltaSeconds");
  const frameEnd = source.indexOf("return sample;", frameStart);
  const frameSource = source.slice(frameStart, frameEnd);

  const expressionIndex = frameSource.indexOf("expressionController.update");
  const breathIndex = frameSource.indexOf("breathController?.update");
  const accessoryIndex = frameSource.indexOf("accessoryController?.update");

  assert.ok(expressionIndex >= 0 && expressionIndex < accessoryIndex);
  assert.ok(breathIndex >= 0 && breathIndex < accessoryIndex);
});
