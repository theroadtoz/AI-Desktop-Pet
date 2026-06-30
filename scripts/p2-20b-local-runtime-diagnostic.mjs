import { fileURLToPath } from "node:url";
import {
  createChatCompletionsURL,
  createModelsURL,
  defaultRuntimeChecks,
  diagnoseLocalRuntimes
} from "../src/main/services/local-runtime/local-model-diagnostic.ts";

export {
  createChatCompletionsURL,
  createModelsURL,
  defaultRuntimeChecks,
  diagnoseLocalRuntimes
};

async function main() {
  const summary = await diagnoseLocalRuntimes();
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.log(JSON.stringify({
      ok: false,
      status: "script_failed",
      recommendedRuntime: "ollama",
      durationMs: 0,
      safeSummaryOnly: true,
      reason: error instanceof Error ? error.name : "unexpected_error",
      runtimes: []
    }, null, 2));
  });
}
