import type { CubismModel } from "./vendor/framework/model/cubismmodel";

type LookParameter = {
  index: number;
  targetValue(x: number, y: number): number;
};

export const LOOK_INPUT_PARAMETER_IDS = [
  "ParamAngleX",
  "ParamAngleY",
  "ParamEyeBallX",
  "ParamEyeBallY"
] as const;

const LOOK_PARAMETER_DEFS: readonly {
  id: string;
  targetValue(x: number, y: number): number;
}[] = [
  { id: LOOK_INPUT_PARAMETER_IDS[0], targetValue: (x) => x * 20 },
  { id: LOOK_INPUT_PARAMETER_IDS[1], targetValue: (_x, y) => y * 10 },
  { id: LOOK_INPUT_PARAMETER_IDS[2], targetValue: (x) => x },
  { id: LOOK_INPUT_PARAMETER_IDS[3], targetValue: (_x, y) => y }
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function findParameterIndex(model: CubismModel, parameterId: string): number | null {
  for (let index = 0; index < model.getParameterCount(); index += 1) {
    if (model.getParameterId(index).isEqual(parameterId)) {
      return index;
    }
  }

  return null;
}

export class CubismLookController {
  private readonly parameters: LookParameter[];
  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;
  private paused = false;

  public constructor(model: CubismModel) {
    this.parameters = LOOK_PARAMETER_DEFS.flatMap((definition) => {
      const index = findParameterIndex(model, definition.id);

      return index === null
        ? []
        : [{ index, targetValue: definition.targetValue }];
    });
  }

  public setTarget(x: number, y: number): void {
    this.targetX = clamp(x, -1, 1);
    this.targetY = clamp(y, -1, 1);
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  public update(model: CubismModel, deltaSeconds: number): void {
    if (this.parameters.length === 0) {
      return;
    }

    const nextTargetX = this.paused ? 0 : this.targetX;
    const nextTargetY = this.paused ? 0 : this.targetY;
    const smoothing = 1 - Math.exp(-deltaSeconds * 12);

    this.currentX += (nextTargetX - this.currentX) * smoothing;
    this.currentY += (nextTargetY - this.currentY) * smoothing;

    for (const parameter of this.parameters) {
      model.setParameterValueByIndex(
        parameter.index,
        parameter.targetValue(this.currentX, this.currentY)
      );
    }
  }
}
