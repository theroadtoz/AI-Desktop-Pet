import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(repoRoot, "dist/main/services/search/baidu-search-mcp-server.js");

await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [resolve(repoRoot, "src/main/services/search/baidu-search-mcp-server.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["node:*"],
  logLevel: "info"
});
