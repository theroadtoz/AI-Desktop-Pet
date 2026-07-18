import type { CubismModel } from "./vendor/framework/model/cubismmodel";

type CubismFrameModel = Pick<
  CubismModel,
  | "getParameterCount"
  | "getParameterId"
  | "getParameterDefaultValue"
  | "getParameterValueByIndex"
  | "setParameterValueByIndex"
  | "loadParameters"
  | "saveParameters"
  | "update"
>;

type ComparableParameterId = {
  isEqual(parameterId: string): boolean;
};

const EMPTY_PARAMETER_IDS: ReadonlySet<string> = new Set();
const previousMotionParameterIdsByModel = new WeakMap<object, ReadonlySet<string>>();

export type CubismFrameLayers = Partial<{
  applyMotion(deltaSeconds: number): ReadonlySet<string>;
  applyLook(deltaSeconds: number): void;
  applyPose(deltaSeconds: number): void;
  applyDrag(deltaSeconds: number): void;
  applyPhysicsInputs(deltaSeconds: number): void;
  evaluatePhysics(deltaSeconds: number): void;
  applyExpression(deltaSeconds: number): void;
  applyMicroExpression(deltaSeconds: number): void;
  applyBreath(deltaSeconds: number): void;
  applyAccessory(deltaSeconds: number): void;
}>;

function findOwnedParameterIndices(
  model: CubismFrameModel,
  ownedParameterIds: ReadonlySet<string>
): number[] {
  if (ownedParameterIds.size === 0) {
    return [];
  }

  const indices: number[] = [];

  for (let index = 0; index < model.getParameterCount(); index += 1) {
    const parameterId = model.getParameterId(index) as ComparableParameterId;

    for (const ownedParameterId of ownedParameterIds) {
      if (parameterId.isEqual(ownedParameterId)) {
        indices.push(index);
        break;
      }
    }
  }

  return indices;
}

function restoreReleasedMotionParameterDefaults(
  model: CubismFrameModel,
  ownedParameterIds: ReadonlySet<string>
): void {
  const previousParameterIds = previousMotionParameterIdsByModel.get(model);

  if (previousParameterIds) {
    const releasedParameterIds = new Set(
      [...previousParameterIds].filter((parameterId) => !ownedParameterIds.has(parameterId))
    );

    for (const index of findOwnedParameterIndices(model, releasedParameterIds)) {
      model.setParameterValueByIndex(index, model.getParameterDefaultValue(index));
    }
  }

  if (ownedParameterIds.size > 0) {
    previousMotionParameterIdsByModel.set(model, new Set(ownedParameterIds));
  } else {
    previousMotionParameterIdsByModel.delete(model);
  }
}

function applyProtectedLayer(
  model: CubismFrameModel,
  ownedParameterIndices: readonly number[],
  deltaSeconds: number,
  applyLayer: ((deltaSeconds: number) => void) | undefined
): void {
  if (!applyLayer) {
    return;
  }

  if (ownedParameterIndices.length === 0) {
    applyLayer(deltaSeconds);
    return;
  }

  const ownedValues = new Map(
    ownedParameterIndices.map((index) => [index, model.getParameterValueByIndex(index)] as const)
  );

  try {
    applyLayer(deltaSeconds);
  } finally {
    for (const [index, value] of ownedValues) {
      model.setParameterValueByIndex(index, value);
    }
  }
}

/**
 * Applies the model's parameter layers in their fixed per-frame order.
 *
 * Saving immediately after physics inputs makes those inputs the next frame's
 * base state while leaving physics, expressions, and breathing as overlays.
 */
export function updateCubismFrame(
  model: CubismFrameModel,
  deltaSeconds: number,
  layers: CubismFrameLayers
): void {
  model.loadParameters();
  const ownedParameterIds = layers.applyMotion?.(deltaSeconds) ?? EMPTY_PARAMETER_IDS;
  restoreReleasedMotionParameterDefaults(model, ownedParameterIds);
  const ownedParameterIndices = findOwnedParameterIndices(model, ownedParameterIds);

  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyLook);
  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyPose);
  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyDrag);
  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyPhysicsInputs);
  model.saveParameters();
  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.evaluatePhysics);
  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyExpression);
  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyMicroExpression);
  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyBreath);
  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyAccessory);
  model.update();
}
