import { parseAutomaticSituationClassification } from "../../../shared/automatic-situation-context.ts";
import type {
  AutomaticSituationClassifier,
  AutomaticSituationClassifierResult
} from "./automatic-situation-coordinator.ts";

export type BundledLocalSituationTarget = {
  baseURL: string;
  model: string;
  localPresetId: "embedded-llama-cpp";
};

const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_MINIMUM_CONFIDENCE = 0.68;
const MAX_CLASSIFICATION_TEXT_LENGTH = 1_000;
const CLASSIFIER_SYSTEM_PROMPT = [
  "Classify only the current user message for a desktop companion.",
  "Allowed labels: default, work, game, reading.",
  "work means creating, coding, planning, studying, or completing a task.",
  "game means the speaker explicitly says they are playing now, are about to start or resume playing, or are currently in a game or match.",
  "Game knowledge, development, reviews, news, stories, and another person's play are not game; use work, reading, or default instead.",
  "reading means primarily reading, reviewing, or understanding written material.",
  "default means ordinary conversation or uncertainty.",
  "Return exactly one JSON object with exactly two fields:",
  '{"label":"default|work|game|reading","confidence":0.00}',
  "Do not output markdown, explanation, actions, focus, quiet, or sleep."
].join("\n");

const EXPLICIT_CURRENT_GAME_ACTIVITY_PATTERNS = [
  /(?:^|[\s，。！？、；：,.!?;:])(?:我|我们|咱|咱们)(?:现在|此刻|这会儿|目前|马上|待会儿|等会儿|一会儿|接下来|已经|还)?(?:正(?:在)?|在|还在|已经在|准备(?:要|去)?|打算(?:去)?|马上(?:要|去)?|就要|要去)(?:现在|马上|待会儿|等会儿|一会儿|接下来)?(?:开始|继续|一起|去)?(?:玩|打|开黑|排位|匹配|开一局|来一局|进游戏|上游戏)/u,
  /(?:^|[\s，。！？、；：,.!?;:])(?:现在|此刻|这会儿|目前|马上|待会儿|等会儿|一会儿|接下来|正(?:在)?|准备(?:要|去)?|打算(?:去)?|就要|要去)(?:现在|马上|待会儿|等会儿|一会儿|接下来)?(?:开始|继续|一起|去)?(?:玩|打|开黑|排位|匹配|开一局|来一局|进游戏|上游戏)/u,
  /(?:^|[\s，。！？、；：,.!?;:])(?:我|我们|咱|咱们)(?:现在|此刻|这会儿|目前|已经|还)?(?:正(?:在)?|在|还在|已经在)?(?:游戏|对局|排位|匹配|副本|开黑)(?:中|里|内)(?:$|[\s，。！？、；：,.!?;:])/u,
  /^(?:现在|此刻|这会儿|目前|正(?:在)?|还在|已经在)?(?:游戏|对局|排位|匹配|副本|开黑)(?:中|里|内)(?:了|呢)?[\s，。！？,.!]*$/u,
  /\b(?:i(?:'m| am)|we(?:'re| are))\s+(?:(?:currently|now)\s+)?(?:playing|gaming|in\s+(?:a\s+|the\s+)?(?:game|match|queue|lobby))\b/iu,
  /\b(?:i(?:'m| am)|we(?:'re| are))\s+(?:about to|going to|getting ready to|planning to)\s+(?:start|resume|play|game|queue)\b/iu,
  /\b(?:i|we)\s+(?:will|want to|plan to)\s+(?:play|start|resume|queue)\b/iu,
  /\blet'?s\s+(?:play|queue|start\s+(?:a|the)\s+game)\b/iu
] as const;

export function createBundledLocalSituationClassifier({
  getTarget,
  fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minimumConfidence = DEFAULT_MINIMUM_CONFIDENCE
}: {
  getTarget(): BundledLocalSituationTarget | null;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  minimumConfidence?: number;
}): AutomaticSituationClassifier {
  return {
    async classify({ text, signal }) {
      const target = getTarget();
      if (!target || !isAllowedBundledTarget(target)) {
        return defaultResult("unavailable");
      }

      const controller = new AbortController();
      let timeoutReached = false;
      const abortFromCaller = (): void => controller.abort();
      if (signal?.aborted) {
        controller.abort();
      } else {
        signal?.addEventListener("abort", abortFromCaller, { once: true });
      }
      const timeout = setTimeout(() => {
        timeoutReached = true;
        controller.abort();
      }, Math.max(1, timeoutMs));
      timeout.unref?.();

      try {
        const response = await fetchFn(`${target.baseURL.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: target.model,
            messages: [
              { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
              { role: "user", content: text.slice(0, MAX_CLASSIFICATION_TEXT_LENGTH) }
            ],
            temperature: 0,
            max_tokens: 32,
            stream: false,
            chat_template_kwargs: { enable_thinking: false }
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          return defaultResult("failed");
        }

        const content = readAssistantContent(await response.json());
        const parsed = parseAutomaticSituationClassification(content);
        if (!parsed) {
          return defaultResult("invalid-output");
        }
        if (parsed.label === "game" && !isExplicitCurrentGameActivity(text)) {
          return defaultResult("invalid-output");
        }
        if (parsed.confidence < minimumConfidence) {
          return defaultResult("low-confidence");
        }

        return {
          contextId: parsed.label,
          confidence: parsed.confidence,
          status: "classified"
        };
      } catch {
        return defaultResult(timeoutReached ? "timeout" : "failed");
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromCaller);
      }
    }
  };
}

function isExplicitCurrentGameActivity(text: string): boolean {
  const normalized = text.normalize("NFKC").trim();
  return normalized.length > 0 && EXPLICIT_CURRENT_GAME_ACTIVITY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isAllowedBundledTarget(target: BundledLocalSituationTarget): boolean {
  if (target.localPresetId !== "embedded-llama-cpp" || target.model.trim().length === 0) {
    return false;
  }

  try {
    const url = new URL(target.baseURL);
    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function readAssistantContent(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length !== 1) {
    return null;
  }
  const message = choices[0] && typeof choices[0] === "object"
    ? (choices[0] as { message?: unknown }).message
    : null;
  if (!message || typeof message !== "object") {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function defaultResult(
  status: Exclude<AutomaticSituationClassifierResult["status"], "classified">
): AutomaticSituationClassifierResult {
  return { contextId: "default", confidence: null, status };
}
