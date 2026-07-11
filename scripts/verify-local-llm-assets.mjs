import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const SOURCE_ROOT_ENV = "AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT";

export function inspectLocalLlmAssets(env = process.env) {
  const root = typeof env[SOURCE_ROOT_ENV] === "string" ? env[SOURCE_ROOT_ENV].trim() : "";

  if (!root) {
    return { status: "blocked", reason: "source_root_not_configured" };
  }

  if (!isDirectory(root)) {
    return { status: "blocked", reason: "configured_root_missing" };
  }

  return isFile(join(root, "manifest.json"))
    ? { status: "validate", root }
    : { status: "blocked", reason: "configured_manifest_missing" };
}

function main() {
  const inspection = inspectLocalLlmAssets();

  if (inspection.status === "blocked") {
    printStatus(inspection);
    process.exitCode = 1;
    return;
  }

  const result = runValidator();

  if (result !== 0) {
    printStatus({ status: "blocked", reason: "candidate_validation_failed" });
    process.exitCode = result ?? 1;
    return;
  }

  printStatus({ status: "ready", reason: "candidate_validation_passed" });
}

function runValidator() {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd run validate:local-llm"]
    : ["run", "validate:local-llm"];
  return spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stdio: "inherit"
  }).status;
}

function printStatus(result) {
  console.log(JSON.stringify({ gate: "verify:local-llm-assets", asset: "local-llm", ...result }));
}

function isDirectory(path) {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
