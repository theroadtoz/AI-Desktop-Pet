import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDeterministicXitaInteractionCueShadowObservation,
  detectDeterministicXitaInteractionCue
} from "../src/main/services/affect/deterministic-xita-interaction-cue.ts";

test("P2-88C recognizes an explicit guess invitation as a low curious shadow cue", () => {
  assert.deepEqual(detectDeterministicXitaInteractionCue("西塔，你猜我刚才发现了什么？"), {
    kind: "curious",
    intensity: "low",
    reason: "guess-invitation"
  });
});

test("P2-88C recognizes an explicit reveal invitation as a low curious shadow cue", () => {
  assert.deepEqual(detectDeterministicXitaInteractionCue("想不想知道盒子里是什么？"), {
    kind: "curious",
    intensity: "low",
    reason: "reveal-invitation"
  });
});

test("P2-88C recognizes an explicit view invitation as a low curious shadow cue", () => {
  assert.deepEqual(detectDeterministicXitaInteractionCue("给你看个东西。"), {
    kind: "curious",
    intensity: "low",
    reason: "view-invitation"
  });
});

test("P2-88C rejects negated guess, reveal, and view invitations", () => {
  for (const text of [
    "西塔，你不要猜。",
    "我不想让你知道。",
    "这个不给你看。",
    "我不想给你看这个。"
  ]) {
    assert.deepEqual(detectDeterministicXitaInteractionCue(text), { kind: "none" }, text);
  }
});

test("P2-88C rejects quoted and example invitation text", () => {
  for (const text of [
    "他说：“西塔，你猜我发现了什么？”",
    "示例文本：『给你看个东西。』",
    "“想不想知道”这句话怎么改？"
  ]) {
    assert.deepEqual(detectDeterministicXitaInteractionCue(text), { kind: "none" }, text);
  }
});

test("P2-88C rejects reported and third-party invitation text", () => {
  for (const text of [
    "她问我想不想知道答案。",
    "朋友说给你看个东西。",
    "小林让我问你，你猜他带了什么。"
  ]) {
    assert.deepEqual(detectDeterministicXitaInteractionCue(text), { kind: "none" }, text);
  }
});

test("P2-88C rejects a third-party Chinese reveal question", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("他想不想知道答案？"),
    { kind: "none" }
  );
});

test("P2-88C rejects a Chinese guess-result statement", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("你猜错了。"),
    { kind: "none" }
  );
});

test("P2-88C rejects a completed Chinese view statement", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("已经给你看过了。"),
    { kind: "none" }
  );
});

test("P2-88C rejects a relayed Chinese view invitation", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("妈妈让我给你看个东西。"),
    { kind: "none" }
  );
});

test("P2-88C rejects a Chinese user prediction containing a guess phrase", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("我猜你猜不到。"),
    { kind: "none" }
  );
});

test("P2-88C rejects an ordinary why question even when it asks for a guess", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("你猜一下为什么这个程序会报错？"),
    { kind: "none" }
  );
});

test("P2-88C rejects extended Chinese and punctuated English guess-why questions", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("你猜一下这个新程序为什么会报错？"),
    { kind: "none" }
  );
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("Can you guess, why this program failed?"),
    { kind: "none" }
  );
});

test("P2-88C rejects ordinary reason questions anywhere in the same sentence", () => {
  for (const text of [
    "你猜一下这个刚刚部署到测试环境的新程序为什么会突然报错？",
    "你猜这个程序失败是什么原因？",
    "Can you guess—why this program failed?",
    "Can you guess: why this program failed?",
    "Can you guess... why this program failed?"
  ]) {
    assert.deepEqual(detectDeterministicXitaInteractionCue(text), { kind: "none" }, text);
  }

  assert.deepEqual(detectDeterministicXitaInteractionCue("你猜盒子里是什么？"), {
    kind: "curious",
    intensity: "low",
    reason: "guess-invitation"
  });
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("这里有一个提示。你猜盒子里是什么？"),
    {
      kind: "curious",
      intensity: "low",
      reason: "guess-invitation"
    }
  );
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("Here is one clue. Can you guess what it is?"),
    {
      kind: "curious",
      intensity: "low",
      reason: "guess-invitation"
    }
  );
});

test("P2-88C keeps LF and CRLF inside an active reason question but allows a new invitation", () => {
  for (const text of [
    "Can you guess\nwhy this program failed?",
    "Can you guess\r\nwhy this program failed?"
  ]) {
    assert.deepEqual(detectDeterministicXitaInteractionCue(text), { kind: "none" }, text);
  }

  assert.deepEqual(
    detectDeterministicXitaInteractionCue("这里有一个提示\n你猜盒子里是什么？"),
    {
      kind: "curious",
      intensity: "low",
      reason: "guess-invitation"
    }
  );
});

test("P2-88C ignores reason tokens inside quoted objects and titles", () => {
  for (const text of [
    'Can you guess what "why" means?',
    "Can you guess which song is called “Why”?",
    "你猜“为什么”是什么意思？",
    "你猜《为什么》是谁写的？"
  ]) {
    assert.deepEqual(
      detectDeterministicXitaInteractionCue(text),
      {
        kind: "curious",
        intensity: "low",
        reason: "guess-invitation"
      },
      text
    );
  }
});

test("P2-88C fails closed on malformed quote delimiters without treating apostrophes as quotes", () => {
  for (const text of [
    'Can you guess what "moonlight means?',
    "Can you guess what “moonlight means?",
    'Can you guess what "moonlight” means?',
    "你猜《月光是谁写的？",
    '你猜“月光"是什么意思？'
  ]) {
    assert.deepEqual(detectDeterministicXitaInteractionCue(text), { kind: "none" }, text);
  }

  for (const text of [
    'Can you guess what "moonlight" means?',
    "你猜“月光”是什么意思？",
    "你猜《月光》是谁写的？",
    "I'll show you something.",
    "I’ll show you something.",
    "Here's a clue. Can you guess what it is?",
    "John's clue is ready. Can you guess what it is?",
    "John’s clue is ready. Can you guess what it is?"
  ]) {
    assert.notDeepEqual(detectDeterministicXitaInteractionCue(text), { kind: "none" }, text);
  }
});

test("P2-88C distinguishes trailing possessives and leading elision from malformed single quotes", () => {
  for (const text of [
    "Students' clue is ready. Can you guess what it is?",
    "Students’ clue is ready. Can you guess what it is?",
    "James' clue is ready. Can you guess what it is?",
    "James’ clue is ready. Can you guess what it is?",
    "'Tis a clue. Can you guess what it is?",
    "’Tis a clue. Can you guess what it is?",
    "Can you guess what 'why' means?",
    "Can you guess what ‘why’ means?"
  ]) {
    assert.notDeepEqual(detectDeterministicXitaInteractionCue(text), { kind: "none" }, text);
  }

  for (const text of [
    "Can you guess what 'moonlight means?",
    "Can you guess what ‘moonlight means?"
  ]) {
    assert.deepEqual(detectDeterministicXitaInteractionCue(text), { kind: "none" }, text);
  }
});

test("P2-88C rejects the user's own curiosity as a Xita curious cue", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("我很好奇，你猜这个词是什么意思？"),
    { kind: "none" }
  );
});

test("P2-88C rejects an invitation that is explicitly corrected as a joke", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("刚才说给你看个东西只是开玩笑。"),
    { kind: "none" }
  );
});

test("P2-88C recognizes only the three direct English invitation meanings", () => {
  assert.deepEqual(detectDeterministicXitaInteractionCue("Can you guess what I found?"), {
    kind: "curious",
    intensity: "low",
    reason: "guess-invitation"
  });
  assert.deepEqual(detectDeterministicXitaInteractionCue("Want to know what is inside?"), {
    kind: "curious",
    intensity: "low",
    reason: "reveal-invitation"
  });
  assert.deepEqual(detectDeterministicXitaInteractionCue("Let me show you something."), {
    kind: "curious",
    intensity: "low",
    reason: "view-invitation"
  });
});

test("P2-88C treats an English contraction apostrophe as direct speech, not a quote", () => {
  assert.deepEqual(detectDeterministicXitaInteractionCue("I'll show you something."), {
    kind: "curious",
    intensity: "low",
    reason: "view-invitation"
  });
});

test("P2-88C accepts the Unicode apostrophe form of a direct view invitation", () => {
  assert.deepEqual(detectDeterministicXitaInteractionCue("I’ll show you something."), {
    kind: "curious",
    intensity: "low",
    reason: "view-invitation"
  });
});

test("P2-88C accepts a sentence-boundary guess invitation after a curly apostrophe", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("Here’s something. Can you guess what it is?"),
    {
      kind: "curious",
      intensity: "low",
      reason: "guess-invitation"
    }
  );
});

test("P2-88C accepts a direct invitation whose object is quoted", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue('Can you guess what "moonlight" means?'),
    {
      kind: "curious",
      intensity: "low",
      reason: "guess-invitation"
    }
  );
});

test("P2-88C accepts a direct invitation after a quoted clue in English or Chinese", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue(
      "“moonlight” is the clue. Can you guess what it means?"
    ),
    {
      kind: "curious",
      intensity: "low",
      reason: "guess-invitation"
    }
  );
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("“月光”是提示。你猜是什么意思？"),
    {
      kind: "curious",
      intensity: "low",
      reason: "guess-invitation"
    }
  );
});

test("P2-88C rejects an invitation whose whole text is quoted", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue('"Can you guess what I found?"'),
    { kind: "none" }
  );
});

test("P2-88C rejects an ordinary English why question that asks for a guess", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("Can you guess why this program failed?"),
    { kind: "none" }
  );
});

test("P2-88C rejects a reported English invitation", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("She asked me if I want to know the answer."),
    { kind: "none" }
  );
});

test("P2-88C rejects the user's own English desire to know", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("I want to know the answer."),
    { kind: "none" }
  );
});

test("P2-88C rejects English negated reveal phrases with ASCII or Unicode apostrophes", () => {
  for (const text of [
    "I do not want to know.",
    "I don't want to know.",
    "I don’t want to know."
  ]) {
    assert.deepEqual(detectDeterministicXitaInteractionCue(text), { kind: "none" }, text);
  }
});

test("P2-88C rejects English example invitation text", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("Example: Let me show you something."),
    { kind: "none" }
  );
});

test("P2-88C rejects an English example invitation without a colon", () => {
  assert.deepEqual(
    detectDeterministicXitaInteractionCue("For example, Can you guess what I found?"),
    { kind: "none" }
  );
});

test("P2-88C creates an exact-key safe shadow observation for a direct invitation", () => {
  assert.deepEqual(
    createDeterministicXitaInteractionCueShadowObservation(
      "西塔，你猜我刚才发现了什么？",
      true
    ),
    {
      matched: true,
      reason: "guess-invitation",
      intensity: "low",
      count: 1
    }
  );
});

test("P2-88C observes the shadow only inside the accepted real chat request path", () => {
  const appSource = readFileSync(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const insertedIndex = appSource.indexOf(
    "const inserted = historyStoreForRequest.appendMessage"
  );
  const affectIndex = appSource.indexOf(
    "affectTurnResolution = resolveDialogueAffectForMessage",
    insertedIndex
  );
  const acceptedRequestSlice = appSource.slice(insertedIndex, affectIndex);

  assert.ok(insertedIndex >= 0);
  assert.ok(affectIndex > insertedIndex);
  assert.match(
    appSource,
    /import \{ createDeterministicXitaInteractionCueShadowObservation \} from "\.\/services\/affect\/deterministic-xita-interaction-cue";/
  );
  assert.match(
    acceptedRequestSlice,
    /createDeterministicXitaInteractionCueShadowObservation\(\s*submittedMessage\.content,\s*currentDialogueAffectSettings\.enabled\s*\)/
  );
  assert.match(
    acceptedRequestSlice,
    /logTelemetry\("xita_interaction_cue_shadow_observed", shadowObservation\)/
  );
});

test("P2-88C shadow observations stay request-local, low, and exact-key safe", () => {
  const observations = Array.from({ length: 3 }, () =>
    createDeterministicXitaInteractionCueShadowObservation(
      "西塔，你猜我刚才发现了什么？",
      true
    )
  );

  for (const observation of observations) {
    assert.deepEqual(Object.keys(observation ?? {}).sort(), [
      "count",
      "intensity",
      "matched",
      "reason"
    ]);
    assert.equal(observation?.intensity, "low");
    assert.equal(observation?.count, 1);
  }
  assert.equal(
    createDeterministicXitaInteractionCueShadowObservation("你为什么喜欢星星？", true),
    null
  );
  assert.equal(
    createDeterministicXitaInteractionCueShadowObservation(
      "西塔，你猜我刚才发现了什么？",
      false
    ),
    null
  );
});

test("P2-88C detector cannot be entered by background, environment, persona, or provider paths", () => {
  const appSource = readFileSync(new URL("../src/main/app.ts", import.meta.url), "utf8");
  assert.equal(
    (appSource.match(/createDeterministicXitaInteractionCueShadowObservation\(/g) ?? []).length,
    1
  );

  const detectorSource = readFileSync(
    new URL("../src/main/services/affect/deterministic-xita-interaction-cue.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    detectorSource,
    /xita-affect-coordinator|affect-dialogue-presentation-resolver|provider|persona|memory|history|mcp|environment|setTimeout|setInterval|new Map|new Set/i
  );
});

test("P2-88C static zero-wiring contract keeps the observation result inside safe telemetry", () => {
  const appSource = readFileSync(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const observationStart = appSource.indexOf(
    "const shadowObservation = createDeterministicXitaInteractionCueShadowObservation"
  );
  const affectResolutionStart = appSource.indexOf(
    "affectTurnResolution = resolveDialogueAffectForMessage",
    observationStart
  );
  const observationSlice = appSource.slice(observationStart, affectResolutionStart);

  assert.ok(observationStart >= 0);
  assert.ok(affectResolutionStart > observationStart);
  assert.equal((observationSlice.match(/\bshadowObservation\b/g) ?? []).length, 3);
  assert.match(
    observationSlice,
    /logTelemetry\("xita_interaction_cue_shadow_observed", shadowObservation\)/
  );
  assert.doesNotMatch(
    observationSlice,
    /xitaAffectCoordinator|resolveDialogueAffectForMessage|resolveAffectDialoguePresentation|emotionalDialogueContextId|dialogueContextId|prompt|dispatch|selectedAction|curiousTilt|state_curious/
  );

  const detectorSource = readFileSync(
    new URL("../src/main/services/affect/deterministic-xita-interaction-cue.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(detectorSource, /^import\s/m);
  assert.doesNotMatch(
    detectorSource,
    /coordinator|resolver|prompt|context|petAction|dispatch|curiousTilt|state_curious|selectedAction|provider|persona|memory|history|mcp|environment/i
  );
});
