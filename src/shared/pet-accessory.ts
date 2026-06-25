export const PET_ACCESSORY_PRESETS = [
  {
    id: "none",
    label: "无配件",
    expressionName: null,
    partIds: []
  },
  {
    id: "glasses",
    label: "眼镜",
    expressionName: "glasses",
    partIds: ["Part53"]
  }
] as const;

export type PetAccessoryPreset = typeof PET_ACCESSORY_PRESETS[number];
export type PetAccessoryPresetId = PetAccessoryPreset["id"];

export const DEFAULT_PET_ACCESSORY_PRESET_ID: PetAccessoryPresetId = "none";

export function isPetAccessoryPresetId(value: unknown): value is PetAccessoryPresetId {
  return typeof value === "string" && PET_ACCESSORY_PRESETS.some((preset) => preset.id === value);
}

export function getPetAccessoryPreset(id: PetAccessoryPresetId): PetAccessoryPreset {
  return PET_ACCESSORY_PRESETS.find((preset) => preset.id === id) ?? PET_ACCESSORY_PRESETS[0];
}
