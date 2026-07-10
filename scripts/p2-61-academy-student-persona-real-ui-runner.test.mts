import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runnerSource = readFileSync("scripts/p2-61-academy-student-persona-real-ui.mjs", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};

test("P2-61 runner defines four open-ended single-attempt persona cases", () => {
  const prompts = [...runnerSource.matchAll(/prompt:\s*"([^"]+)"/g)].map((match) => match[1]);

  assert.equal(prompts.length, 4);
  assert.match(runnerSource, /academy-student-life/);
  assert.match(runnerSource, /concrete-fatigue-chat/);
  assert.match(runnerSource, /provider-versus-mcp/);
  assert.match(runnerSource, /language-model-and-mcp/);
  for (const prompt of prompts) {
    assert.doesNotMatch(prompt, /只回答|严格.*回答|逐字|原样|固定格式|不要解释|一句话|短条目/);
  }
  assert.match(runnerSource, /attemptCount:\s*1/);
  assert.match(runnerSource, /completedRequests\.length === cases\.length/);
  assert.doesNotMatch(runnerSource, /maxCaseAttempts|runCaseWithRetries|CASE_ATTEMPTS|for\s*\([^)]*attempt/);
});

test("P2-61 runner checks requested persona behavior with the shared drift detector", () => {
  assert.match(runnerSource, /const \{ hasProviderIdentityDrift \} = require\("\.\.\/dist\/shared\/persona-self-identity\.js"\)/);
  assert.match(runnerSource, /studentLifeConcrete/);
  assert.match(runnerSource, /notCustomerService/);
  assert.match(runnerSource, /providerMeaning/);
  assert.match(runnerSource, /mcpMeaning/);
  assert.match(runnerSource, /mcpWorkflow/);
  assert.match(runnerSource, /!hasProviderIdentityDrift\(reply\)/);
});

test("P2-61 runner records only safe summaries, booleans, and lengths", () => {
  assert.match(runnerSource, /safeSummaryOnly:\s*true/);
  assert.match(runnerSource, /replyLength:\s*reply\.length/);
  assert.match(runnerSource, /checks:\s*result\.checks/);
  assert.match(runnerSource, /checkPrivacy\(serialized, replies\)/);
  assert.doesNotMatch(runnerSource, /(?:reply|prompt|message|content):\s*(?:reply|item\.prompt|message)/);
  assert.doesNotMatch(runnerSource, /lastReply:\s*reply|requestBody\s*:/);
});

test("P2-61 runner proves embedded local-only provider usage and cleanup", () => {
  assert.match(runnerSource, /AI_DESKTOP_PET_PROVIDER:\s*""/);
  assert.match(runnerSource, /AI_DESKTOP_PET_API_KEY:\s*""/);
  assert.match(runnerSource, /providerId === "local-openai-compatible"/);
  assert.match(runnerSource, /isFallback === false/);
  assert.match(runnerSource, /externalHostSeenFalse:\s*telemetry\?\.externalHostSeen === false/);
  assert.match(runnerSource, /assertNoScreenshotResidue\(context\)/);
  assert.match(
    runnerSource,
    /if \(process\.env\.P2_61_KEEP_TMP !== "1"\) \{\s*cleanupRealUiRun\(context\);\s*\}/
  );
  assert.doesNotMatch(
    runnerSource,
    /if \([^)]*process\.exitCode[^)]*\) \{\s*cleanupRealUiRun\(context\);\s*\}/
  );
});

test("package exposes the P2-61 real UI acceptance command with a build", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-61-academy-student-persona-real-ui"],
    "npm run build && node --no-warnings scripts/p2-61-academy-student-persona-real-ui.mjs"
  );
});
