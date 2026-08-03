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
const {
  BUNDLED_FALLBACK_STAGES,
  BUNDLED_SETUP_STAGES,
  BUNDLED_RUN_STAGES,
  classifyJokeAcknowledgement,
  hasFirstSentenceSemanticJokeAcknowledgement,
  hasSemanticJokeAcknowledgement,
  createBundledFallbackDiagnostic,
  createBundledSetupFailureDiagnostic,
  finalizeBundledRun,
  createJokeAcknowledgementDiagnosticCounts,
  recordJokeAcknowledgementDiagnostic
} = await import(new URL("./p2-84-acceptance.mjs", import.meta.url).href);

test("P2-86C acceptance entry runs only after its runtime declarations initialize", () => {
  const entry = acceptanceSource.lastIndexOf("if (isMainModule()) {");
  assert.ok(entry > -1, "direct-execution entry must exist");

  for (const declaration of [
    "export const BUNDLED_FALLBACK_STAGES",
    "export const BUNDLED_SETUP_STAGES",
    "export const BUNDLED_RUN_STAGES",
    "const JOKE_ACKNOWLEDGEMENT_CATEGORIES",
    "function isMainModule()",
    "function readPositiveInteger(value)"
  ]) {
    assert.ok(
      acceptanceSource.indexOf(declaration) < entry,
      `${declaration} must initialize before the direct-execution entry`
    );
  }

  assert.match(
    acceptanceSource.slice(entry),
    /^if \(isMainModule\(\)\) \{\s*await main\(\);\s*\}\s*$/
  );
});

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
    "我的魔导笔记被风卷走了。骗你的，刚才只是说笑。",
    "我把传送门开到教室天花板上了，闹着玩的。",
    "西塔，我把你桌面的星星都拿走了，开玩笑的。",
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
test("P2-86C bundled jokes require a first-sentence closed acknowledgement without fixed openings", () => {
  assert.match(
    acceptanceSource,
    /export function hasSemanticJokeAcknowledgement\(reply\) \{[\s\S]*EXPLICIT_JOKE_MARKER\.test\(opening\) \|\| hasFirstSentenceSemanticJokeAcknowledgement\(opening\);\s*\}/
  );
  assert.match(acceptanceSource, /function firstSentence\(reply\)/);
  assert.doesNotMatch(acceptanceSource, /\^\(\?:原来\|还好\|你刚才\|你这是\)/);
});

test("P2-86C Xita-targeted teasing helper accepts only its first-sentence closed set", () => {
  for (const sentence of [
    "这下骗我了。",
    "可把我骗到了。",
    "你又捉弄我一下。",
    "真把我耍了。",
    "你这是唬我一下。",
    "可别吓唬我了。",
    "这回吓到我一下。",
    "你把我吓了一跳。"
  ]) {
    assert.equal(hasFirstSentenceSemanticJokeAcknowledgement(sentence), true, sentence);
  }

  for (const sentence of [
    "哈哈。",
    "原来。",
    "收到。",
    "这样啊。",
    "吓一跳。",
    "是假的。",
    "你在骗人。",
    "捉弄别人可不好。"
  ]) {
    assert.equal(hasFirstSentenceSemanticJokeAcknowledgement(sentence), false, sentence);
  }

  assert.equal(hasSemanticJokeAcknowledgement("平静一下。你刚才是在骗我。"), false);
});

test("P2-86C joke acknowledgement diagnostic classifies only the conservative closed set", () => {
  assert.equal(classifyJokeAcknowledgement("原来是在开玩笑。"), "first_sentence_explicit_marker");
  assert.equal(classifyJokeAcknowledgement("可把我骗到了。"), "first_sentence_semantic_ack");
  assert.equal(classifyJokeAcknowledgement("你把我吓了一跳。"), "first_sentence_semantic_ack");
  assert.equal(classifyJokeAcknowledgement("这样啊。原来是玩笑。"), "later_sentence_explicit_marker");

  for (const reply of ["哈哈。", "原来。", "收到。", "这样啊。"] ) {
    assert.equal(classifyJokeAcknowledgement(reply), "ambiguous_generic", reply);
  }

  for (const reply of ["吓一跳。", "是假的。", "你在骗人。", "捉弄别人可不好。", "平静一下。你刚才是在骗我。", "我会在这里陪你。"]) {
    assert.equal(classifyJokeAcknowledgement(reply), "absent", reply);
  }
});

test("P2-86C joke acknowledgement diagnostic exposes aggregate counters only", () => {
  const counts = createJokeAcknowledgementDiagnosticCounts();
  recordJokeAcknowledgementDiagnostic(counts, "first_sentence_explicit_marker");
  recordJokeAcknowledgementDiagnostic(counts, "first_sentence_semantic_ack");
  recordJokeAcknowledgementDiagnostic(counts, "unknown_category");

  assert.deepEqual(counts, {
    first_sentence_explicit_marker: 1,
    first_sentence_semantic_ack: 1,
    later_sentence_explicit_marker: 0,
    ambiguous_generic: 0,
    absent: 0
  });
  assert.match(acceptanceSource, /jokeAcknowledgementDiagnostics,\s*checks,/);
  assert.doesNotMatch(
    acceptanceSource,
    /jokeAcknowledgementDiagnostics:\s*\{[\s\S]*?\b(?:reply|firstSentence|opening|hash)\s*:/
  );
});

test("P2-86C bundled joke diversity outputs only aggregate safe evidence", () => {
  assert.equal((acceptanceSource.match(/caseId: "joke-/g) ?? []).length, 4);
  assert.match(acceptanceSource, /openingVariantCount: new Set\(jokeOpeningVariants\)\.size/);
  assert.match(acceptanceSource, /fixedOpeningDetected: jokeOpeningVariants\.length > 1 && new Set\(jokeOpeningVariants\)\.size === 1/);
  assert.match(acceptanceSource, /checks\.jokeOpeningDiversity = new Set\(jokeOpeningVariants\)\.size > 1/);
  assert.doesNotMatch(acceptanceSource, /jokeDiversity:\s*\{[\s\S]*?\breply\s*:/);
});

test("P2-86C bundled pre-Electron setup diagnostics use a closed opaque contract", () => {
  assert.deepEqual(BUNDLED_SETUP_STAGES, [
    "validation",
    "port",
    "context",
    "diagnostic_init"
  ]);
  for (const stage of BUNDLED_SETUP_STAGES) {
    assert.deepEqual(
      createBundledSetupFailureDiagnostic(stage, new TypeError("C:\\private\\model.gguf")),
      { stage, errorName: "TypeError" }
    );
  }
  assert.deepEqual(
    createBundledSetupFailureDiagnostic("untrusted-stage", {
      name: "C:\\private\\token"
    }),
    { stage: "diagnostic_init", errorName: "unknown_error" }
  );
  const untrustedErrorName = new Error("C:\\private\\model.gguf");
  untrustedErrorName.name = "C:\\private\\error-name";
  assert.deepEqual(
    createBundledSetupFailureDiagnostic("context", untrustedErrorName),
    { stage: "context", errorName: "unknown_error" }
  );

  const setupDiagnosticSource = acceptanceSource.slice(
    acceptanceSource.indexOf("async function runBundledQwen"),
    acceptanceSource.indexOf("function bundledCases()")
  );
  assert.match(setupDiagnosticSource, /setupStage = "validation"/);
  assert.match(setupDiagnosticSource, /setupStage = "port"/);
  assert.match(setupDiagnosticSource, /setupStage = "context"/);
  assert.match(setupDiagnosticSource, /setupStage = "diagnostic_init"/);
  assert.match(setupDiagnosticSource, /failureCategory: `bundled_setup_\$\{setupDiagnostic\.stage\}`/);
  assert.match(setupDiagnosticSource, /if \(context\) \{[\s\S]*await cleanupContext\(context, null\)/);
  assert.doesNotMatch(setupDiagnosticSource, /\b(?:message|stack|path)\b/);
});

test("P2-86C bundled runtime failures close primary, cleanup, and summary errors", async () => {
  assert.deepEqual(BUNDLED_RUN_STAGES, [
    "electron_flow",
    "runtime_handoff",
    "case_execution",
    "joke_diagnostics",
    "evidence_aggregation",
    "cleanup",
    "result_summary"
  ]);

  const cleanupReject = await finalizeBundledRun({
    primaryStage: "electron_flow",
    primaryFailure: false,
    primaryError: null,
    cleanup: async () => { throw new TypeError(); },
    buildResult: () => { throw new Error("build must not run"); }
  });
  assert.deepEqual(cleanupReject.runDiagnostic, {
    stage: "cleanup",
    primaryFailurePresent: false,
    primaryErrorName: "none",
    cleanupErrorName: "TypeError"
  });
  assert.equal(cleanupReject.failureCategory, "bundled_run_cleanup");

  const primaryAndCleanup = await finalizeBundledRun({
    primaryStage: "runtime_handoff",
    primaryFailure: true,
    primaryError: new RangeError(),
    cleanup: async () => { throw new TypeError(); },
    buildResult: () => ({ ok: true })
  });
  assert.deepEqual(primaryAndCleanup.runDiagnostic, {
    stage: "runtime_handoff",
    primaryFailurePresent: true,
    primaryErrorName: "RangeError",
    cleanupErrorName: "TypeError"
  });
  assert.equal(primaryAndCleanup.failureCategory, "bundled_run_runtime_handoff");

  const malformedCleanup = await finalizeBundledRun({
    primaryStage: "case_execution",
    primaryFailure: false,
    primaryError: null,
    cleanup: async () => ({}),
    buildResult: () => ({ ok: true })
  });
  assert.equal(malformedCleanup.runDiagnostic.stage, "cleanup");
  assert.equal(malformedCleanup.runDiagnostic.cleanupErrorName, "TypeError");

  const summaryError = await finalizeBundledRun({
    primaryStage: "case_execution",
    primaryFailure: false,
    primaryError: null,
    cleanup: async () => ({
      electronStopped: true,
      cdpPortReleased: true,
      runtimePortReleased: true,
      runnerTmpRemoved: true
    }),
    buildResult: () => { throw new ReferenceError(); }
  });
  assert.deepEqual(summaryError.runDiagnostic, {
    stage: "result_summary",
    primaryFailurePresent: true,
    primaryErrorName: "ReferenceError",
    cleanupErrorName: "none"
  });

  const nonStandardPrimary = await finalizeBundledRun({
    primaryStage: "joke_diagnostics",
    primaryFailure: true,
    primaryError: undefined,
    cleanup: async () => ({
      electronStopped: true,
      cdpPortReleased: true,
      runtimePortReleased: true,
      runnerTmpRemoved: true
    }),
    buildResult: () => ({ ok: true })
  });
  assert.deepEqual(nonStandardPrimary.runDiagnostic, {
    stage: "joke_diagnostics",
    primaryFailurePresent: true,
    primaryErrorName: "unknown_error",
    cleanupErrorName: "none"
  });

  const runtimeSource = acceptanceSource.slice(
    acceptanceSource.indexOf("export const BUNDLED_RUN_STAGES"),
    acceptanceSource.indexOf("function bundledCases()")
  );
  assert.match(runtimeSource, /failureCategory: `bundled_run_\$\{runDiagnostic\.stage\}`/);
  assert.match(runtimeSource, /cleanupResult = await cleanup\(\)/);
  assert.doesNotMatch(runtimeSource, /\b(?:message|stack|path|reply|opening)\b/);
});

test("P2-86C outer bundled fallback keeps only a closed safe diagnostic", () => {
  assert.deepEqual(BUNDLED_FALLBACK_STAGES, [
    "entry",
    "validation",
    "port",
    "context",
    "diagnostic_init",
    "electron_flow",
    "runtime_handoff",
    "case_execution",
    "joke_diagnostics",
    "evidence_aggregation",
    "cleanup",
    "result_summary",
    "returned"
  ]);
  for (const stage of BUNDLED_FALLBACK_STAGES) {
    assert.deepEqual(
      createBundledFallbackDiagnostic(stage, new TypeError("C:\\private\\model.gguf")),
      { stage, errorName: "TypeError" }
    );
  }
  assert.deepEqual(
    createBundledFallbackDiagnostic("untrusted-stage", { name: "C:\\private\\token" }),
    { stage: "entry", errorName: "unknown_error" }
  );
  assert.deepEqual(
    createBundledFallbackDiagnostic("cleanup", undefined),
    { stage: "cleanup", errorName: "unknown_error" }
  );
  assert.deepEqual(
    createBundledFallbackDiagnostic("result_summary", new Proxy(new Error(), {
      get() { throw new Error("must not expose"); }
    })),
    { stage: "result_summary", errorName: "unknown_error" }
  );

  const fallbackSource = acceptanceSource.slice(
    acceptanceSource.indexOf("function failedSection"),
    acceptanceSource.indexOf("function classifyError")
  );
  assert.match(fallbackSource, /mode === "bundled-local-qwen-real-ui"/);
  assert.match(fallbackSource, /failureCategory: "bundled_fallback_failure"/);
  assert.match(fallbackSource, /fallbackDiagnostic: createBundledFallbackDiagnostic\(bundledActiveStage, error\)/);
  assert.doesNotMatch(fallbackSource, /\b(?:message|stack|path)\b/);

  const bundledSource = acceptanceSource.slice(
    acceptanceSource.indexOf("async function runBundledQwen"),
    acceptanceSource.indexOf("function bundledCases()")
  );
  assert.match(bundledSource, /setBundledActiveStage\("entry"\)/);
  assert.match(bundledSource, /setBundledActiveStage\("returned"\)/);
});

test("P2-84 bundled explicit tired accepts heartache while retaining relevance and non-taskifying guards", () => {
  const tiredCase = acceptanceSource.match(
    /caseId: "explicit-tired",[\s\S]*?\r?\n    \},\r?\n    \{\r?\n      caseId: "joke-world-ending"/
  )?.[0] ?? "";

  assert.match(tiredCase, /relevant:\s*hasAny\(reply, \["累", "疲惫", "困", "歇", "休息", "安静", "陪", "听"\]\)/);
  assert.match(tiredCase, /warmRestrained:\s*hasAny\(reply, \["陪", "听", "在", "安静", "慢慢", "歇", "心疼"\]\)\s*&&\s*!hasTaskifyingReply\(reply\)/);
});
