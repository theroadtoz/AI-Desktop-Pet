export type UserProfile = {
  displayName: string;
  preferredName?: string;
  completedAt: string;
};

export type UserProfileInput = {
  displayName: string;
  preferredName?: string;
};

export type UserProfilePromptContext = {
  preferredName: string;
};

const DISPLAY_NAME_MAX_LENGTH = 32;
const PREFERRED_NAME_MAX_LENGTH = 32;

export function parseUserProfile(value: unknown): UserProfile | null {
  const profile = value as Partial<UserProfile> | null;
  const displayName = normalizeProfileText(profile?.displayName, DISPLAY_NAME_MAX_LENGTH);
  const preferredName = normalizeOptionalProfileText(profile?.preferredName, PREFERRED_NAME_MAX_LENGTH);

  if (
    !profile ||
    !displayName ||
    preferredName === null ||
    typeof profile.completedAt !== "string" ||
    profile.completedAt.trim().length === 0 ||
    Number.isNaN(Date.parse(profile.completedAt))
  ) {
    return null;
  }

  return {
    displayName,
    ...(preferredName ? { preferredName } : {}),
    completedAt: profile.completedAt
  };
}

export function parseUserProfileInput(value: unknown, completedAt = new Date().toISOString()): UserProfile | null {
  const input = value as Partial<UserProfileInput> | null;
  const displayName = normalizeProfileText(input?.displayName, DISPLAY_NAME_MAX_LENGTH);
  const preferredName = normalizeOptionalProfileText(input?.preferredName, PREFERRED_NAME_MAX_LENGTH);

  if (!input || !displayName || preferredName === null) {
    return null;
  }

  return {
    displayName,
    ...(preferredName ? { preferredName } : {}),
    completedAt
  };
}

export function createUserProfilePromptContext(profile: UserProfile | null): UserProfilePromptContext | undefined {
  if (!profile) {
    return undefined;
  }

  const preferredName = normalizeProfileText(profile.preferredName || profile.displayName, PREFERRED_NAME_MAX_LENGTH);
  return preferredName ? { preferredName } : undefined;
}

function normalizeProfileText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (/[\r\n<>]/.test(value)) {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");

  if (normalized.length === 0 || normalized.length > maxLength) {
    return null;
  }

  return normalized;
}

function normalizeOptionalProfileText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return normalizeProfileText(value, maxLength);
}
