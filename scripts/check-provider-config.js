const fs = require("node:fs");
const path = require("node:path");

const userDataPath = path.resolve(process.argv[2] || path.join(process.cwd(), ".tmp-electron-user-data"));
const configPath = path.join(userDataPath, "config", "provider-config.json");
const secretsPath = path.join(userDataPath, "secrets", "provider-keys.json");

const defaultConfig = {
  providerId: "fake",
  displayName: "Fake Provider"
};

const configResult = readConfig(configPath);
const config = configResult.config;
const apiKeyRef = config.providerId === "openai-compatible" ? config.apiKeyRef : null;
const hasApiKey = apiKeyRef ? readHasApiKey(secretsPath, apiKeyRef) : false;
const hasEndpointConfig = config.providerId === "openai-compatible" || config.providerId === "local-openai-compatible";

console.log(`userDataPath: ${userDataPath}`);
console.log(`configFileExists: ${String(configResult.exists)}`);
console.log(`configSource: ${configResult.source}`);
console.log(`providerId: ${config.providerId}`);
console.log(`baseURL: ${hasEndpointConfig ? config.baseURL : ""}`);
console.log(`model: ${hasEndpointConfig ? config.model : ""}`);
console.log(`apiKeyRef: ${apiKeyRef || ""}`);
console.log(`apiKeyExists: ${String(hasApiKey)}`);

function readConfig(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      source: "default",
      config: defaultConfig
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

    if (isProviderConfig(parsed)) {
      return {
        exists: true,
        source: "file",
        config: parsed
      };
    }
  } catch {
    // Fall through to invalid.
  }

  return {
    exists: true,
    source: "invalid-default",
    config: defaultConfig
  };
}

function readHasApiKey(filePath, apiKeyRef) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const entry = parsed && typeof parsed === "object" ? parsed[apiKeyRef] : null;

    return Boolean(
      entry &&
      typeof entry === "object" &&
      (typeof entry.encrypted === "string" || typeof entry.plainTextDevOnly === "string")
    );
  } catch {
    return false;
  }
}

function isProviderConfig(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (value.providerId === "fake") {
    return typeof value.displayName === "string" && value.displayName.length > 0;
  }

  if (value.providerId === "openai-compatible") {
    return (
      typeof value.displayName === "string" &&
      value.displayName.length > 0 &&
      typeof value.baseURL === "string" &&
      value.baseURL.length > 0 &&
      typeof value.model === "string" &&
      value.model.length > 0 &&
      typeof value.apiKeyRef === "string" &&
      value.apiKeyRef.length > 0 &&
      typeof value.temperature === "number" &&
      Number.isFinite(value.temperature) &&
      typeof value.maxTokens === "number" &&
      Number.isInteger(value.maxTokens) &&
      value.maxTokens > 0 &&
      typeof value.timeoutMs === "number" &&
      Number.isInteger(value.timeoutMs) &&
      value.timeoutMs > 0
    );
  }

  if (value.providerId === "local-openai-compatible") {
    return (
      typeof value.displayName === "string" &&
      value.displayName.length > 0 &&
      typeof value.baseURL === "string" &&
      value.baseURL.length > 0 &&
      typeof value.model === "string" &&
      value.model.length > 0 &&
      typeof value.temperature === "number" &&
      Number.isFinite(value.temperature) &&
      typeof value.maxTokens === "number" &&
      Number.isInteger(value.maxTokens) &&
      value.maxTokens > 0 &&
      typeof value.timeoutMs === "number" &&
      Number.isInteger(value.timeoutMs) &&
      value.timeoutMs > 0
    );
  }

  return false;
}
