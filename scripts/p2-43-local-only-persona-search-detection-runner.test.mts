import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/p2-43-local-only-persona-search-detection-real-ui.mjs", "utf8");

test("P2-43 runner starts with local-only provider env and clears cloud env", () => {
  assert.match(source, /AI_DESKTOP_PET_PROVIDER:\s*""/);
  assert.match(source, /AI_DESKTOP_PET_API_KEY:\s*""/);
  assert.match(source, /AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT:\s*packRoot/);
  assert.doesNotMatch(source, /AI_DESKTOP_PET_PROVIDER:\s*"fake"/);
});

test("P2-43 runner verifies UI has no external provider option or API key path", () => {
  assert.match(source, /openai-compatible/);
  assert.match(source, /uiNoExternalProviderOption/);
  assert.match(source, /uiNoApiKeyPath/);
  assert.match(source, /provider-reset-local-button/);
});

test("P2-43 runner uses fake MCP only for safe query and safe result summaries", () => {
  assert.match(source, /FAKE_P2_43_MCP_RESULT/);
  assert.match(source, /safeQueryOnly/);
  assert.match(source, /private@example\.com/);
  assert.match(source, /memoryContext\|providerMessages\|prompt\|messages\|content\|apiKey/);
  assert.doesNotMatch(source, /BRAVE_API_KEY\s*=/);
});

test("P2-43 runner result writer avoids full replies and provider request bodies", () => {
  assert.match(source, /safeSummaryOnly/);
  assert.match(source, /replyLength/);
  assert.doesNotMatch(source, /lastReply:\s*reply/);
  assert.doesNotMatch(source, /requestBody\s*:/);
});
