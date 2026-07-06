import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("P2-30B runner keeps required real reply count aligned with sent chat turns", () => {
  const source = readFileSync(new URL("./p2-30b-real-local-daily-companion-rhythm-real-ui.mjs", import.meta.url), "utf8");
  const requiredReplyCount = Number(source.match(/const requiredReplyCount = (\d+);/)?.[1] ?? NaN);
  const sentChatTurns = source.match(/const \w+ = await sendMessage\(chat,/g)?.length ?? 0;

  assert.equal(Number.isFinite(requiredReplyCount), true);
  assert.equal(requiredReplyCount, sentChatTurns);
  assert.match(source, /checks\.realRepliesSafe = replySummaries\.length >= requiredReplyCount/);
  assert.match(source, /createProviderChecks\(\{ validation, providerStatus, telemetry, requiredReplyCount \}\)/);
});
