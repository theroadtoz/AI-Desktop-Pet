import type { CubismModel } from "./vendor/framework/model/cubismmodel";

export const DRAG_PHYSICS_PARAMETER_IDS = ["ParamAngleX", "ParamAngleY"] as const;

const VELOCITY_DEAD_ZONE_DIP_PER_SECOND = 24;
const MAX_VELOCITY_DIP_PER_SECOND = 1_600;
const MAX_PARAMETER_OFFSET = 18;
const VELOCITY_SMOOTHING_PER_SECOND = 16;
const MAX_SAMPLE_INTERVAL_SECONDS = 0.1;
const MIN_SAMPLE_INTERVAL_SECONDS = 1 / 240;
const MAX_FRAME_INTERVAL_SECONDS = 0.1;

type ParameterId = {
  isEqual(id: string): boolean;
};

type PhysicsInputParameter = {
  index: number;
  minimum: number;
  maximum: number;
  axis: "x" | "y";
};

type PhysicsInputModel = Pick<
  CubismModel,
  | "getParameterCount"
  | "getParameterId"
  | "getParameterMinimumValue"
  | "getParameterMaximumValue"
  | "getParameterValueByIndex"
  | "setParameterValueByIndex"
>;

export type DragPhysicsController = {
  start(): void;
  sample(deltaX: number, deltaY: number, timestampMs: number): void;
  end(): void;
  advance(deltaSeconds: number): void;
  apply(model: PhysicsInputModel): void;
  hasInputs(): boolean;
};

type PhysicsJson = {
  PhysicsSettings?: Array<{
    Input?: Array<{
      Source?: {
        Id?: unknown;
        Target?: unknown;
      };
    }>;
  }>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampVelocity(value: number): number {
  if (Math.abs(value) <= VELOCITY_DEAD_ZONE_DIP_PER_SECOND) {
    return 0;
  }

  return clamp(value, -MAX_VELOCITY_DIP_PER_SECOND, MAX_VELOCITY_DIP_PER_SECOND);
}

function findInputParameters(
  model: PhysicsInputModel,
  physicsSourceParameterIds: ReadonlySet<string>
): PhysicsInputParameter[] {
  const definitions: readonly { id: string; axis: "x" | "y" }[] = [
    { id: DRAG_PHYSICS_PARAMETER_IDS[0], axis: "x" },
    { id: DRAG_PHYSICS_PARAMETER_IDS[1], axis: "y" }
  ];

  return definitions.flatMap((definition) => {
    if (!physicsSourceParameterIds.has(definition.id)) {
      return [];
    }

    for (let index = 0; index < model.getParameterCount(); index += 1) {
      const parameterId = model.getParameterId(index) as ParameterId;

      if (parameterId.isEqual(definition.id)) {
        return [{
          index,
          minimum: model.getParameterMinimumValue(index),
          maximum: model.getParameterMaximumValue(index),
          axis: definition.axis
        }];
      }
    }

    return [];
  });
}

/** Returns only parameter IDs explicitly declared as Cubism Physics inputs. */
export function readPhysicsSourceParameterIds(physicsBuffer: ArrayBuffer): Set<string> {
  const physics = JSON.parse(new TextDecoder().decode(physicsBuffer)) as PhysicsJson;
  const sourceIds = new Set<string>();

  for (const setting of physics.PhysicsSettings ?? []) {
    for (const input of setting.Input ?? []) {
      const source = input.Source;

      if (source?.Target === "Parameter" && typeof source.Id === "string") {
        sourceIds.add(source.Id);
      }
    }
  }

  return sourceIds;
}

export function createDragPhysicsController(
  model: PhysicsInputModel,
  physicsSourceParameterIds: ReadonlySet<string>
): DragPhysicsController {
  const parameters = findInputParameters(model, physicsSourceParameterIds);
  let dragging = false;
  let lastSampleTimestampMs: number | null = null;
  let targetVelocityX = 0;
  let targetVelocityY = 0;
  let velocityX = 0;
  let velocityY = 0;

  function offsetForVelocity(velocity: number): number {
    return (velocity / MAX_VELOCITY_DIP_PER_SECOND) * MAX_PARAMETER_OFFSET;
  }

  return {
    start() {
      dragging = true;
      lastSampleTimestampMs = null;
      targetVelocityX = 0;
      targetVelocityY = 0;
    },
    sample(deltaX, deltaY, timestampMs) {
      if (!dragging || !Number.isFinite(timestampMs)) {
        return;
      }

      if (lastSampleTimestampMs === null) {
        lastSampleTimestampMs = timestampMs;
        return;
      }

      const elapsedMs = timestampMs - lastSampleTimestampMs;
      lastSampleTimestampMs = timestampMs;

      if (elapsedMs <= 0) {
        return;
      }

      const intervalSeconds = clamp(
        elapsedMs / 1_000,
        MIN_SAMPLE_INTERVAL_SECONDS,
        MAX_SAMPLE_INTERVAL_SECONDS
      );

      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
        return;
      }

      targetVelocityX = clampVelocity(deltaX / intervalSeconds);
      targetVelocityY = clampVelocity(-deltaY / intervalSeconds);
    },
    end() {
      dragging = false;
      lastSampleTimestampMs = null;
      targetVelocityX = 0;
      targetVelocityY = 0;
    },
    advance(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
        return;
      }

      const intervalSeconds = Math.min(deltaSeconds, MAX_FRAME_INTERVAL_SECONDS);
      const smoothing = 1 - Math.exp(-intervalSeconds * VELOCITY_SMOOTHING_PER_SECOND);
      const nextVelocityX = dragging ? targetVelocityX : 0;
      const nextVelocityY = dragging ? targetVelocityY : 0;

      velocityX += (nextVelocityX - velocityX) * smoothing;
      velocityY += (nextVelocityY - velocityY) * smoothing;
    },
    apply(currentModel) {
      for (const parameter of parameters) {
        const offset = parameter.axis === "x"
          ? offsetForVelocity(velocityX)
          : offsetForVelocity(velocityY);
        const value = currentModel.getParameterValueByIndex(parameter.index) + offset;

        currentModel.setParameterValueByIndex(
          parameter.index,
          clamp(value, parameter.minimum, parameter.maximum)
        );
      }
    },
    hasInputs() {
      return parameters.length > 0;
    }
  };
}
