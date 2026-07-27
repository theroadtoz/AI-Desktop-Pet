import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveBundledLlamaCppRuntime } = require("../dist/main/services/local-runtime/bundled-llama-cpp-runtime.js");
const { createLlamaCppRuntime } = require("../dist/main/services/local-runtime/llama-cpp-runtime.js");
const { createLocalMemoryExtractor } = require("../dist/main/services/chat/local-memory-extractor.js");

const resolved = resolveBundledLlamaCppRuntime();
if (!resolved.config) {
  console.log(JSON.stringify({ ok: false, status: "not_run", reason: resolved.safeSummary.status, bundledOnly: true }));
  process.exitCode = 0;
} else {
  const runtime = createLlamaCppRuntime(resolved.config);
  try {
    const started = await runtime.start();
    const baseURL = runtime.getBaseURL();
    if (started.status !== "ready" || !baseURL) {
      console.log(JSON.stringify({ ok: false, status: "not_run", reason: started.status, bundledOnly: true }));
      process.exitCode = 0;
    } else {
      const extractor = createLocalMemoryExtractor({
        getTarget: () => ({
          baseURL,
          model: resolved.config.alias ?? "ai-desktop-pet-local",
          localPresetId: "embedded-llama-cpp"
        }),
        timeoutMs: 20_000
      });
      const result = await extractor.extract({
        content: "请记住一条稳定偏好：我始终希望你以后用简体中文回复。",
        conversationId: crypto.randomUUID(),
        messageId: crypto.randomUUID()
      });
      console.log(JSON.stringify({
        ok: result.status === "created",
        status: result.status,
        bundledOnly: true,
        candidateTextLogged: false
      }));
      if (result.status !== "created") process.exitCode = 1;
    }
  } finally {
    await runtime.stop();
  }
}
