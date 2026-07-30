export const CURIOUS_FOCUS_PULSE_PROFILE = Object.freeze({
  schemaVersion: 1,
  id: "curious-focus-pulse-v1",
  status: "candidate",
  durationMs: 1150,
  lookTarget: Object.freeze([
    Object.freeze({ atMs: 0, x: 0, y: 0 }),
    Object.freeze({ atMs: 160, x: 0.18, y: 0.1 }),
    Object.freeze({ atMs: 620, x: 0.05, y: 0.03 })
  ])
});

const CURIOUS_FOCUS_PULSE_PROFILE_DIGEST = "64bf0f937bcc34876cc86565bd4c9b5e5619ad6d7ce84fc203b6a883bd02dd22";

export function getCuriousFocusPulseProfileDigest(): string {
  return CURIOUS_FOCUS_PULSE_PROFILE_DIGEST;
}

export function isCuriousFocusPulseProfile(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const expectedKeys = ["schemaVersion", "id", "status", "durationMs", "lookTarget"];
  if (
    Object.keys(candidate).length !== expectedKeys.length ||
    expectedKeys.some((key) => !(key in candidate)) ||
    candidate.schemaVersion !== 1 ||
    candidate.id !== "curious-focus-pulse-v1" ||
    candidate.status !== "candidate" ||
    candidate.durationMs !== 1150 ||
    !Array.isArray(candidate.lookTarget) ||
    candidate.lookTarget.length !== CURIOUS_FOCUS_PULSE_PROFILE.lookTarget.length
  ) {
    return false;
  }

  return candidate.lookTarget.every((point, index) => {
    if (!point || typeof point !== "object" || Array.isArray(point)) {
      return false;
    }
    const actual = point as Record<string, unknown>;
    const expected = CURIOUS_FOCUS_PULSE_PROFILE.lookTarget[index]!;
    return (
      Object.keys(actual).length === 3 &&
      actual.atMs === expected.atMs &&
      actual.x === expected.x &&
      actual.y === expected.y &&
      Number.isFinite(actual.atMs) &&
      Number.isFinite(actual.x) &&
      Number.isFinite(actual.y)
    );
  });
}
