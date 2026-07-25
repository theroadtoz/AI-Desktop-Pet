import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const appSource = readFileSync(new URL("../src/main/app.ts", import.meta.url), "utf8");
const providerSource = readFileSync(
  new URL("../src/main/services/chat/openai-compatible-provider.ts", import.meta.url),
  "utf8"
);
const arbitrationPolicySource = readFileSync(
  new URL("../src/main/services/companion-context/companion-context-arbitration-policy.ts", import.meta.url),
  "utf8"
);
const acceptanceSource = readFileSync(
  new URL("./p2-84-acceptance.mjs", import.meta.url),
  "utf8"
);

test("P2-84 main owns affect lifecycle without renderer or memory state", () => {
  assert.match(appSource, /createDialogueAffectSettingsStore\(\{/);
  assert.match(appSource, /createPerceivedUserAffectTrackerRegistry\(\{/);
  assert.match(appSource, /createBundledLocalUserAffectClassifier\(\{/);
  assert.match(appSource, /createXitaAffectStore\(\{/);
  assert.match(appSource, /createXitaAffectCoordinator\(\{/);
  assert.match(appSource, /xitaAffectCoordinator\?\.tick\(\)/);
  assert.match(appSource, /xitaAffectStore\?\.save\(finalXitaAffectSnapshot\)/);
  assert.doesNotMatch(appSource, /memoryStoreForRequest\.(?:create|update).*affect/i);
  assert.doesNotMatch(appSource, /webContents\.send\([^)]*(?:userAffect|xitaAffect)/i);
});

test("P2-84 inference starts only after Provider and stale epochs fail closed", () => {
  assert.doesNotMatch(appSource, /await userAffectClassifier\.classify/);
  assert.doesNotMatch(appSource, /Promise\.all\(\[[\s\S]*affectResolutionPromise/);
  assert.match(
    appSource,
    /beginRequest\(\s*request\.requestVersion,\s*request\.conversationId\s*\)/
  );
  assert.match(
    appSource,
    /const streamPromise = chatEngineForRequest\.startChatStream\([\s\S]*startBackgroundUserAffectClassification\(affectTurnResolution\.backgroundInference\)/
  );
  assert.match(
    appSource,
    /!currentDialogueAffectSettings\.enabled[\s\S]*logDialogueAffectDecision\("suppressed", "low"\)/
  );
  assert.match(appSource, /identity: classificationIdentity/);
  assert.match(appSource, /affect\.kind === "unknown"[\s\S]*return;/);
  assert.match(
    appSource,
    /const presentation = resolveAffectDialoguePresentation\(\{\s*state: currentSnapshot\.state/
  );
  assert.match(
    appSource,
    /userAffectTrackerRegistry\?\.get\(inference\.conversationId\) !== inference\.tracker/
  );
});

test("P2-84 settings IPC uses the authenticated chat sender and disabling returns calm", () => {
  assert.match(
    appSource,
    /ipcMain\.handle\("dialogueAffect:get-settings", \(event\) => \{\s*if \(!isChatSender\(event\)/
  );
  assert.match(
    appSource,
    /ipcMain\.handle\("dialogueAffect:set-settings", \(event, update: unknown\) => \{\s*if \(!isChatSender\(event\)/
  );
  assert.match(
    appSource,
    /if \(!currentDialogueAffectSettings\.enabled\) \{\s*resetDialogueAffectToCalm\(\)/
  );
  assert.match(
    appSource,
    /createUnknownUserAffect\(Date\.now\(\), "user-correction"\)/
  );
});

test("P2-84 affect actions stay behind chat-open priority and P2-83C", () => {
  assert.match(
    appSource,
    /function resolveDialogueReplyActionReason\(/
  );
  assert.match(
    appSource,
    /const dialogueReplyActionReason = resolveDialogueReplyActionReason\(/
  );
  assert.match(
    appSource,
    /dialogueReplyActionReason === affectPresentation\?\.action\?\.reason/
  );
  const completionStart = appSource.indexOf("const shouldRequestReplyWarmSettle =");
  const completionEnd = appSource.indexOf('logTelemetry("chat_stream_completed"', completionStart);
  const completion = appSource.slice(completionStart, completionEnd);
  assert.equal(
    (completion.match(/requestPetActionTriggerWithResult\(/g) ?? []).length,
    1,
    "reply completion must dispatch at most once"
  );
  assert.doesNotMatch(
    completion,
    /affectActionRequested|if \(!affectActionRequested\)|sendPetActionTrigger\("chat_reply_completed"/
  );
  const resolver = appSource.slice(
    appSource.indexOf("function resolveDialogueReplyActionReason("),
    appSource.indexOf("function syncAutomaticPresenceLifecycle(")
  );
  assert.match(
    resolver,
    /createCompanionContextArbitrationInput\("affect-action"\)/
  );
  assert.match(
    resolver,
    /createCompanionContextArbitrationInput\("reply-completion-action"\)/
  );
  assert.doesNotMatch(resolver, /requestPetActionTriggerWithResult|sendPetActionTrigger/);
  assert.match(
    arbitrationPolicySource,
    /input\.channel === "affect-action"[\s\S]*input\.interaction === "chat-visible"[\s\S]*affect_action_chat_visible/
  );
  assert.match(
    arbitrationPolicySource,
    /input\.channel === "reply-completion-action"[\s\S]*return result\("allow", "allowed", "reply-completion-action"\)/
  );
  assert.match(
    appSource,
    /function requestPetActionTriggerWithResult\([\s\S]*petActionDispatchCoordinator\.dispatch\(reason, policy\)/
  );
});

test("P2-84 production acceptance treats focused chat as an expected pre-coordinator gate", () => {
  assert.match(
    acceptanceSource,
    /actionIntentPresent === true/
  );
  assert.ok(acceptanceSource.includes("checks.focusedChatHasNoAffectCoordinatorDispatch ="));
  assert.ok(acceptanceSource.includes('entry.type === "dialogue_affect_action_dispatch"'));
  assert.ok(acceptanceSource.includes("checks.focusedChatDoesNotStartStateListen ="));
  assert.match(
    acceptanceSource,
    /entry\.type === "pet_interaction_action_started" &&\s*entry\.payload\?\.reason === "state_listen"/
  );
  assert.doesNotMatch(
    acceptanceSource,
    /checks\.affectIntentReachedP283c/
  );
});

test("P2-84 bundled prompts are natural user utterances without answer-shaping instructions", () => {
  for (const prompt of [
    "今天做什么都提不起劲。",
    "今天真的很累。",
    "刚才说“世界末日了”，只是逗你的。",
    "我没有难过，也不焦虑，今天就是下雨了。",
    "刚才那句是开玩笑的，我没有难过。",
    "我有点难过，这是我的感受，不是你的。",
    "西塔，你现在是什么感受？问的是你的感受，不是我的。"
  ]) {
    assert.ok(acceptanceSource.includes(prompt), prompt);
  }
  assert.doesNotMatch(
    acceptanceSource,
    /请在两三句内回应|不需要建议|你轻松接一句|别替我判断情绪|请按这个纠正回应|请只接住|请用第一人称简短回答/
  );
});

test("P2-84 user affect trackers are conversation-bounded and cleared on disable and shutdown", () => {
  assert.match(appSource, /maxEntries: MAX_USER_AFFECT_CONVERSATIONS/);
  assert.match(
    appSource,
    /resolveDialogueAffectForMessage\(\s*request\.conversationId,\s*submittedMessage\.content/
  );
  assert.match(
    appSource,
    /function resetDialogueAffectToCalm\(\): void \{[\s\S]*userAffectTrackerRegistry\?\.clear\(\)/
  );
  assert.match(
    appSource,
    /function quiesceApp\(\): void \{[\s\S]*userAffectTrackerRegistry\?\.clear\(\)[\s\S]*userAffectTrackerRegistry = null/
  );
});

test("P2-84 telemetry helper exposes only coarse safe affect fields", () => {
  const helper = appSource.slice(
    appSource.indexOf("function logDialogueAffectDecision("),
    appSource.indexOf("function resetDialogueAffectToCalm(")
  );
  assert.match(helper, /enabled:/);
  assert.match(helper, /status,/);
  assert.match(helper, /confidenceBand,/);
  assert.match(helper, /transitionReason:/);
  assert.match(helper, /dialogue_affect_action_dispatch/);
  assert.match(helper, /status: result\.accepted \? "accepted" : "suppressed"/);
  assert.match(helper, /reason: result\.accepted \? "accepted" : result\.reason/);
  assert.doesNotMatch(helper, /\bkind\b|\btext\b|\bsource\b|observedAtMs|updatedAtMs|reasoning|timeline/i);
});

test("OpenAI-compatible provider forwards the closed emotional dialogue context id to the mapper", () => {
  assert.match(
    providerSource,
    /input\.request\.webSearchContext,\s*input\.request\.emotionalDialogueContextId/
  );
});

test("OpenAI-compatible wire request contains the fixed emotional dialogue prompt", async () => {
  const require = createRequire(import.meta.url);
  const {
    createOpenAICompatibleProvider
  } = require("../dist/main/services/chat/openai-compatible-provider.js") as typeof import(
    "../src/main/services/chat/openai-compatible-provider"
  );
  const originalFetch = globalThis.fetch;
  let requestBody: { messages?: Array<{ role: string; content: string }> } | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      'data: {"choices":[{"delta":{"content":"收到。"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  };

  try {
    const provider = createOpenAICompatibleProvider({
      providerId: "openai-compatible",
      baseURL: "http://127.0.0.1:12345/v1",
      model: "test-model",
      temperature: 0,
      maxTokens: 32,
      timeoutMs: 1_000
    });
    await provider.streamReply({
      requestVersion: 1,
      conversationId: "p2-84-test",
      messages: [{
        id: "user-1",
        role: "user",
        content: "今天有点累"
      }],
      emotionalDialogueContextId: "quiet-support"
    }, {
      signal: new AbortController().signal,
      onDelta() {}
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    requestBody?.messages?.some(
      (message) => message.content === "本轮语气：本轮安静接住，不擅自判断用户状态。"
    ),
    true
  );
});
test("P2-84 bundled joke acknowledgement requires the first sentence to name the teasing or joke", () => {
  const match = acceptanceSource.match(
    /function hasSemanticJokeAcknowledgement\(reply\) \{\s*return (\/.*\/).test\(reply\);\s*\}/
  );
  assert.ok(match, "joke acknowledgement helper must remain a deterministic regex");
  const acknowledgement = new RegExp(match[1].slice(1, -1));

  for (const reply of [
    "\u539f\u6765\u662f\u5728\u5f00\u73a9\u7b11\u3002",
    "\u4f60\u521a\u624d\u662f\u5728\u9017\u6211\u5440\u3002",
    "\u8fd8\u597d\u53ea\u662f\u73a9\u7b11\uff0c\u5bb3\u6211\u767d\u7d27\u5f20\u4e86\u3002",
    "\u4f60\u8fd9\u662f\u5728\u95f9\u7740\u73a9\u5427\u3002"
  ]) {
    assert.equal(acknowledgement.test(reply), true, reply);
  }

  for (const reply of [
    "\u6536\u5230\u3002",
    "\u660e\u767d\u3002",
    "\u539f\u6765\u3002",
    "\u8fd9\u6837\u554a\u3002",
    "\u4f60\u628a\u6211\u5413\u4e00\u8df3\u3002",
    "\u54c8\u54c8\uff0c\u4f60\u662f\u5728\u95f9\u7740\u73a9\u5427\u3002",
    "\u54c8\u54c8\uff0c\u539f\u6765\u662f\u73a9\u7b11\u3002\u4f60\u8fd8\u771f\u4f1a\u9009\u65f6\u5019\u3002"
  ]) {
    assert.equal(acknowledgement.test(reply), false, reply);
  }
});

test("P2-84 bundled explicit tired accepts heartache while retaining relevance and non-taskifying guards", () => {
  const tiredCase = acceptanceSource.match(
    /caseId: "explicit-tired",[\s\S]*?\n    \},\n    \{\n      caseId: "joke"/
  )?.[0] ?? "";

  assert.match(tiredCase, /relevant:\s*hasAny\(reply, \["累", "疲惫", "困", "歇", "休息", "安静", "陪", "听"\]\)/);
  assert.match(tiredCase, /warmRestrained:\s*hasAny\(reply, \["陪", "听", "在", "安静", "慢慢", "歇", "心疼"\]\)\s*&&\s*!hasTaskifyingReply\(reply\)/);
});
