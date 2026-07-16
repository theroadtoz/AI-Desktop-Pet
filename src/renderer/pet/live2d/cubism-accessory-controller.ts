import type {
  PetAccessoryGroup,
  PetAccessoryId,
  PetAccessoryResolution
} from "../../../shared/pet-accessory";
import type { CubismModel } from "./vendor/framework/model/cubismmodel";

type AccessoryParameterName =
  | "Param61"
  | "Param62"
  | "Param64"
  | "Param65"
  | "Param66"
  | "Param71"
  | "Param72";

type AccessoryManifestEntry = Readonly<{
  group: PetAccessoryGroup;
  targets: Readonly<Partial<Record<AccessoryParameterName, number>>>;
}>;

const ACCESSORY_MANIFEST = {
  ghost: { group: "companion", targets: { Param64: 30 } },
  bow: { group: "attire", targets: { Param65: 30 } },
  glasses: { group: "facewear", targets: { Param66: 30 } },
  hat: { group: "headwear", targets: { Param71: 30 } },
  staff: { group: "held-prop", targets: { Param72: 30 } },
  "game-controller": { group: "held-prop", targets: { Param61: 30, Param62: 0 } },
  microphone: { group: "held-prop", targets: { Param61: 0, Param62: 30 } }
} as const satisfies Readonly<Record<PetAccessoryId, AccessoryManifestEntry>>;

const MANAGED_PARAMETER_NAMES = [
  "Param61",
  "Param62",
  "Param64",
  "Param65",
  "Param66",
  "Param71",
  "Param72"
] as const satisfies readonly AccessoryParameterName[];
const MANAGED_PARAMETER_NAME_SET: ReadonlySet<string> = new Set(MANAGED_PARAMETER_NAMES);

export type CubismTemporaryAccessoryId = Extract<
  PetAccessoryId,
  "staff" | "game-controller" | "glasses"
>;

type ComparableParameterId = {
  isEqual(parameterId: string): boolean;
};

type CubismAccessoryModel = Pick<
  CubismModel,
  "getParameterCount" | "getParameterId" | "setParameterValueByIndex"
>;

type ManagedParameter = Readonly<{
  index: number;
  name: AccessoryParameterName;
}>;

function discoverManagedParameters(model: CubismAccessoryModel): ManagedParameter[] {
  const parameters: ManagedParameter[] = [];

  for (let index = 0; index < model.getParameterCount(); index += 1) {
    const parameterId = model.getParameterId(index) as ComparableParameterId;
    const name = MANAGED_PARAMETER_NAMES.find((candidate) => parameterId.isEqual(candidate));

    if (name) {
      parameters.push({ index, name });
    }
  }

  return parameters;
}

export class CubismAccessoryController {
  private readonly parameters: readonly ManagedParameter[];
  private resolvedAccessoryIds: readonly PetAccessoryId[] = [];
  private temporaryAccessoryId: CubismTemporaryAccessoryId | null = null;

  public constructor(model: CubismAccessoryModel) {
    this.parameters = discoverManagedParameters(model);
  }

  public setResolvedSelection(selection: PetAccessoryResolution): void {
    this.resolvedAccessoryIds = [...selection.accessoryIds];
  }

  public setTemporaryAccessory(accessoryId: CubismTemporaryAccessoryId): void {
    this.temporaryAccessoryId = accessoryId;
  }

  public restoreResolvedSelection(): void {
    this.temporaryAccessoryId = null;
  }

  public retainNonAccessoryMotionParameterIds(
    motionParameterIds: ReadonlySet<string>
  ): ReadonlySet<string> {
    for (const parameterId of motionParameterIds) {
      if (!MANAGED_PARAMETER_NAME_SET.has(parameterId)) {
        continue;
      }

      return new Set(
        [...motionParameterIds].filter((candidate) => !MANAGED_PARAMETER_NAME_SET.has(candidate))
      );
    }

    return motionParameterIds;
  }

  public update(model: CubismAccessoryModel): void {
    const effectiveAccessoryIds = new Set(this.resolvedAccessoryIds);

    if (this.temporaryAccessoryId) {
      const temporaryGroup = ACCESSORY_MANIFEST[this.temporaryAccessoryId].group;

      for (const accessoryId of effectiveAccessoryIds) {
        if (ACCESSORY_MANIFEST[accessoryId].group === temporaryGroup) {
          effectiveAccessoryIds.delete(accessoryId);
        }
      }

      effectiveAccessoryIds.add(this.temporaryAccessoryId);
    }

    const targets: Record<AccessoryParameterName, number> = {
      Param61: 0,
      Param62: 0,
      Param64: 0,
      Param65: 0,
      Param66: 0,
      Param71: 0,
      Param72: 0
    };

    for (const accessoryId of effectiveAccessoryIds) {
      Object.assign(targets, ACCESSORY_MANIFEST[accessoryId].targets);
    }

    for (const parameter of this.parameters) {
      model.setParameterValueByIndex(parameter.index, targets[parameter.name]);
    }
  }
}

export function createCubismAccessoryController(
  model: CubismAccessoryModel
): CubismAccessoryController {
  return new CubismAccessoryController(model);
}
