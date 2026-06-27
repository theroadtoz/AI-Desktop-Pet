import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseUserProfile, parseUserProfileInput, type UserProfile } from "../../../shared/user-profile";
import type { TelemetryPayload } from "../telemetry";

type TelemetryLogger = (type: string, payload?: TelemetryPayload) => void;

export type UserProfileStore = {
  getProfile(): UserProfile | null;
  saveProfile(profile: unknown): UserProfile;
  clearProfile(): void;
  getProfilePath(): string;
};

export function createUserProfileStore(options: {
  userDataPath?: string;
  logTelemetry?: TelemetryLogger;
} = {}): UserProfileStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const profilePath = join(userDataPath, "config", "user-profile.json");

  function log(type: string, payload?: TelemetryPayload): void {
    options.logTelemetry?.(type, payload);
  }

  return {
    getProfile() {
      if (!existsSync(profilePath)) {
        log("user_profile_loaded", { source: "default", configured: false });
        return null;
      }

      try {
        const parsed = JSON.parse(readFileSync(profilePath, "utf8")) as unknown;
        const profile = parseUserProfile(parsed);

        if (!profile) {
          log("user_profile_invalid", { source: "file", errorType: "validation" });
          return null;
        }

        log("user_profile_loaded", { source: "file", configured: true });
        return profile;
      } catch (error: unknown) {
        log("user_profile_invalid", {
          source: "file",
          errorType: error instanceof SyntaxError ? "parse" : "read"
        });
        return null;
      }
    },
    saveProfile(value) {
      const profile = parseUserProfileInput(value);

      if (!profile) {
        log("user_profile_invalid", { source: "ipc", errorType: "validation" });
        throw new Error("Invalid user profile");
      }

      mkdirSync(dirname(profilePath), { recursive: true });
      writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
      log("user_profile_saved", { configured: true });
      return profile;
    },
    clearProfile() {
      if (existsSync(profilePath)) {
        rmSync(profilePath);
      }

      log("user_profile_cleared", { configured: false });
    },
    getProfilePath() {
      return profilePath;
    }
  };
}
