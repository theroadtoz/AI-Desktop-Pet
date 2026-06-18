import { app } from "electron";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_LOG_FILES = 5;

export type TelemetryPayload = Record<string, unknown>;

export type TelemetryService = {
  logEvent(type: string, payload?: TelemetryPayload): void;
  getLogDirectory(): string;
};

function createLogName(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `telemetry-${stamp}.jsonl`;
}

function listLogFiles(logDirectory: string): string[] {
  if (!existsSync(logDirectory)) {
    return [];
  }

  return readdirSync(logDirectory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDirectory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
}

function pruneLogs(logDirectory: string): void {
  const staleLogs = listLogFiles(logDirectory).slice(MAX_LOG_FILES);

  for (const file of staleLogs) {
    unlinkSync(file);
  }
}

export function createTelemetryService(): TelemetryService {
  const logDirectory = join(app.getPath("userData"), "logs");
  let currentLogPath = join(logDirectory, createLogName(new Date()));

  function ensureLogFile(): void {
    if (!existsSync(logDirectory)) {
      mkdirSync(logDirectory, { recursive: true });
    }

    if (!existsSync(currentLogPath)) {
      appendFileSync(currentLogPath, "");
      pruneLogs(logDirectory);
      return;
    }

    if (statSync(currentLogPath).size < MAX_LOG_BYTES) {
      return;
    }

    currentLogPath = join(logDirectory, createLogName(new Date()));

    if (!existsSync(currentLogPath)) {
      appendFileSync(currentLogPath, "");
      pruneLogs(logDirectory);
      return;
    }

    const rotatedPath = currentLogPath.replace(/\.jsonl$/, `-${Date.now()}.jsonl`);
    renameSync(currentLogPath, rotatedPath);
    appendFileSync(currentLogPath, "");
    pruneLogs(logDirectory);
  }

  return {
    logEvent(type: string, payload: TelemetryPayload = {}) {
      try {
        ensureLogFile();
        const line = JSON.stringify({
          timestamp: new Date().toISOString(),
          type,
          payload
        });
        appendFileSync(currentLogPath, `${line}\n`);
      } catch (error: unknown) {
        console.warn("[telemetry] failed to write event", {
          type,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    },
    getLogDirectory() {
      return logDirectory;
    }
  };
}
