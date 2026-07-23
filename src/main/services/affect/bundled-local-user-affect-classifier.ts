import { parseUserAffectClassification } from "../../../shared/companion-affect.ts";
import type {
  UserAffectClassifier,
  UserAffectClassifierResult,
  UserAffectClassificationStatus
} from "./perceived-user-affect.ts";

export type BundledLocalUserAffectTarget = {
  baseURL: string;
  model: string;
  localPresetId: "embedded-llama-cpp";
};

const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_MINIMUM_CONFIDENCE = 0.68;
const MAX_CLASSIFICATION_TEXT_LENGTH = 1_000;
const CLASSIFIER_SYSTEM_PROMPT = [
  "Classify only the current user's affect in the current user message.",
  "Allowed labels: unknown, calm, positive, excited, low, tense, tired.",
  "Use unknown for uncertainty, jokes, negation, quoted feelings, or another person's feelings.",
  "Do not diagnose the user and do not infer from background activity or metadata.",
  "Return exactly one JSON object with exactly two fields:",
  '{"label":"unknown|calm|positive|excited|low|tense|tired","confidence":0.00}',
  "Do not output markdown, explanation, actions, expressions, or resources."
].join("\n");

export function createBundledLocalUserAffectClassifier({
  getTarget,
  fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minimumConfidence = DEFAULT_MINIMUM_CONFIDENCE
}: {
  getTarget(): BundledLocalUserAffectTarget | null;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  minimumConfidence?: number;
}): UserAffectClassifier {
  return {
    async classify({ text, signal }) {
      const target = getTarget();
      if (!target || !isAllowedBundledTarget(target)) {
        return fallbackResult("unavailable");
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
          return fallbackResult("failed");
        }

        const content = readAssistantContent(await response.json());
        const parsed = parseUserAffectClassification(content);
        if (!parsed) {
          return fallbackResult("invalid-output");
        }
        if (parsed.confidence < minimumConfidence) {
          return fallbackResult("low-confidence");
        }
        if (parsed.label === "unknown") {
          return {
            kind: "unknown",
            confidence: "low",
            source: "conversational-inference",
            status: "classified"
          };
        }

        return {
          kind: parsed.label,
          confidence: "medium",
          source: "conversational-inference",
          status: "classified"
        };
      } catch {
        return fallbackResult(timeoutReached ? "timeout" : "failed");
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromCaller);
      }
    }
  };
}

function isAllowedBundledTarget(target: BundledLocalUserAffectTarget): boolean {
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

function fallbackResult(status: Exclude<UserAffectClassificationStatus, "classified">): UserAffectClassifierResult {
  return {
    kind: "unknown",
    confidence: "low",
    source: "conversational-inference",
    status
  };
}
