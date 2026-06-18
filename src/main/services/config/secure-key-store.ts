import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TelemetryPayload } from "../telemetry";

type StoredKey = {
  encrypted?: string;
  plainTextDevOnly?: string;
};

type KeyStoreFile = Record<string, StoredKey>;

type TelemetryLogger = (type: string, payload?: TelemetryPayload) => void;

export type SecureKeyStore = {
  setApiKey(apiKeyRef: string, apiKey: string): void;
  getApiKey(apiKeyRef: string): string | null;
  hasApiKey(apiKeyRef: string): boolean;
  deleteApiKey(apiKeyRef: string): boolean;
  getStorePath(): string;
};

export function createSecureKeyStore(options: {
  userDataPath?: string;
  logTelemetry?: TelemetryLogger;
} = {}): SecureKeyStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const storePath = join(userDataPath, "secrets", "provider-keys.json");

  function log(type: string, payload?: TelemetryPayload): void {
    options.logTelemetry?.(type, payload);
  }

  function readStore(): KeyStoreFile {
    if (!existsSync(storePath)) {
      return {};
    }

    try {
      const parsed = JSON.parse(readFileSync(storePath, "utf8")) as unknown;
      return isKeyStoreFile(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeStore(store: KeyStoreFile): void {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  return {
    setApiKey(apiKeyRef, apiKey) {
      assertValidApiKeyRef(apiKeyRef);

      if (typeof apiKey !== "string" || apiKey.length === 0) {
        throw new Error("Invalid API key");
      }

      const store = readStore();

      if (safeStorage.isEncryptionAvailable()) {
        store[apiKeyRef] = {
          encrypted: safeStorage.encryptString(apiKey).toString("base64")
        };
      } else {
        console.warn("[secure-key-store] safeStorage encryption is unavailable; using dev-only plaintext fallback");
        log("secure_key_store_unencrypted_fallback", { apiKeyRef });
        store[apiKeyRef] = {
          plainTextDevOnly: apiKey
        };
      }

      writeStore(store);
      log("secure_key_saved", { apiKeyRef, hasApiKey: true });
    },
    getApiKey(apiKeyRef) {
      assertValidApiKeyRef(apiKeyRef);

      const entry = readStore()[apiKeyRef];

      if (!entry) {
        return null;
      }

      if (entry.encrypted) {
        try {
          return safeStorage.decryptString(Buffer.from(entry.encrypted, "base64"));
        } catch {
          return null;
        }
      }

      if (entry.plainTextDevOnly && !safeStorage.isEncryptionAvailable()) {
        return entry.plainTextDevOnly;
      }

      return null;
    },
    hasApiKey(apiKeyRef) {
      return this.getApiKey(apiKeyRef) !== null;
    },
    deleteApiKey(apiKeyRef) {
      assertValidApiKeyRef(apiKeyRef);

      const store = readStore();

      if (!Object.prototype.hasOwnProperty.call(store, apiKeyRef)) {
        return false;
      }

      delete store[apiKeyRef];
      writeStore(store);
      log("secure_key_deleted", { apiKeyRef, hasApiKey: false });
      return true;
    },
    getStorePath() {
      return storePath;
    }
  };
}

function assertValidApiKeyRef(apiKeyRef: string): void {
  if (!/^[a-zA-Z0-9_.:-]+$/.test(apiKeyRef)) {
    throw new Error("Invalid API key ref");
  }
}

function isKeyStoreFile(value: unknown): value is KeyStoreFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => (
    Boolean(
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (
        typeof (entry as StoredKey).encrypted === "string" ||
        typeof (entry as StoredKey).plainTextDevOnly === "string"
      )
    )
  ));
}

