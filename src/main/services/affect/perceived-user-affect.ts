import {
  createUnknownUserAffect,
  type AffectConfidence,
  type PerceivedUserAffect,
  type UserAffectKind
} from "../../../shared/companion-affect.ts";

export const USER_AFFECT_CORRECTION_SUPPRESSION_MS = 15 * 60_000;

type DetectableUserAffectKind = Exclude<UserAffectKind, "unknown">;

export type UserAffectClassificationStatus =
  | "classified"
  | "low-confidence"
  | "invalid-output"
  | "timeout"
  | "unavailable"
  | "failed";

export type UserAffectClassifierResult = {
  kind: UserAffectKind;
  confidence: AffectConfidence;
  source: "conversational-inference";
  status: UserAffectClassificationStatus;
};

export type UserAffectClassifier = {
  classify(input: { text: string; signal?: AbortSignal }): Promise<UserAffectClassifierResult>;
};

export type PerceivedUserAffectDecision = {
  affect: PerceivedUserAffect;
  needsInference: boolean;
  correctedKinds: readonly DetectableUserAffectKind[];
};

export type PerceivedUserAffectTracker = {
  perceiveText(text: string): PerceivedUserAffectDecision;
  acceptInference(result: UserAffectClassifierResult): PerceivedUserAffect;
  getSnapshot(): PerceivedUserAffect;
  isInferenceSuppressed(kind: UserAffectKind): boolean;
};

export type PerceivedUserAffectTrackerRegistry = {
  getOrCreate(conversationId: string): PerceivedUserAffectTracker;
  get(conversationId: string): PerceivedUserAffectTracker | null;
  clear(): void;
  size(): number;
};

const EXPLICIT_PATTERNS: ReadonlyArray<{
  kind: DetectableUserAffectKind;
  pattern: RegExp;
}> = [
  {
    kind: "excited",
    pattern: /(?:我|I(?:'m| am))[^。！？!?\n]{0,12}(?:兴奋|激动|期待|excited|thrilled)/iu
  },
  {
    kind: "low",
    pattern: /(?:我|I(?:'m| am))[^。！？!?\n]{0,12}(?:难过|伤心|低落|沮丧|孤独|不开心|想哭|sad|down|upset)/iu
  },
  {
    kind: "positive",
    pattern: /(?:我|I(?:'m| am))[^。！？!?\n]{0,12}(?:开心|高兴|快乐|心情不错|感觉很好|happy|glad)/iu
  },
  {
    kind: "tense",
    pattern: /(?:我|I(?:'m| am))[^。！？!?\n]{0,12}(?:紧张|焦虑|烦躁|生气|压力(?:很)?大|害怕|tense|anxious|angry|stressed)/iu
  },
  {
    kind: "tired",
    pattern: /(?:我|I(?:'m| am))[^。！？!?\n]{0,12}(?:累|疲惫|困(?:了|得)?|没精神|tired|exhausted|sleepy)/iu
  },
  {
    kind: "calm",
    pattern: /(?:我|I(?:'m| am))[^。！？!?\n]{0,12}(?:平静|安心|放松|心情平稳|calm|relaxed)/iu
  }
];

const NEGATED_PATTERNS: ReadonlyArray<{
  kind: DetectableUserAffectKind;
  pattern: RegExp;
}> = [
  { kind: "low", pattern: /(?:我[^。！？!?\n]{0,6}(?:没有|没|并不|不是|不)|I(?:'m| am) not)[^。！？!?\n]{0,6}(?:难过|伤心|低落|沮丧|不开心|sad|down|upset)/iu },
  { kind: "tense", pattern: /(?:我[^。！？!?\n]{0,6}(?:没有|没|并不|不是|不)|I(?:'m| am) not)[^。！？!?\n]{0,6}(?:紧张|焦虑|烦躁|生气|害怕|tense|anxious|angry|stressed)/iu },
  { kind: "tired", pattern: /(?:我[^。！？!?\n]{0,6}(?:没有|没|并不|不是|不)|I(?:'m| am) not)[^。！？!?\n]{0,6}(?:累|疲惫|困|没精神|tired|exhausted|sleepy)/iu },
  { kind: "positive", pattern: /(?:我[^。！？!?\n]{0,6}(?:没有|没觉得|并不觉得|并不|一点也不|不是)|I(?:'m| am) not)[^。！？!?\n]{0,6}(?:开心|高兴|快乐|happy|glad)/iu },
  { kind: "excited", pattern: /(?:我[^。！？!?\n]{0,6}(?:没有|没觉得|并不觉得|并不|一点也不|不是)|I(?:'m| am) not)[^。！？!?\n]{0,6}(?:兴奋|激动|期待|excited|thrilled)/iu },
  { kind: "calm", pattern: /(?:我[^。！？!?\n]{0,6}(?:没有|没觉得|并不觉得|并不|一点也不|不是)|I(?:'m| am) not)[^。！？!?\n]{0,6}(?:平静|安心|放松|calm|relaxed)/iu }
];

const AFFECT_MENTION_PATTERNS: ReadonlyArray<{
  kind: DetectableUserAffectKind;
  pattern: RegExp;
}> = [
  { kind: "excited", pattern: /兴奋|激动|期待|excited|thrilled/iu },
  { kind: "positive", pattern: /开心|高兴|快乐|心情不错|感觉很好|happy|glad/iu },
  { kind: "low", pattern: /难过|伤心|低落|沮丧|孤独|不开心|想哭|sad|down|upset/iu },
  { kind: "tense", pattern: /紧张|焦虑|烦躁|生气|压力(?:很)?大|害怕|tense|anxious|angry|stressed/iu },
  { kind: "tired", pattern: /累|疲惫|困|没精神|tired|exhausted|sleepy/iu },
  { kind: "calm", pattern: /平静|安心|放松|心情平稳|calm|relaxed/iu }
];

const JOKE_CORRECTION_PATTERN = /(?:我)?(?:只是|就是|刚才(?:只)?是)(?:在)?开玩笑|(?:我)(?:在)?开玩笑(?:的|而已)|逗你(?:的|玩)?|just kidding|I was joking/iu;
const NEGATED_JOKE_PATTERN = /(?:我[^。！？!?\n]{0,6}(?:没有|没|并非|不是|不在)[^。！？!?\n]{0,6}开玩笑)|I(?:'m| am) not joking/iu;
const CORRECTION_PREFIX_PATTERN = /(?:别|不要)(?:再)?(?:觉得|认为|以为)?[^。！？!?\n]{0,4}我/iu;
const THIRD_PARTY_OWNER_PATTERN = /我(?:的)?(?:朋友|同事|同学|室友|家人|妈妈|母亲|爸爸|父亲|伴侣|对象|孩子|哥哥|姐姐|弟弟|妹妹)/u;
const REPORTING_VERB_PATTERN = /说|觉得|告诉|认为|表示/gu;
const FIRST_PERSON_REPORTER_PATTERN = /^我(?:跟|对|向)[^。！？!?\n]{1,12}$/u;

export function createPerceivedUserAffectTracker({
  now = Date.now,
  correctionSuppressionMs = USER_AFFECT_CORRECTION_SUPPRESSION_MS
}: {
  now?: () => number;
  correctionSuppressionMs?: number;
} = {}): PerceivedUserAffectTracker {
  const suppressedUntil = new Map<DetectableUserAffectKind, number>();
  let snapshot = createUnknownUserAffect(now());

  function removeExpiredSuppressions(timestampMs: number): void {
    for (const [kind, expiresAtMs] of suppressedUntil) {
      if (expiresAtMs <= timestampMs) {
        suppressedUntil.delete(kind);
      }
    }
  }

  return {
    perceiveText(text) {
      const timestampMs = now();
      removeExpiredSuppressions(timestampMs);
      const correctedKinds = findCorrectedKinds(text, snapshot.kind);
      const jokeCorrection = isJokeCorrection(text);
      const explicitKind = findExplicitKind(text);
      if (correctedKinds.length > 0 || jokeCorrection) {
        const kinds = correctedKinds.length > 0
          ? correctedKinds
          : snapshot.kind === "unknown" ? [] : [snapshot.kind];
        for (const kind of kinds) {
          suppressedUntil.set(kind, timestampMs + Math.max(1, correctionSuppressionMs));
        }
        if (explicitKind) {
          suppressedUntil.delete(explicitKind);
          snapshot = {
            kind: explicitKind,
            confidence: "high",
            source: "explicit-text",
            observedAtMs: timestampMs
          };
          return {
            affect: snapshot,
            needsInference: false,
            correctedKinds: kinds
          };
        }
        snapshot = createUnknownUserAffect(timestampMs, "user-correction");
        return {
          affect: snapshot,
          needsInference: false,
          correctedKinds: kinds
        };
      }

      if (explicitKind) {
        suppressedUntil.delete(explicitKind);
        snapshot = {
          kind: explicitKind,
          confidence: "high",
          source: "explicit-text",
          observedAtMs: timestampMs
        };
        return {
          affect: snapshot,
          needsInference: false,
          correctedKinds: []
        };
      }

      snapshot = createUnknownUserAffect(timestampMs);
      return {
        affect: snapshot,
        needsInference: text.trim().length > 0,
        correctedKinds: []
      };
    },
    acceptInference(result) {
      const timestampMs = now();
      removeExpiredSuppressions(timestampMs);
      if (
        result.status !== "classified" ||
        result.kind === "unknown" ||
        suppressedUntil.has(result.kind)
      ) {
        snapshot = createUnknownUserAffect(timestampMs);
        return snapshot;
      }

      snapshot = {
        kind: result.kind,
        confidence: result.confidence === "high" ? "medium" : result.confidence,
        source: "conversational-inference",
        observedAtMs: timestampMs
      };
      return snapshot;
    },
    getSnapshot() {
      return snapshot;
    },
    isInferenceSuppressed(kind) {
      const timestampMs = now();
      removeExpiredSuppressions(timestampMs);
      return kind !== "unknown" && suppressedUntil.has(kind);
    }
  };
}

export function createPerceivedUserAffectTrackerRegistry({
  maxEntries = 32,
  createTracker = () => createPerceivedUserAffectTracker()
}: {
  maxEntries?: number;
  createTracker?: () => PerceivedUserAffectTracker;
} = {}): PerceivedUserAffectTrackerRegistry {
  const entryLimit = Number.isSafeInteger(maxEntries) && maxEntries > 0 ? maxEntries : 32;
  const trackers = new Map<string, PerceivedUserAffectTracker>();

  return {
    getOrCreate(conversationId) {
      const existing = trackers.get(conversationId);
      if (existing) {
        trackers.delete(conversationId);
        trackers.set(conversationId, existing);
        return existing;
      }

      while (trackers.size >= entryLimit) {
        const oldestConversationId = trackers.keys().next().value;
        if (oldestConversationId === undefined) {
          break;
        }
        trackers.delete(oldestConversationId);
      }
      const tracker = createTracker();
      trackers.set(conversationId, tracker);
      return tracker;
    },
    get(conversationId) {
      return trackers.get(conversationId) ?? null;
    },
    clear() {
      trackers.clear();
    },
    size() {
      return trackers.size;
    }
  };
}

function findExplicitKind(text: string): DetectableUserAffectKind | null {
  const clauses = splitAffectClauses(text);
  for (const [index, clause] of clauses.entries()) {
    if (
      /[？?]/u.test(clause) ||
      isJokeCorrection(clause) ||
      findNegatedKinds(clause).length > 0 ||
      isThirdPartyOrReportedAffect(clause) ||
      isReportedAffectContinuation(clauses, index)
    ) {
      continue;
    }
    for (const candidate of EXPLICIT_PATTERNS) {
      if (candidate.pattern.test(clause)) {
        return candidate.kind;
      }
    }
  }
  return null;
}

function isReportedAffectContinuation(clauses: readonly string[], index: number): boolean {
  if (index === 0) {
    return false;
  }

  const previous = clauses[index - 1];
  if (!previous) {
    return false;
  }
  if (!/[，,：:]\s*$/u.test(previous)) {
    return false;
  }

  const previousClause = previous
    .replace(/[，,：:]\s*$/u, "")
    .trim();
  const reportingMatches = [...previousClause.matchAll(REPORTING_VERB_PATTERN)];
  const reportingMatch = reportingMatches.at(-1);
  if (!reportingMatch || reportingMatch.index === undefined) {
    return false;
  }

  const reporter = previousClause
    .slice(0, reportingMatch.index)
    .replace(/^[“"'‘\s]+|[”"'’\s]+$/gu, "")
    .trim();
  return reporter.length > 0 &&
    reporter !== "我" &&
    !FIRST_PERSON_REPORTER_PATTERN.test(reporter);
}

function isThirdPartyOrReportedAffect(clause: string): boolean {
  return AFFECT_MENTION_PATTERNS.some((candidate) => {
    const affectMatch = candidate.pattern.exec(clause);
    if (!affectMatch) {
      return false;
    }
    if (THIRD_PARTY_OWNER_PATTERN.test(clause)) {
      return true;
    }

    const ownerIndex = clause.lastIndexOf("我", affectMatch.index);
    if (ownerIndex < 0 || affectMatch.index - ownerIndex > 12) {
      return false;
    }
    const beforeOwner = clause.slice(0, ownerIndex);
    const reportingMatches = [...beforeOwner.matchAll(REPORTING_VERB_PATTERN)];
    const reportingMatch = reportingMatches.at(-1);
    if (!reportingMatch || reportingMatch.index === undefined) {
      return false;
    }

    const reporter = beforeOwner.slice(0, reportingMatch.index).trim();
    return reporter !== "我" && !FIRST_PERSON_REPORTER_PATTERN.test(reporter);
  });
}

function findCorrectedKinds(
  text: string,
  currentKind: UserAffectKind
): DetectableUserAffectKind[] {
  const kinds = new Set<DetectableUserAffectKind>(findNegatedKinds(text));
  if (isJokeCorrection(text)) {
    for (const candidate of AFFECT_MENTION_PATTERNS) {
      if (candidate.pattern.test(text)) {
        kinds.add(candidate.kind);
      }
    }
    if (kinds.size === 0 && currentKind !== "unknown") {
      kinds.add(currentKind);
    }
  }
  return [...kinds];
}

function findNegatedKinds(text: string): DetectableUserAffectKind[] {
  const kinds = new Set<DetectableUserAffectKind>();
  for (const candidate of NEGATED_PATTERNS) {
    if (candidate.pattern.test(text)) {
      kinds.add(candidate.kind);
    }
  }
  if (CORRECTION_PREFIX_PATTERN.test(text)) {
    for (const candidate of AFFECT_MENTION_PATTERNS) {
      if (candidate.pattern.test(text)) {
        kinds.add(candidate.kind);
      }
    }
  }
  return [...kinds];
}

function isJokeCorrection(text: string): boolean {
  return !NEGATED_JOKE_PATTERN.test(text) && JOKE_CORRECTION_PATTERN.test(text);
}

function splitAffectClauses(text: string): string[] {
  return text.match(/[^。！？!?；;\n，,：:]+[。！？!?；;\n，,：:]?/gu) ?? [];
}
