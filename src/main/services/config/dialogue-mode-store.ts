import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_DIALOGUE_MODE_ID,
  parseDialogueModeId,
  type DialogueModeId
} from "../../../shared/dialogue-style";

export type DialogueModeStore = {
  getMode(): DialogueModeId;
  saveMode(modeId: unknown): DialogueModeId;
  getModePath(): string;
};

export function createDialogueModeStore(options: { userDataPath?: string } = {}): DialogueModeStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const modePath = join(userDataPath, "config", "dialogue-mode.json");

  return {
    getMode() {
      if (!existsSync(modePath)) {
        return DEFAULT_DIALOGUE_MODE_ID;
      }

      try {
        const parsed = JSON.parse(readFileSync(modePath, "utf8")) as { modeId?: unknown };
        return parseDialogueModeId(parsed.modeId) ?? DEFAULT_DIALOGUE_MODE_ID;
      } catch {
        return DEFAULT_DIALOGUE_MODE_ID;
      }
    },
    saveMode(value) {
      const modeId = parseDialogueModeId(value);

      if (!modeId) {
        throw new Error("Invalid dialogue mode");
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
