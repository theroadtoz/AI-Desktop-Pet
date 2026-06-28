import type { CubismModel } from "./vendor/framework/model/cubismmodel";

export type CubismPoseTarget = {
  bodyAngleX?: number;
  bodyAngleY?: number;
  bodyAngleZ?: number;
  angleZ?: number;
};

type PoseParameter = {
  index: number;
  key: keyof CubismPoseTarget;
  minimum: number;
  maximum: number;
};

const POSE_PARAMETER_DEFS: readonly {
  id: string;
  key: keyof CubismPoseTarget;
  minimum: number;
  maximum: number;
}[] = [
  { id: "ParamBodyAngleX", key: "bodyAngleX", minimum: -10, maximum: 10 },
  { id: "ParamBodyAngleY", key: "bodyAngleY", minimum: -10, maximum: 10 },
  { id: "ParamBodyAngleZ", key: "bodyAngleZ", minimum: -10, maximum: 10 },
  { id: "ParamAngleZ", key: "angleZ", minimum: -12, maximum: 12 }
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function findParameterIndex(model: CubismModel, parameterId: string): number | null {
  for (let index = 0; index < model.getParameterCount(); index += 1) {
    if (model.getParameterId(index).isEqual(parameterId)) {
      return index;
    }
  }

  return null;
}

export class CubismPoseTargetController {
  private readonly parameters: PoseParameter[];
  private target: Required<CubismPoseTarget> = {
    bodyAngleX: 0,
    bodyAngleY: 0,
    bodyAngleZ: 0,
    angleZ: 0
  };
  private current: Required<CubismPoseTarget> = { ...this.target };

  public constructor(model: CubismModel) {
    this.parameters = POSE_PARAMETER_DEFS.flatMap((definition) => {
      const index = findParameterIndex(model, definition.id);

      return index === null
        ? []
        : [{ index, key: definition.key, minimum: definition.minimum, maximum: definition.maximum }];
    });
  }

  public setTarget(target: CubismPoseTarget): void {
    this.target = {
      bodyAngleX: readTargetValue(target.bodyAngleX, -10, 10),
      bodyAngleY: readTargetValue(target.bodyAngleY, -10, 10),
      bodyAngleZ: readTargetValue(target.bodyAngleZ, -10, 10),
      angleZ: readTargetValue(target.angleZ, -12, 12)
    };
  }

  public reset(): void {
    this.setTarget({});
  }

  public update(model: CubismModel, deltaSeconds: number): void {
    if (this.parameters.length === 0) {
      return;
    }

    const smoothing = 1 - Math.exp(-deltaSeconds * 10);

    for (const parameter of this.parameters) {
      const nextValue = this.current[parameter.key] + (this.target[parameter.key] - this.current[parameter.key]) * smoothing;
      const clamped = clamp(nextValue, parameter.minimum, parameter.maximum);
      this.current[parameter.key] = clamped;
      model.setParameterValueByIndex(parameter.index, clamped);
    }
  }
}

function readTargetValue(value: number | undefined, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, minimum, maximum)
    : 0;
}
