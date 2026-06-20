import type { CubismModel } from "./vendor/framework/model/cubismmodel";
import type { CubismBreath } from "./vendor/framework/effect/cubismbreath";
import type { CubismIdHandle } from "./vendor/framework/id/cubismid";

const BREATH_PARAMETER_ID = "ParamBreath";
const BREATH_AMPLITUDE_RATIO = 0.08;
const BREATH_CYCLE_SECONDS = 3.5;

type ParameterId = CubismIdHandle & {
  isEqual(id: string): boolean;
};

type BreathParameterConfig = {
  parameterId: CubismIdHandle;
  offset: number;
  peak: number;
};

export function findBreathParameterId(model: Pick<CubismModel, "getParameterCount" | "getParameterId">): CubismIdHandle | null {
  for (let index = 0; index < model.getParameterCount(); index += 1) {
    const parameterId = model.getParameterId(index) as ParameterId;

    if (parameterId.isEqual(BREATH_PARAMETER_ID)) {
      return parameterId;
    }
  }

  return null;
}

export function createBreathParameterConfig(
  model: Pick<
    CubismModel,
    | "getParameterCount"
    | "getParameterId"
    | "getParameterMinimumValue"
    | "getParameterMaximumValue"
    | "getParameterDefaultValue"
  >
): BreathParameterConfig | null {
  for (let index = 0; index < model.getParameterCount(); index += 1) {
    const parameterId = model.getParameterId(index) as ParameterId;

    if (!parameterId.isEqual(BREATH_PARAMETER_ID)) {
      continue;
    }

    const minimum = model.getParameterMinimumValue(index);
    const maximum = model.getParameterMaximumValue(index);
    const range = maximum - minimum;

    if (!Number.isFinite(range) || range <= 0) {
      return null;
    }

    return {
      parameterId,
      offset: (minimum + maximum) / 2 - model.getParameterDefaultValue(index),
      peak: range * BREATH_AMPLITUDE_RATIO
    };
  }

  return null;
}

export class CubismBreathController {
  private breath: CubismBreath | null;

  public constructor(breath: CubismBreath) {
    this.breath = breath;
  }

  public update(model: CubismModel, deltaSeconds: number): void {
    this.breath?.updateParameters(model, deltaSeconds);
  }

  public release(): void {
    this.breath = null;
  }
}

export async function createCubismBreathController(model: CubismModel): Promise<CubismBreathController | null> {
  const config = createBreathParameterConfig(model);

  if (!config) {
    return null;
  }

  const { CubismBreath, BreathParameterData } = await import("./vendor/framework/effect/cubismbreath");
  const breath = CubismBreath.create();

  breath.setParameters([
    new BreathParameterData(
      config.parameterId,
      config.offset,
      config.peak,
      BREATH_CYCLE_SECONDS,
      1
    )
  ]);

  return new CubismBreathController(breath);
}
