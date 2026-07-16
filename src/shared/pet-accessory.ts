import type { DialogueModeId } from "./dialogue-style.ts";

export const PET_ACCESSORY_GROUPS = [
  "companion",
  "attire",
  "facewear",
  "headwear",
  "held-prop"
] as const;

export type PetAccessoryGroup = (typeof PET_ACCESSORY_GROUPS)[number];

export const PET_ACCESSORY_CATALOG = [
  { id: "ghost", label: "小幽灵", group: "companion", availability: "available" },
  { id: "bow", label: "蝴蝶结", group: "attire", availability: "available" },
  { id: "glasses", label: "眼镜", group: "facewear", availability: "available" },
  { id: "hat", label: "帽子", group: "headwear", availability: "available" },
  { id: "staff", label: "法杖", group: "held-prop", availability: "available" },
  { id: "game-controller", label: "手柄", group: "held-prop", availability: "available" },
  { id: "microphone", label: "麦克风", group: "held-prop", availability: "available" }
] as const;

export type PetAccessoryCatalogItem = (typeof PET_ACCESSORY_CATALOG)[number];
export type PetAccessoryId = PetAccessoryCatalogItem["id"];
export type PetAccessoryAvailability = PetAccessoryCatalogItem["availability"];

export const MAX_PET_ACCESSORY_SELECTION = PET_ACCESSORY_GROUPS.length;
export const DEFAULT_PET_ACCESSORY_IDS: readonly PetAccessoryId[] = [];

export type PetAccessoryPresetId = "none" | "glasses";

export const PET_ACCESSORY_PRESET_IDS = ["none", "glasses"] as const satisfies readonly PetAccessoryPresetId[];

export type PetAccessorySelectionSource = "user" | "mode" | "action";

export type PetAccessoryOverrideLayer<
  Source extends Exclude<PetAccessorySelectionSource, "user"> = Exclude<PetAccessorySelectionSource, "user">
> = Readonly<{
  source: Source;
  overriddenGroups: readonly PetAccessoryGroup[];
  accessoryIds: readonly PetAccessoryId[];
}>;

export type PetAccessoryResolverInput = Readonly<{
  userAccessoryIds: readonly PetAccessoryId[];
  modeLayer?: PetAccessoryOverrideLayer<"mode"> | null;
  actionLayer?: PetAccessoryOverrideLayer<"action"> | null;
}>;

export type PetAccessoryResolution = Readonly<{
  accessoryIds: readonly PetAccessoryId[];
  sourceByGroup: Readonly<Record<PetAccessoryGroup, PetAccessorySelectionSource>>;
}>;

const CATALOG_BY_ID = new Map<PetAccessoryId, PetAccessoryCatalogItem>(
  PET_ACCESSORY_CATALOG.map((item) => [item.id, item])
);

export function isPetAccessoryId(value: unknown): value is PetAccessoryId {
  return typeof value === "string" && CATALOG_BY_ID.has(value as PetAccessoryId);
}

export function isPetAccessoryPresetId(value: unknown): value is PetAccessoryPresetId {
  return typeof value === "string" && PET_ACCESSORY_PRESET_IDS.includes(value as PetAccessoryPresetId);
}

export function getPetAccessoryCatalogItem(id: PetAccessoryId): PetAccessoryCatalogItem {
  return CATALOG_BY_ID.get(id) as PetAccessoryCatalogItem;
}

export function parsePetAccessorySelection(value: unknown): PetAccessoryId[] | null {
  if (!Array.isArray(value) || value.length > MAX_PET_ACCESSORY_SELECTION) {
    return null;
  }

  const ids = new Set<PetAccessoryId>();
  const groups = new Set<PetAccessoryGroup>();

  for (const candidate of value) {
    if (!isPetAccessoryId(candidate) || ids.has(candidate)) {
      return null;
    }

    const group = getPetAccessoryCatalogItem(candidate).group;
    if (groups.has(group)) {
      return null;
    }

    ids.add(candidate);
    groups.add(group);
  }

  return canonicalizeAccessoryIds(ids);
}

export function normalizeStoredPetAccessorySelection(value: unknown): PetAccessoryId[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids = new Set<PetAccessoryId>();
  const groups = new Set<PetAccessoryGroup>();

  for (const candidate of value) {
    if (!isPetAccessoryId(candidate) || ids.has(candidate)) {
      continue;
    }

    const group = getPetAccessoryCatalogItem(candidate).group;
    if (groups.has(group)) {
      continue;
    }

    ids.add(candidate);
    groups.add(group);
  }

  return canonicalizeAccessoryIds(ids);
}

export function getAccessoryIdsForLegacyPreset(presetId: PetAccessoryPresetId): PetAccessoryId[] {
  return presetId === "glasses" ? ["glasses"] : [];
}

export function getLegacyAccessoryPresetId(accessoryIds: readonly PetAccessoryId[]): PetAccessoryPresetId {
  return accessoryIds.includes("glasses") ? "glasses" : "none";
}

export function getPetAccessoryModeLayer(modeId: DialogueModeId): PetAccessoryOverrideLayer<"mode"> | null {
  return modeId === "work"
    ? {
        source: "mode",
        overriddenGroups: ["facewear"],
        accessoryIds: ["glasses"]
      }
    : null;
}

export function resolvePetAccessorySelection(input: PetAccessoryResolverInput): PetAccessoryResolution {
  const userAccessoryIds = parsePetAccessorySelection(input.userAccessoryIds);
  if (!userAccessoryIds) {
    throw new Error("Invalid user accessory selection");
  }

  const selectedByGroup = new Map<PetAccessoryGroup, PetAccessoryId>();
  const sourceByGroup: Record<PetAccessoryGroup, PetAccessorySelectionSource> = {
    companion: "user",
    attire: "user",
    facewear: "user",
    headwear: "user",
    "held-prop": "user"
  };

  for (const id of userAccessoryIds) {
    selectedByGroup.set(getPetAccessoryCatalogItem(id).group, id);
  }

  applyOverrideLayer(input.modeLayer, "mode", selectedByGroup, sourceByGroup);
  applyOverrideLayer(input.actionLayer, "action", selectedByGroup, sourceByGroup);

  return {
    accessoryIds: canonicalizeAccessoryIds(selectedByGroup.values()),
    sourceByGroup
  };
}

export function isPetAccessoryResolution(value: unknown): value is PetAccessoryResolution {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const resolution = value as Partial<PetAccessoryResolution>;
  const accessoryIds = parsePetAccessorySelection(resolution.accessoryIds);
  if (!accessoryIds || !arraysEqual(accessoryIds, resolution.accessoryIds)) {
    return false;
  }

  if (typeof resolution.sourceByGroup !== "object" || resolution.sourceByGroup === null) {
    return false;
  }

  return Object.keys(resolution.sourceByGroup).length === PET_ACCESSORY_GROUPS.length &&
    PET_ACCESSORY_GROUPS.every((group) => {
    const source = resolution.sourceByGroup?.[group];
    return source === "user" || source === "mode" || source === "action";
  });
}

function applyOverrideLayer(
  layer: PetAccessoryOverrideLayer | null | undefined,
  expectedSource: Exclude<PetAccessorySelectionSource, "user">,
  selectedByGroup: Map<PetAccessoryGroup, PetAccessoryId>,
  sourceByGroup: Record<PetAccessoryGroup, PetAccessorySelectionSource>
): void {
  if (!layer) {
    return;
  }

  const accessoryIds = parsePetAccessorySelection(layer.accessoryIds);
  const overriddenGroups = new Set(layer.overriddenGroups);
  if (
    layer.source !== expectedSource ||
    !accessoryIds ||
    overriddenGroups.size !== layer.overriddenGroups.length
  ) {
    throw new Error("Invalid accessory override layer");
  }

  for (const group of overriddenGroups) {
    if (!PET_ACCESSORY_GROUPS.includes(group)) {
      throw new Error("Invalid accessory override layer");
    }
  }

  for (const id of accessoryIds) {
    if (!overriddenGroups.has(getPetAccessoryCatalogItem(id).group)) {
      throw new Error("Accessory override must declare every affected group");
    }
  }

  for (const group of overriddenGroups) {
    selectedByGroup.delete(group);
    sourceByGroup[group] = layer.source;
  }

  for (const id of accessoryIds) {
    selectedByGroup.set(getPetAccessoryCatalogItem(id).group, id);
  }
}

function canonicalizeAccessoryIds(ids: Iterable<PetAccessoryId>): PetAccessoryId[] {
  const selected = new Set(ids);
  return PET_ACCESSORY_CATALOG.flatMap((item) => selected.has(item.id) ? [item.id] : []);
}

function arraysEqual(left: readonly PetAccessoryId[], right: unknown): boolean {
  return Array.isArray(right) &&
    left.length === right.length &&
    left.every((id, index) => id === right[index]);
}
