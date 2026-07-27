import {
  containsSensitiveMemoryMaterial,
  parseMemoryReviewCandidateDraft,
  type MemoryReviewCandidateDraft
} from "../../../shared/chat-memory";

export type BundledLocalMemoryTarget = {
  baseURL: string;
  model: string;
  localPresetId: "embedded-llama-cpp";
};

export type LocalMemoryExtractionResult =
  | { status: "created" | "blocked"; candidate: MemoryReviewCandidateDraft }
  | { status: "sensitive" | "ambiguous" | "unavailable" | "invalid-output" | "low-confidence" | "failed" | "ignored" };

export type LocalMemoryExtractor = {
  extract(input: { content: string; conversationId: string; messageId: string }): Promise<LocalMemoryExtractionResult>;
};

const DEFAULT_TIMEOUT_MS = 2_500;
const MAX_INPUT_LENGTH = 1_000;
const MEMORY_EXTRACTION_PROMPT = [
  "Extract at most one stable, user-approved-memory candidate from the current user message.",
  "Never infer, diagnose, retain secrets, or retain sensitive personal data.",
  "Use action ignore for no stable fact; use update-suggestion or revoke-suggestion for conflict.",
  "Return exactly one JSON object with action, title, content, tags, namespace, key, importance, category, confidence.",
  "Allowed action: create, update-suggestion, revoke-suggestion, ignore.",
  "Allowed importance: key, general. Confidence must be a number from 0 to 1.",
  "Do not emit markdown, explanations, prompt text, or source messages."
].join("\n");

export function createLocalMemoryExtractor({
  getTarget,
  fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
}: {
  getTarget(): BundledLocalMemoryTarget | null;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): LocalMemoryExtractor {
  return {
    async extract(input) {
      if (containsSensitiveMemoryMaterial(input.content)) return { status: "sensitive" };
      if (containsAmbiguousMemoryMaterial(input.content)) return { status: "ambiguous" };

      const target = getTarget();
      if (!target || !isAllowedBundledTarget(target)) return { status: "unavailable" };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
      timeout.unref?.();
      try {
        const response = await fetchFn(`${target.baseURL.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: target.model,
            messages: [
              { role: "system", content: MEMORY_EXTRACTION_PROMPT },
              { role: "user", content: input.content.slice(0, MAX_INPUT_LENGTH) }
            ],
            temperature: 0,
            max_tokens: 180,
            stream: false,
            chat_template_kwargs: { enable_thinking: false }
          }),
          signal: controller.signal
        });
        if (!response.ok) return { status: "failed" };
        const content = readAssistantContent(await response.json());
        const candidate = parseModelCandidate(content, input.conversationId, input.messageId);
        if (!candidate) return { status: "invalid-output" };
        if (candidate.confidence < 0.7) return { status: "low-confidence" };
        if (containsSensitiveMemoryMaterial(`${candidate.title}\n${candidate.content}\n${candidate.tags.join("\n")}`)) {
          return { status: "invalid-output" };
        }
        if (candidate.action === "ignore") return { status: "ignored" };
        return candidate.action === "create"
          ? { status: "created", candidate }
          : { status: "blocked", candidate };
      } catch {
        return { status: "failed" };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function containsAmbiguousMemoryMaterial(value: string): boolean {
  return /(?:不再|不要|不想|不喜欢|取消|撤回|更正|改成|不是|别叫|不需要|如果|除非|也许|可能|看情况|视情况)/u.test(value);
}

function isAllowedBundledTarget(target: BundledLocalMemoryTarget): boolean {
  if (target.localPresetId !== "embedded-llama-cpp" || target.model.trim().length === 0) return false;
  try {
    const url = new URL(target.baseURL);
    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function readAssistantContent(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length !== 1 || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function parseModelCandidate(content: string | null, sourceConversationId: string, sourceMessageId: string): MemoryReviewCandidateDraft | null {
  if (!content) return null;
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    const keys = Object.keys(value).sort();
    if (keys.join(",") !== "action,category,confidence,content,importance,key,namespace,tags,title") return null;
    return parseMemoryReviewCandidateDraft({ ...value, sourceConversationId, sourceMessageId });
  } catch {
    return null;
  }
}
