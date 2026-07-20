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
  "Allowed labels: default, work, reading.",
  "work means creating, coding, planning, studying, or completing a task.",
  "Game development is work. Game knowledge, reviews, news, and stories are reading or default.",
  "reading means primarily reading, reviewing, or understanding written material.",
  "default means ordinary conversation or uncertainty.",
  "Return exactly one JSON object with exactly two fields:",
  '{"label":"default|work|reading","confidence":0.00}',
  "Do not output markdown, explanation, actions, focus, quiet, or sleep."
].join("\n");

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
