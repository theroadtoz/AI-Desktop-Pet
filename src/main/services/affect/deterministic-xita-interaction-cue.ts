export type DeterministicXitaInteractionCue =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "curious";
      intensity: "low";
      reason: "guess-invitation" | "reveal-invitation" | "view-invitation";
    }>;

export type DeterministicXitaInteractionCueShadowObservation = Readonly<{
  matched: true;
  reason: "guess-invitation" | "reveal-invitation" | "view-invitation";
  intensity: "low";
  count: 1;
}>;

const sentenceSegmenter = new Intl.Segmenter("und", {
  granularity: "sentence"
});

export function createDeterministicXitaInteractionCueShadowObservation(
  text: string,
  enabled: boolean
): DeterministicXitaInteractionCueShadowObservation | null {
  if (!enabled) return null;
  const cue = detectDeterministicXitaInteractionCue(text);
  if (cue.kind === "none") return null;
  return {
    matched: true,
    reason: cue.reason,
    intensity: cue.intensity,
    count: 1
  };
}

export function detectDeterministicXitaInteractionCue(
  text: string
): DeterministicXitaInteractionCue {
  if (!hasBalancedQuoteDelimiters(text)) {
    return { kind: "none" };
  }
  const trimmedText = text.trim();
  if (
    /(?:示例|例如|例句|引用|原话)(?:文本)?[：:]/u.test(text) ||
    /(?:^|[.!?]\s*)(?:for example|example|quoted text|quote)\s*[:,]?/iu.test(text) ||
    /^(?:"[^"]+"|'[^']+'|“[^”]+”|‘[^’]+’|「[^」]+」|『[^』]+』)[。！？.!?]?\s*$/u.test(trimmedText) ||
    /^(?:“[^”]*(?:你猜|想不想知道|给你看)[^”]*”|"[^"]*(?:can you guess|want to know|show you)[^"]*")[^。！？.!?]*(?:这句话|怎么|如何|翻译|改写|example|quote)/iu.test(trimmedText)
  ) {
    return { kind: "none" };
  }
  if (/(?:他|她|它|他们|她们|朋友|同事|同学|老师|家人|小\p{Script=Han})[^。！？!?\n]{0,8}(?:说|问我|让我(?:来)?问|告诉我|提到)/u.test(text)) {
    return { kind: "none" };
  }
  if (/\b(?:he|she|they|my friend|my colleague|my teacher)\b[^.!?\n]{0,24}\b(?:said|asked|told me|mentioned)\b/iu.test(text)) {
    return { kind: "none" };
  }
  if (/(?:我(?:很|有点|也)?好奇|I(?: am|'m) curious)/iu.test(text)) {
    return { kind: "none" };
  }
  if (/(?:开玩笑|逗你(?:的|玩)?|骗你的|闹着玩|just kidding|I was joking)/iu.test(text)) {
    return { kind: "none" };
  }
  const textWithoutRevealInvitation = text.replaceAll("想不想知道", "");
  if (/(?:不要|别|不用|无需|不必|不想|不给|不让)[^。！？!?\n]{0,10}(?:猜|知道|看)/u.test(textWithoutRevealInvitation)) {
    return { kind: "none" };
  }
  if (containsGuessReasonQuestionInSameSentence(text)) {
    return { kind: "none" };
  }
  if (/(?:你|妳)猜(?:错|对|中|不到|不出|得出|出来)/u.test(text)) {
    return { kind: "none" };
  }
  if (/(?:已经|刚才|之前|早就)[^。！？!?\n]{0,6}给(?:你|妳)看(?:过|了)/u.test(text)) {
    return { kind: "none" };
  }
  if (/让我(?:来)?给(?:你|妳)看/u.test(text)) {
    return { kind: "none" };
  }
  if (
    /(?:^|[\r\n]+|[。！？!?]\s*)(?:西塔[，,\s]*)?(?:你|妳)猜/u.test(text) ||
    /(?:^|[\r\n]+|[.!?]\s+)(?:(?:xita|西塔)[,，]\s*)?(?:can|could) you guess\b/iu.test(text)
  ) {
    return {
      kind: "curious",
      intensity: "low",
      reason: "guess-invitation"
    };
  }
  if (
    /(?:^|[\r\n]+|[。！？!?]\s*)(?:西塔[，,\s]*)?(?:你|妳)?想不想知道/u.test(text) ||
    /(?:^|[\r\n]+|[.!?]\s+)(?:(?:xita|西塔)[,，]\s*)?(?:do you want to know|want to know)\b/iu.test(text)
  ) {
    return {
      kind: "curious",
      intensity: "low",
      reason: "reveal-invitation"
    };
  }
  if (
    /(?:^|[\r\n]+|[。！？!?]\s*)(?:西塔[，,\s]*)?(?:我)?给(?:你|妳)看个东西/u.test(text) ||
    /(?:^|[\r\n]+|[.!?]\s+)(?:(?:xita|西塔)[,，]\s*)?(?:let me|I(?:(?:'|’|‘)ll| will)) show you\b/iu.test(text)
  ) {
    return {
      kind: "curious",
      intensity: "low",
      reason: "view-invitation"
    };
  }
  return { kind: "none" };
}

function containsGuessReasonQuestionInSameSentence(text: string): boolean {
  const textWithSoftLineBreaks = text.replace(/\r?\n/gu, " ");
  for (const { segment } of sentenceSegmenter.segment(textWithSoftLineBreaks)) {
    const chineseGuessIndex = segment.search(/(?:你|妳)猜(?:一下)?/u);
    const englishGuessIndex = segment.search(/\b(?:can|could) you guess\b/iu);
    const guessIndex =
      chineseGuessIndex < 0
        ? englishGuessIndex
        : englishGuessIndex < 0
          ? chineseGuessIndex
          : Math.min(chineseGuessIndex, englishGuessIndex);
    if (guessIndex < 0) continue;
    const grammaticalSuffix = stripPairedQuotedContent(segment.slice(guessIndex));
    if (/(?:为什么|什么原因)|\bwhy\b/iu.test(grammaticalSuffix)) {
      return true;
    }
  }
  return false;
}

function stripPairedQuotedContent(text: string): string {
  return text.replace(
    /"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|《[^》]*》/gu,
    ""
  );
}

function hasBalancedQuoteDelimiters(text: string): boolean {
  const expectedClosers: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const delimiter = text[index];
    if (
      (delimiter === "'" || delimiter === "‘" || delimiter === "’") &&
      (isWordInternalApostrophe(text, index) ||
        isLeadingTisElision(text, index, delimiter))
    ) {
      continue;
    }
    if (
      (delimiter === "'" || delimiter === "’") &&
      expectedClosers.at(-1) !== delimiter &&
      isTrailingSPossessive(text, index)
    ) {
      continue;
    }
    if (delimiter === '"' || delimiter === "'") {
      if (expectedClosers.at(-1) === delimiter) {
        expectedClosers.pop();
      } else {
        expectedClosers.push(delimiter);
      }
      continue;
    }
    const closer =
      delimiter === "“"
        ? "”"
        : delimiter === "‘"
          ? "’"
          : delimiter === "「"
            ? "」"
            : delimiter === "『"
              ? "』"
              : delimiter === "《"
                ? "》"
                : null;
    if (closer) {
      expectedClosers.push(closer);
      continue;
    }
    if (delimiter === "”" || delimiter === "’" || delimiter === "」" || delimiter === "』" || delimiter === "》") {
      if (expectedClosers.pop() !== delimiter) return false;
    }
  }
  return expectedClosers.length === 0;
}

function isWordInternalApostrophe(text: string, index: number): boolean {
  return (
    /[\p{L}\p{N}]/u.test(text[index - 1] ?? "") &&
    /[\p{L}\p{N}]/u.test(text[index + 1] ?? "")
  );
}

function isLeadingTisElision(
  text: string,
  index: number,
  delimiter: string
): boolean {
  if (delimiter !== "'" && delimiter !== "’") return false;
  const previousIsWord = /[\p{L}\p{N}]/u.test(text[index - 1] ?? "");
  return !previousIsWord && /^tis\b/iu.test(text.slice(index + 1));
}

function isTrailingSPossessive(text: string, index: number): boolean {
  return (
    /[sS]/u.test(text[index - 1] ?? "") &&
    !/[\p{L}\p{N}]/u.test(text[index + 1] ?? "")
  );
}
