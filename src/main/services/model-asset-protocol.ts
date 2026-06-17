import { promises as fs } from "node:fs";
import * as path from "node:path";
import { protocol } from "electron";
import { loadModelManifest, type LoadedModelManifest } from "./model-manifest-loader";

const MODEL_ASSET_SCHEME = "pet-model";
const WITCH_MODEL_ID = "witch";

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".json": "application/json",
  ".moc3": "application/octet-stream",
  ".png": "image/png"
};

let isRegistered = false;
let witchManifest: LoadedModelManifest | null = null;

function response(status: number): Response {
  return new Response(null, { status });
}

function decodeRequestPath(url: URL): string | null {
  const encodedPath = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;

  if (encodedPath.length === 0 || encodedPath.endsWith("/")) {
    return null;
  }

  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}

function normalizeRequestPath(relativePath: string): string | null {
  if (
    relativePath.includes("\\") ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    return null;
  }

  const normalized = path.posix.normalize(relativePath);

  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }

  return normalized;
}

function isInsideRoot(sourceRoot: string, assetPath: string): boolean {
  const relativeToRoot = path.relative(sourceRoot, assetPath);

  return relativeToRoot !== "" &&
    !relativeToRoot.startsWith("..") &&
    !path.isAbsolute(relativeToRoot);
}

function resolveAssetPath(manifest: LoadedModelManifest, relativePath: string): string | null {
  const normalized = normalizeRequestPath(relativePath);

  if (!normalized || !manifest.allowedRelativePaths.has(normalized)) {
    return null;
  }

  const assetPath = path.resolve(manifest.sourceRoot, normalized);

  if (!isInsideRoot(manifest.sourceRoot, assetPath)) {
    return null;
  }

  return assetPath;
}

async function handleModelAssetRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.host !== WITCH_MODEL_ID) {
    return response(404);
  }

  const decodedPath = decodeRequestPath(url);

  if (!decodedPath) {
    return response(403);
  }

  const manifest = witchManifest ?? loadModelManifest(WITCH_MODEL_ID);
  witchManifest = manifest;

  const assetPath = resolveAssetPath(manifest, decodedPath);

  if (!assetPath) {
    return response(403);
  }

  const mime = MIME_BY_EXTENSION[path.extname(assetPath).toLowerCase()];

  if (!mime) {
    return response(403);
  }

  let stat;

  try {
    stat = await fs.stat(assetPath);
  } catch {
    return response(404);
  }

  if (!stat.isFile()) {
    return response(403);
  }

  let data;

  try {
    data = await fs.readFile(assetPath);
  } catch {
    return response(404);
  }

  return new Response(data, {
    headers: {
      "content-type": mime,
      "cache-control": "no-store"
    }
  });
}

export function registerModelAssetProtocol(): void {
  if (isRegistered) {
    return;
  }

  protocol.handle(MODEL_ASSET_SCHEME, handleModelAssetRequest);
  isRegistered = true;
}

export function resolveModelAssetUrl(modelId: string, relativePath: string): string {
  const normalized = normalizeRequestPath(relativePath);

  if (!normalized) {
    throw new Error("invalid model asset path");
  }

  const encodedPath = normalized.split("/").map(encodeURIComponent).join("/");

  return `${MODEL_ASSET_SCHEME}://${modelId}/${encodedPath}`;
}
