import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync
} from "node:fs";
import { join } from "node:path";
import {
  encodePersistentTelemetryEvent,
  type PersistentTelemetryEvent
} from "../../shared/telemetry-contract.ts";

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_LOG_FILES = 5;

export type TelemetryService = {
  logEvent(event: PersistentTelemetryEvent): void;
  getLogDirectory(): string;
};

type TelemetryFileSystem = {
  appendFileSync: typeof appendFileSync;
  existsSync: typeof existsSync;
  mkdirSync: typeof mkdirSync;
  readdirSync: typeof readdirSync;
  renameSync: typeof renameSync;
  statSync: typeof statSync;
  truncateSync: typeof truncateSync;
  unlinkSync: typeof unlinkSync;
};

type TelemetryServiceOptions = {
  userDataPath?: string;
  now?: () => Date;
  fileSystem?: TelemetryFileSystem;
  encodeEvent?: typeof encodePersistentTelemetryEvent;
  warn?: (category: "write_failed") => void;
};

const defaultFileSystem: TelemetryFileSystem = {
  appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, truncateSync, unlinkSync
};

function createLogName(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `telemetry-${stamp}.jsonl`;
}

function listLogFiles(logDirectory: string, fileSystem: TelemetryFileSystem): string[] {
  if (!fileSystem.existsSync(logDirectory)) {
    return [];
  }

  return fileSystem.readdirSync(logDirectory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDirectory, name))
    .sort((left, right) => fileSystem.statSync(right).mtimeMs - fileSystem.statSync(left).mtimeMs);
}

function pruneLogs(logDirectory: string, fileSystem: TelemetryFileSystem): void {
  const staleLogs = listLogFiles(logDirectory, fileSystem).slice(MAX_LOG_FILES);

  for (const file of staleLogs) {
    fileSystem.unlinkSync(file);
  }
}

export function createTelemetryService(options: TelemetryServiceOptions = {}): TelemetryService {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const now = options.now ?? (() => new Date());
  const encodeEvent = options.encodeEvent ?? encodePersistentTelemetryEvent;
  const warn = options.warn ?? (() => console.warn("[telemetry] write_failed"));
  const logDirectory = join(options.userDataPath ?? getDefaultUserDataPath(), "logs");
  let currentLogPath = join(logDirectory, createLogName(now()));
  let prunePending = false;

  function prunePendingLogs(): void {
    if (!prunePending) return;
    pruneLogs(logDirectory, fileSystem);
    prunePending = false;
  }

  function ensureLogFile(nextLineBytes: number): void {
    if (!fileSystem.existsSync(logDirectory)) {
      fileSystem.mkdirSync(logDirectory, { recursive: true });
    }

    prunePendingLogs();

    if (!fileSystem.existsSync(currentLogPath)) {
      fileSystem.appendFileSync(currentLogPath, "");
      prunePending = true;
      prunePendingLogs();
      return;
    }

    if (fileSystem.statSync(currentLogPath).size + nextLineBytes <= MAX_LOG_BYTES) {
      return;
    }

    const nextLogPath = join(logDirectory, createLogName(now()));

    if (!fileSystem.existsSync(nextLogPath)) {
      fileSystem.appendFileSync(nextLogPath, "");
      currentLogPath = nextLogPath;
      prunePending = true;
      prunePendingLogs();
      return;
    }

    const rotatedPath = nextLogPath.replace(/\.jsonl$/, `-${now().getTime()}.jsonl`);
    fileSystem.renameSync(nextLogPath, rotatedPath);
    fileSystem.appendFileSync(nextLogPath, "");
    currentLogPath = nextLogPath;
    prunePending = true;
    prunePendingLogs();
  }

  return {
    logEvent(event: PersistentTelemetryEvent) {
      try {
        const line = encodeEvent(event, now().toISOString());
        if (!line) return;
        const completeLine = `${line}\n`;
        ensureLogFile(Buffer.byteLength(completeLine));
        const appendStartSize = fileSystem.statSync(currentLogPath).size;
        try {
          fileSystem.appendFileSync(currentLogPath, completeLine);
        } catch {
          if (fileSystem.existsSync(currentLogPath) && fileSystem.statSync(currentLogPath).size !== appendStartSize) {
            fileSystem.truncateSync(currentLogPath, appendStartSize);
          }
          throw new Error("append_failed");
        }
      } catch {
        warn("write_failed");
      }
    },
    getLogDirectory() {
      return logDirectory;
    }
  };
}

function getDefaultUserDataPath(): string {
  const electron = require("electron") as { app?: { getPath(name: "userData"): string } };
  if (!electron.app) {
    throw new Error("telemetry requires an Electron userData path");
  }
  return electron.app.getPath("userData");
}
