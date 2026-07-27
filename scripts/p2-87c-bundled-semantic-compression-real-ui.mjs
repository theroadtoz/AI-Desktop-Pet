import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  resolveBundledLlamaCppRuntime
} = require("../dist/main/services/local-runtime/bundled-llama-cpp-runtime.js");
const {
  createLlamaCppRuntime
} = require("../dist/main/services/local-runtime/llama-cpp-runtime.js");
const {
  summarizeOlderHistoryWithBundledRuntime
} = require("../dist/main/services/chat/chat-context-budget.js");

const resolved = resolveBundledLlamaCppRuntime();
if (!resolved.config) {
  console.log(JSON.stringify({ ok: false, status: "not_run", reason: resolved.safeSummary.status }));
  process.exitCode = 0;
} else {
  const runtime = createLlamaCppRuntime(resolved.config);
  try {
    const started = await runtime.start();
    const baseURL = runtime.getBaseURL();
    if (started.status !== "ready" || !baseURL) {
      console.log(JSON.stringify({ ok: false, status: "not_run", reason: started.status }));
      process.exitCode = 0;
    } else {
      const result = await summarizeOlderHistoryWithBundledRuntime({
        history: [
          { id: crypto.randomUUID(), role: "user", content: "我们决定先保留最近消息，再压缩较早历史。" },
          { id: crypto.randomUUID(), role: "assistant", content: "好的，我会在本机完成，不写入长期记忆。" }
        ],
        getTarget: () => ({
          baseURL,
          model: resolved.config.alias ?? "ai-desktop-pet-local",
          localPresetId: "embedded-llama-cpp"
        }),
        timeoutMs: 20_000
      });
      console.log(JSON.stringify({
        ok: result.status === "created",
        status: result.status,
        bundledOnly: true,
        summaryBodyLogged: false
      }));
      if (result.status !== "created") {
        process.exitCode = 1;
      }
    }
  } finally {
    await runtime.stop();
  }
}
