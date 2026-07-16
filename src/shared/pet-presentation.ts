import {
  getAccessoryIdsForLegacyPreset,
  getLegacyAccessoryPresetId,
  isPetAccessoryPresetId,
  normalizeStoredPetAccessorySelection,
  parsePetAccessorySelection,
  type PetAccessoryId,
  type PetAccessoryPresetId
} from "./pet-accessory.ts";

export const PET_WINDOW_BASE_WIDTH = 420;
export const PET_WINDOW_BASE_HEIGHT = 600;
export const PET_SCALE_MIN = 0.7;
export const PET_SCALE_MAX = 1.35;
export const PET_SCALE_STEP = 0.05;
export const PET_VISIBLE_INSET_RATIO = 0.1;
export const PET_WAIST_RATIO = 0.58;
export const PET_INITIAL_RIGHT_MARGIN_PX = 50;
export const PET_WAIST_BOTTOM_OVERHANG_PX = 96;

export type PetPresentationPreferences = {
  schemaVersion: 2;
  petScale: number;
  accessoryIds: PetAccessoryId[];
};

export type PetPresentationPreferencesView = PetPresentationPreferences & {
  readonly accessoryPresetId: PetAccessoryPresetId;
};

export type PetScaleAdjustmentIntent = {
  steps: -1 | 1;
};

export type PetWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PetVisibleRegion = {
  visibleLeft: number;
  visibleRight: number;
  visibleTop: number;
  visibleBottom: number;
  waistY: number;
};

const DEFAULT_PET_PRESENTATION_PREFERENCES_VALUE: PetPresentationPreferences = {
  schemaVersion: 2,
  petScale: 1,
  accessoryIds: []
};

export const DEFAULT_PET_PRESENTATION_PREFERENCES = Object.defineProperty(
  DEFAULT_PET_PRESENTATION_PREFERENCES_VALUE,
  "accessoryPresetId",
  { value: "none", enumerable: false }
) as PetPresentationPreferencesView;

export function normalizePetScale(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const stepCount = Math.round((value - PET_SCALE_MIN) / PET_SCALE_STEP);
  const normalized = PET_SCALE_MIN + stepCount * PET_SCALE_STEP;

  if (
    normalized < PET_SCALE_MIN ||
    normalized > PET_SCALE_MAX ||
    Math.abs(value - normalized) > Number.EPSILON * 16
  ) {
    return null;
  }

  return Number(normalized.toFixed(2));
}

export function parsePetScaleAdjustmentIntent(value: unknown): PetScaleAdjustmentIntent | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const steps = (value as { steps?: unknown }).steps;
  return steps === -1 || steps === 1 ? { steps } : null;
}

export function getAdjustedPetScale(currentScale: unknown, intent: PetScaleAdjustmentIntent): number | null {
  const normalizedCurrentScale = normalizePetScale(currentScale);

  if (normalizedCurrentScale === null) {
    return null;
  }

  const targetScale = normalizedCurrentScale + intent.steps * PET_SCALE_STEP;
  return Number(Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, targetScale)).toFixed(2));
}

export function canApplyPetScaleAdjustment(options: {
  hasPresentationStore: boolean;
  isChatInteractionActive: boolean;
  isDragging: boolean;
  intent: PetScaleAdjustmentIntent | null;
}): boolean {
  return Boolean(
    options.hasPresentationStore &&
    !options.isChatInteractionActive &&
    !options.isDragging &&
    options.intent
  );
}

export function parsePetPresentationPreferences(value: unknown): PetPresentationPreferences | null {
  const preferences = value as (Partial<PetPresentationPreferences> & { accessoryPresetId?: unknown }) | null;
  const petScale = preferences && typeof preferences === "object"
    ? normalizePetScale(preferences.petScale)
    : null;
  if (petScale === null) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(preferences, "accessoryIds")) {
    const accessoryIds = parsePetAccessorySelection(preferences?.accessoryIds);
    return accessoryIds ? { schemaVersion: 2, petScale, accessoryIds } : null;
  }

  const accessoryIds = isPetAccessoryPresetId(preferences?.accessoryPresetId)
    ? getAccessoryIdsForLegacyPreset(preferences.accessoryPresetId)
    : [];

  return { schemaVersion: 2, petScale, accessoryIds };
}

export function parseStoredPetPresentationPreferences(content: string): PetPresentationPreferences {
  try {
    const value = JSON.parse(content) as {
      petScale?: unknown;
      accessoryIds?: unknown;
      accessoryPresetId?: unknown;
    } | null;
    const petScale = value && typeof value === "object" ? normalizePetScale(value.petScale) : null;
    if (petScale === null) {
      return DEFAULT_PET_PRESENTATION_PREFERENCES;
    }

    const accessoryIds = Object.prototype.hasOwnProperty.call(value, "accessoryIds")
      ? normalizeStoredPetAccessorySelection(value?.accessoryIds)
      : isPetAccessoryPresetId(value?.accessoryPresetId)
        ? getAccessoryIdsForLegacyPreset(value.accessoryPresetId)
        : [];

    return { schemaVersion: 2, petScale, accessoryIds };
  } catch {
    return DEFAULT_PET_PRESENTATION_PREFERENCES;
  }
}

export function toPetPresentationPreferencesView(
  preferences: PetPresentationPreferences
): PetPresentationPreferencesView {
  return {
    ...preferences,
    accessoryPresetId: getLegacyAccessoryPresetId(preferences.accessoryIds)
  };
}

export function calculateScaledPetBounds(
  bounds: PetWindowBounds,
  scale: number,
  workArea: PetWindowBounds
): PetWindowBounds {
  const { width, height } = calculatePetWindowSize(scale, workArea);
  const currentRegion = calculatePetVisibleRegion(bounds);
  const nextRegion = calculatePetVisibleRegion({ width, height });
  const currentCenterX = bounds.x + bounds.width / 2;
  const currentWaistY = bounds.y + currentRegion.waistY;
  const y = Math.round(currentWaistY - nextRegion.waistY);

  return clampPetBounds({ x: Math.round(currentCenterX - width / 2), y, width, height }, workArea);
}

export function calculateInitialPetBounds(scale: number, workArea: PetWindowBounds): PetWindowBounds {
  const { width, height } = calculatePetWindowSize(scale, workArea);
  const visibleRegion = calculatePetVisibleRegion({ width, height });
  const x = workArea.x + workArea.width - PET_INITIAL_RIGHT_MARGIN_PX - visibleRegion.visibleRight;
  const y = workArea.y + workArea.height + PET_WAIST_BOTTOM_OVERHANG_PX - visibleRegion.waistY;

  return clampPetBounds({ x, y, width, height }, workArea);
}

export function clampPetBounds(bounds: PetWindowBounds, workArea: PetWindowBounds): PetWindowBounds {
  const visibleRegion = calculatePetVisibleRegion(bounds);

  return {
    x: clampToRange(
      bounds.x,
      workArea.x - visibleRegion.visibleLeft,
      workArea.x + workArea.width - visibleRegion.visibleRight
    ),
    y: clampToRange(
      bounds.y,
      workArea.y - visibleRegion.visibleTop,
      workArea.y + workArea.height + PET_WAIST_BOTTOM_OVERHANG_PX - visibleRegion.waistY
    ),
    width: bounds.width,
    height: bounds.height
  };
}

export function calculatePetVisibleRegion(bounds: Pick<PetWindowBounds, "width" | "height">): PetVisibleRegion {
  const visibleLeft = bounds.width * PET_VISIBLE_INSET_RATIO;
  const visibleRight = bounds.width * (1 - PET_VISIBLE_INSET_RATIO);
  const visibleTop = bounds.height * PET_VISIBLE_INSET_RATIO;
  const visibleBottom = bounds.height * (1 - PET_VISIBLE_INSET_RATIO);

  return {
    visibleLeft,
    visibleRight,
    visibleTop,
    visibleBottom,
    waistY: visibleTop + (visibleBottom - visibleTop) * PET_WAIST_RATIO
  };
}

function calculatePetWindowSize(scale: number, workArea: PetWindowBounds): Pick<PetWindowBounds, "width" | "height"> {
  const normalizedScale = normalizePetScale(scale) ?? DEFAULT_PET_PRESENTATION_PREFERENCES.petScale;
  const visibleScale = Math.min(
    normalizedScale,
    workArea.width / PET_WINDOW_BASE_WIDTH,
    workArea.height / PET_WINDOW_BASE_HEIGHT
  );

  return {
    width: Math.min(workArea.width, Math.round(PET_WINDOW_BASE_WIDTH * visibleScale)),
    height: Math.min(workArea.height, Math.round(PET_WINDOW_BASE_HEIGHT * visibleScale))
  };
}

function clampToRange(position: number, minimumPosition: number, maximumPosition: number): number {
  const minimumIntegerPosition = Math.ceil(minimumPosition);
  const maximumIntegerPosition = Math.max(minimumIntegerPosition, Math.floor(maximumPosition));
  const roundedPosition = Math.round(position);

  return Math.min(Math.max(roundedPosition, minimumIntegerPosition), maximumIntegerPosition);
}
