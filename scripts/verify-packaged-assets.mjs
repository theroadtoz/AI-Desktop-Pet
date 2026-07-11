import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_ENV = "AI_DESKTOP_PET_PACKAGED_ASSETS_ROOT";
const MANIFEST_NAME = "manifest.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;

export function validatePackagedAssets(root) {
  if (!isPlainDirectory(root)) {
    return blocked("packaged_root_missing_or_linked");
  }

  const manifestPath = join(root, MANIFEST_NAME);

  if (!isPlainFile(manifestPath)) {
    return blocked("manifest_missing_or_linked");
  }

  let manifest;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/u, ""));
  } catch {
    return blocked("manifest_invalid_json");
  }

  const entries = readManifestEntries(manifest);

  if (!entries.ok) {
    return blocked(entries.reason);
  }

  const declaredFiles = new Set([pathKey(MANIFEST_NAME)]);

  for (const entry of entries.value) {
    const filePath = resolveSafePath(root, entry.path);

    if (!filePath) {
      return blocked("manifest_unsafe_path");
    }

    if (!isPlainFile(filePath)) {
      return blocked("declared_file_missing_or_linked");
    }

    const file = readFileSync(filePath);

    if (file.byteLength !== entry.sizeBytes) {
      return blocked("size_mismatch");
    }

    if (createHash("sha256").update(file).digest("hex") !== entry.sha256.toLowerCase()) {
      return blocked("sha256_mismatch");
    }

    declaredFiles.add(pathKey(relative(root, filePath)));
  }

  const tree = inspectTree(root);

  if (!tree.ok) {
    return blocked(tree.reason);
  }

  if (tree.files.some((path) => !declaredFiles.has(pathKey(path)))) {
    return blocked("undeclared_file");
  }

  return {
    ok: true,
    status: "ready",
    declaredFileCount: declaredFiles.size
  };
}

function readManifestEntries(manifest) {
  if (!isRecord(manifest) || manifest.version !== 1 || !isRecord(manifest.platforms) || !isRecord(manifest.model)) {
    return { ok: false, reason: "manifest_schema_invalid" };
  }

  const runtime = manifest.platforms[`${process.platform}-${process.arch}`];
  const notices = manifest.licenseNotices;

  if (!isIntegrityEntry(runtime, "executable") || !isIntegrityEntry(manifest.model, "path")) {
    return { ok: false, reason: "manifest_schema_invalid" };
  }

  if (!isRecord(notices) || notices.approved !== true || !isIntegrityEntry(notices, "path")) {
    return { ok: false, reason: "notices_not_approved" };
  }

  if (!Array.isArray(manifest.licenses) || manifest.licenses.length === 0) {
    return { ok: false, reason: "licenses_not_approved" };
  }

  const licenses = [];

  for (const license of manifest.licenses) {
    if (!isRecord(license) || license.approved !== true || !isIntegrityEntry(license, "path")) {
      return { ok: false, reason: "licenses_not_approved" };
    }
    licenses.push(toEntry(license, "path"));
  }

  return {
    ok: true,
    value: [
      toEntry(runtime, "executable"),
      toEntry(manifest.model, "path"),
      toEntry(notices, "path"),
      ...licenses
    ]
  };
}

function isIntegrityEntry(value, pathKeyName) {
  return isRecord(value)
    && typeof value[pathKeyName] === "string"
    && value[pathKeyName].trim().length > 0
    && Number.isInteger(value.sizeBytes)
    && value.sizeBytes >= 0
    && typeof value.sha256 === "string"
    && SHA256_PATTERN.test(value.sha256);
}

function toEntry(value, pathKeyName) {
  return {
    path: value[pathKeyName].trim(),
    sizeBytes: value.sizeBytes,
    sha256: value.sha256
  };
}

function inspectTree(root) {
  const files = [];
  const pending = [{ absolute: root, relative: "" }];

  while (pending.length > 0) {
    const current = pending.pop();

    for (const dirent of readdirSync(current.absolute, { withFileTypes: true })) {
      const absolutePath = join(current.absolute, dirent.name);
      const relativePath = join(current.relative, dirent.name);
      const stat = lstatSync(absolutePath);

      if (stat.isSymbolicLink()) {
        return { ok: false, reason: "symlink_or_junction" };
      }

      if (stat.isDirectory()) {
        pending.push({ absolute: absolutePath, relative: relativePath });
      } else if (stat.isFile()) {
        files.push(relativePath);
      } else {
        return { ok: false, reason: "unsupported_file_type" };
      }
    }
  }

  return { ok: true, files };
}

function resolveSafePath(root, relativePath) {
  if (isAbsolute(relativePath) || relativePath.includes("\0")) {
    return null;
  }

  const normalized = normalize(relativePath);

  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${sep}`)) {
    return null;
  }

  const rootPath = resolve(root);
  const filePath = resolve(rootPath, normalized);
  const relativePathFromRoot = relative(rootPath, filePath);

  return relativePathFromRoot !== ""
    && relativePathFromRoot !== ".."
    && !relativePathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(relativePathFromRoot)
    ? filePath
    : null;
}

function isPlainDirectory(path) {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isPlainFile(path) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pathKey(path) {
  const normalized = normalize(path).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function blocked(reason) {
  return { ok: false, status: "blocked", reason };
}

function main() {
  const root = process.env[ROOT_ENV]?.trim() || process.argv[2]?.trim() || "";
  const result = validatePackagedAssets(root);
  console.log(JSON.stringify({ gate: "verify:packaged-assets", ...result }));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
