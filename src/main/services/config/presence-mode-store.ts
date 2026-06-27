import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_PRESENCE_MODE_ID,
  parsePresenceModeId,
  type PresenceModeId
} from "../../../shared/presence-mode";

export type PresenceModeStore = {
  getMode(): PresenceModeId;
  saveMode(modeId: unknown): PresenceModeId;
  getModePath(): string;
};

export function createPresenceModeStore(options: { userDataPath?: string } = {}): PresenceModeStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const modePath = join(userDataPath, "config", "presence-mode.json");

  return {
    getMode() {
      if (!existsSync(modePath)) {
        return DEFAULT_PRESENCE_MODE_ID;
      }

      try {
        const parsed = JSON.parse(readFileSync(modePath, "utf8")) as { modeId?: unknown };
        return parsePresenceModeId(parsed.modeId) ?? DEFAULT_PRESENCE_MODE_ID;
      } catch {
        return DEFAULT_PRESENCE_MODE_ID;
      }
    },
    saveMode(value) {
      const modeId = parsePresenceModeId(value);

      if (!modeId) {
        throw new Error("Invalid presence mode");
      }

      mkdirSync(dirname(modePath), { recursive: true });
      writeFileSync(modePath, `${JSON.stringify({ modeId }, null, 2)}\n`, "utf8");
      return modeId;
    },
    getModePath() {
      return modePath;
    }
  };
}
