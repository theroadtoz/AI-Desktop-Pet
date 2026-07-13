import type { ModelMotionPreset } from "./model-manifest";

export type PetMotionPresetId = string;

export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze([
  {
    id: "yawn-once",
    path: "motions/yawn-once.motion3.json",
    semanticKind: "sleep",
    loop: false,
    fadeInSeconds: 0.2,
    fadeOutSeconds: 0.2,
    durationHintSeconds: 5.1,
    priority: 50,
    cooldownMs: 2_000,
    restorePolicy: "restore-current-state",
    allowedStates: ["sleep"],
    allowedPresenceModes: ["sleep"],
    allowedDialogueModes: ["default"],
    visualRisk: "needs-visual-check",
    assetLicenseStatus: "user-provided"
  }
]);

export const PET_MOTION_PRESET_IDS: readonly string[] = Object.freeze(
  PET_MOTION_PRESETS.map((preset) => preset.id)
);

export function isPetMotionPresetId(value: unknown): value is PetMotionPresetId {
  return typeof value === "string" && PET_MOTION_PRESET_IDS.includes(value);
}

export function getPetMotionPreset(presetId: PetMotionPresetId): ModelMotionPreset | null {
  return PET_MOTION_PRESETS.find((preset) => preset.id === presetId) ?? null;
}
