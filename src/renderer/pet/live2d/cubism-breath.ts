import type { CubismModel } from "./vendor/framework/model/cubismmodel";
import type { CubismBreath } from "./vendor/framework/effect/cubismbreath";
import type { CubismIdHandle } from "./vendor/framework/id/cubismid";

const BREATH_PARAMETER_ID = "ParamBreath";
const BREATH_PEAK = 0.25;
const BREATH_CYCLE_SECONDS = 3.5;

type ParameterId = CubismIdHandle & {
  isEqual(id: string): boolean;
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
  const parameterId = findBreathParameterId(model);

  if (!parameterId) {
    return null;
  }

  const { CubismBreath, BreathParameterData } = await import("./vendor/framework/effect/cubismbreath");
  const breath = CubismBreath.create();

  breath.setParameters([
    new BreathParameterData(parameterId, 0, BREATH_PEAK, BREATH_CYCLE_SECONDS, 1)
  ]);

  return new CubismBreathController(breath);
}
