import { build } from "esbuild";
import { createHash, randomUUID } from "node:crypto";
import { rm, rename, mkdir, readFile, access } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseRoot(argv) {
  if (argv.length === 0) return WORKSPACE_ROOT;
  if (argv.length !== 2 || argv[0] !== "--root" || !argv[1] || argv[1].includes("\0") || !isAbsolute(argv[1])) {
    throw new Error("invalid-chat-preload-root");
  }
  return resolve(argv[1]);
}

function validateBundle(source) {
  const matches = [...source.matchAll(/\brequire\((['"])([^'"]+)\1\)/gu)];
  if (/\bimport\s*\(|\bnode:|file:\/\/|sourceMappingURL/u.test(source)) {
    throw new Error("invalid-chat-preload-runtime-surface");
  }
  if (matches.length !== 1 || matches[0]?.[2] !== "electron" || /\b(?:require|__require)\((?!['"])/u.test(source)) {
    throw new Error("invalid-chat-preload-requires");
  }
}

export async function buildChatPreload(argv = process.argv.slice(2)) {
  const root = parseRoot(argv);
  const entry = join(root, "src", "preload", "chat-preload.ts");
  const outdir = join(root, "dist", "preload");
  const outfile = join(outdir, "chat-preload.js");
  const temporary = join(outdir, `.chat-preload-${randomUUID()}.tmp`);
  await mkdir(outdir, { recursive: true });
  await rm(outfile, { force: true });
  await rm(`${outfile}.map`, { force: true });
  try {
    await build({
      entryPoints: [entry],
      outfile: temporary,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node20",
      external: ["electron"],
      sourcemap: false,
      logLevel: "silent"
    });
    const source = await readFile(temporary, "utf8");
    validateBundle(source);
    try {
      await access(`${temporary}.map`);
      throw new Error("unexpected-chat-preload-source-map");
    } catch (error) {
      if (error instanceof Error && error.message === "unexpected-chat-preload-source-map") throw error;
    }
    await rename(temporary, outfile);
    return { outfile, sha256: createHash("sha256").update(source).digest("hex") };
  } catch (error) {
    await rm(temporary, { force: true });
    await rm(`${temporary}.map`, { force: true });
    await rm(outfile, { force: true });
    await rm(`${outfile}.map`, { force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildChatPreload();
}
