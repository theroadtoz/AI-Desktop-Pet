import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const LIVE2D_MANIFEST = join("resources", "models", "witch", "model-manifest.json");
const ALLOWED_SOURCE_DIR = "../../../model";

export function inspectLive2dAssets(repositoryRoot = REPOSITORY_ROOT) {
  const manifestPath = join(repositoryRoot, LIVE2D_MANIFEST);

  if (!isRegularFileWithoutLinks(manifestPath)) {
    return { status: "blocked", reason: "manifest_missing_or_linked" };
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const sourceDir = typeof manifest.sourceDir === "string" ? manifest.sourceDir.trim() : "";

    if (sourceDir !== ALLOWED_SOURCE_DIR || isAbsolute(sourceDir)) {
      return { status: "blocked", reason: "manifest_source_dir_not_allowed" };
    }

    const canonicalRepositoryRoot = realpathSync.native(repositoryRoot);
    const modelRoot = resolve(dirname(manifestPath), sourceDir);

    if (!isDirectoryWithoutLinks(modelRoot)) {
      return { status: "blocked", reason: "model_root_missing_or_linked" };
    }

    const canonicalModelRoot = realpathSync.native(modelRoot);

    if (!isContainedPath(canonicalRepositoryRoot, canonicalModelRoot)) {
      return { status: "blocked", reason: "model_root_outside_repository" };
    }

    const modelTreeFailure = inspectModelTree(modelRoot);

    if (modelTreeFailure) {
      return { status: "blocked", reason: modelTreeFailure };
    }

    return { status: "validate" };
  } catch {
    return { status: "blocked", reason: "manifest_invalid" };
  }
}

function main() {
  const live2d = inspectLive2dAssets();
  printStatus(live2d);

  if (live2d.status === "blocked") {
    process.exitCode = 1;
    return;
  }

  const tests = runNpmScript("test:live2d-local-assets");

  if (tests !== 0) {
    printStatus({ status: "blocked", reason: "asset_tests_failed" });
    process.exitCode = tests ?? 1;
    return;
  }

  printStatus({ status: "ready", reason: "asset_tests_passed" });
}

function runNpmScript(scriptName) {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm.cmd run ${scriptName}`]
    : ["run", scriptName];
  return spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stdio: "inherit"
  }).status;
}

function printStatus(result) {
  console.log(JSON.stringify({ gate: "verify:local-assets", asset: "live2d", ...result }));
}

function isContainedPath(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

function inspectModelTree(modelRoot) {
  const pending = [modelRoot];

  try {
    while (pending.length > 0) {
      const current = pending.pop();

      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const entryPath = join(current, entry.name);
        const stat = lstatSync(entryPath);

        if (stat.isSymbolicLink()) {
          return "model_tree_contains_link";
        }

        if (stat.isDirectory()) {
          pending.push(entryPath);
        } else if (!stat.isFile()) {
          return "model_tree_contains_unsupported_entry";
        }
      }
    }

    return null;
  } catch {
    return "model_tree_unreadable";
  }
}

function isDirectoryWithoutLinks(path) {
  try {
    const stat = lstatSync(path);
    return existsSync(path) && stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isRegularFileWithoutLinks(path) {
  try {
    const stat = lstatSync(path);
    return existsSync(path) && stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
