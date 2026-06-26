import type { EmotionIntensity, EmotionTag } from "../../../shared/emotion";
import type { CubismIdHandle } from "./vendor/framework/id/cubismid";
import type { CubismModel } from "./vendor/framework/model/cubismmodel";

export const MICRO_EXPRESSION_PARAMETER_IDS = [
  "ParamEyeLSmile",
  "ParamEyeRSmile",
  "ParamBrowLY"
] as const;

const MICRO_EXPRESSION_OFFSETS: Readonly<Record<EmotionTag, Readonly<Record<string, number>>>> = {
  neutral: {},
  happy: { ParamEyeLSmile: 0.06, ParamEyeRSmile: 0.06 },
  sad: { ParamBrowLY: -0.05 },
  surprised: { ParamBrowLY: 0.05 },
  confused: { ParamBrowLY: 0.03 },
  angry: { ParamBrowLY: -0.06 }
};

const MICRO_EXPRESSION_INTENSITY_SCALE: Readonly<Record<EmotionIntensity, number>> = {
  low: 0.55,
  medium: 0.82,
  high: 1
};

const MICRO_EXPRESSION_SMOOTHING_PER_SECOND = 12;
const MICRO_EXPRESSION_SETTLE_EPSILON = 0.0001;

type ParameterId = CubismIdHandle & {
  isEqual(id: string): boolean;
};

export type MicroExpressionParameter = Readonly<{
  id: CubismIdHandle;
  name: (typeof MICRO_EXPRESSION_PARAMETER_IDS)[number];
  minimum: number;
  maximum: number;
  base: number;
}>;

type MicroExpressionModel = Pick<
  CubismModel,
  | "getParameterCount"
  | "getParameterId"
  | "getParameterMinimumValue"
  | "getParameterMaximumValue"
  | "getParameterDefaultValue"
  | "setParameterValueById"
>;

export function discoverMicroExpressionParameters(model: MicroExpressionModel): MicroExpressionParameter[] {
  const parameters: MicroExpressionParameter[] = [];

  for (let index = 0; index < model.getParameterCount(); index += 1) {
    const id = model.getParameterId(index) as ParameterId;
    const name = MICRO_EXPRESSION_PARAMETER_IDS.find((candidate) => id.isEqual(candidate));

    if (!name) {
      continue;
    }

    const minimum = model.getParameterMinimumValue(index);
    const maximum = model.getParameterMaximumValue(index);
    const base = model.getParameterDefaultValue(index);

    if (
      !Number.isFinite(minimum) ||
      !Number.isFinite(maximum) ||
      !Number.isFinite(base) ||
      minimum >= maximum ||
      base < minimum ||
      base > maximum
    ) {
      continue;
    }

    parameters.push({ id, name, minimum, maximum, base });
  }

  return parameters;
}

export function calculateMicroExpressionTarget(
  parameter: MicroExpressionParameter,
  normalizedOffset: number
): number {
  const offset = Number.isFinite(normalizedOffset) ? normalizedOffset : 0;
  const target = parameter.base + (parameter.maximum - parameter.minimum) * offset;
  return Math.min(parameter.maximum, Math.max(parameter.minimum, target));
}

export class CubismMicroExpressionController {
  private readonly parameters: readonly MicroExpressionParameter[];
  private readonly currentValues = new Map<CubismIdHandle, number>();
  private readonly targetValues = new Map<CubismIdHandle, number>();
  private active = false;

  public constructor(parameters: readonly MicroExpressionParameter[]) {
    this.parameters = parameters;
    this.resetToBase();
  }

  public setEmotion(emotion: EmotionTag, intensity: EmotionIntensity = "medium"): void {
    this.targetValues.clear();
    const offsets = MICRO_EXPRESSION_OFFSETS[emotion];
    const scale = MICRO_EXPRESSION_INTENSITY_SCALE[intensity];

    for (const parameter of this.parameters) {
      this.targetValues.set(
        parameter.id,
        calculateMicroExpressionTarget(parameter, (offsets[parameter.name] ?? 0) * scale)
      );
    }

    this.active = this.parameters.length > 0 && emotion !== "neutral";
  }

  public clear(immediately = false): void {
    this.active = false;
    this.targetValues.clear();

    for (const parameter of this.parameters) {
      this.targetValues.set(parameter.id, parameter.base);
      if (immediately) {
        this.currentValues.set(parameter.id, parameter.base);
      }
    }
  }

  public update(model: MicroExpressionModel, deltaSeconds: number): void {
    if (this.parameters.length === 0 || (!this.active && this.isAtBase())) {
      return;
    }

    const smoothing = 1 - Math.exp(-MICRO_EXPRESSION_SMOOTHING_PER_SECOND * Math.max(0, deltaSeconds));

    for (const parameter of this.parameters) {
      const current = this.currentValues.get(parameter.id) ?? parameter.base;
      const target = this.targetValues.get(parameter.id) ?? parameter.base;
      const next = current + (target - current) * smoothing;
      const clamped = Math.min(parameter.maximum, Math.max(parameter.minimum, next));

      this.currentValues.set(parameter.id, clamped);
      model.setParameterValueById(parameter.id, clamped);
    }
  }

  public release(): void {
    this.clear(true);
    this.targetValues.clear();
    this.currentValues.clear();
  }

  private resetToBase(): void {
    for (const parameter of this.parameters) {
      this.currentValues.set(parameter.id, parameter.base);
    }
  }

  private isAtBase(): boolean {
    return this.parameters.every((parameter) => {
      const current = this.currentValues.get(parameter.id) ?? parameter.base;
      return Math.abs(current - parameter.base) <= MICRO_EXPRESSION_SETTLE_EPSILON;
    });
  }
}

export function createCubismMicroExpressionController(
  model: MicroExpressionModel
): CubismMicroExpressionController {
  return new CubismMicroExpressionController(discoverMicroExpressionParameters(model));
}
