import type { ModelMotionPreset } from "./model-manifest";

export type PetMotionPresetId = string;

export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze([]);

export const PET_MOTION_PRESET_IDS: readonly string[] = Object.freeze(
  PET_MOTION_PRESETS.map((preset) => preset.id)
);

export function isPetMotionPresetId(value: unknown): value is PetMotionPresetId {
  return typeof value === "string" && PET_MOTION_PRESET_IDS.includes(value);
}

export function getPetMotionPreset(presetId: PetMotionPresetId): ModelMotionPreset | null {
  return PET_MOTION_PRESETS.find((preset) => preset.id === presetId) ?? null;
}
