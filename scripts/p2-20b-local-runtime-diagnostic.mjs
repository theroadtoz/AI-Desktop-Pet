import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let diagnosticModule;

try {
  diagnosticModule = require("../dist/main/services/local-runtime/local-model-diagnostic.js");
} catch {
  diagnosticModule = null;
}

export const createChatCompletionsURL = diagnosticModule?.createChatCompletionsURL;
export const createModelsURL = diagnosticModule?.createModelsURL;
export const defaultRuntimeChecks = diagnosticModule?.defaultRuntimeChecks;
export const diagnoseLocalRuntimes = diagnosticModule?.diagnoseLocalRuntimes;

async function main() {
  if (!diagnosticModule) {
    throw new Error("dist_runtime_missing");
  }

  const summary = await diagnoseLocalRuntimes();
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.log(JSON.stringify({
      ok: false,
      status: "script_failed",
      recommendedRuntime: "llama-cpp-bundled",
      durationMs: 0,
      safeSummaryOnly: true,
      reason: error instanceof Error ? error.name : "unexpected_error",
      runtimes: []
    }, null, 2));
  });
}
