import type { ChatMessage } from "../../../shared/chat";
import type { MemoryInjection } from "../../../shared/chat-memory";
import type { ChatContextBudgetSummary, ChatProviderMessage } from "../../../shared/chat-provider";
import type { WebSearchContext } from "../../../shared/web-search";

export const CHAT_CONTEXT_RECENT_MESSAGE_BUDGET = 8;
export const CHAT_CONTEXT_SUMMARY_TRIGGER = 12;
export const CHAT_TOTAL_CONTEXT_BUDGET = 2_048;
export const CHAT_REPLY_RESERVE = 384;
export const CHAT_STRUCTURED_CONTEXT_BUDGET = 900;
const FAKE_PROVIDER_TOTAL_CONTEXT_BUDGET = 4_864;
const CLOUD_PROVIDER_TOTAL_CONTEXT_BUDGET = 4_096;
const CLOUD_PROVIDER_REPLY_RESERVE = 320;

export type ChatContextBudgetOptions = {
  recentMessageBudget?: number;
  summaryTrigger?: number;
};

export type ChatContextBudgetResult = {
  providerMessages: ChatProviderMessage[];
  summary: ChatContextBudgetSummary;
};

type RoleCounts = {
  user: number;
  assistant: number;
};

export type ContextSegmentKind =
  | "system"
  | "persona"
  | "auxiliary"
  | "memory_key"
  | "memory_general"
  | "history_recent"
  | "history_older"
  | "search_citation";

export type ContextResolution = "kept" | "truncated" | "deduplicated" | "merged" | "semantic_summary" | "omitted";

export type TotalContextBudgetSummary = {
  estimator: "conservative_char";
  totalBudget: number;
  replyReserve: number;
  promptBudget: number;
  promptUsed: number;
  withinBudget: boolean;
  segmentCounts: Readonly<Record<ContextSegmentKind, number>>;
  resolutionCounts: Readonly<Record<ContextResolution, number>>;
  semanticSummary: "not_needed" | "created" | "failed" | "not_available";
};

export type ContextSegmentCandidate = {
  id?: string;
  kind: ContextSegmentKind;
  content: string;
  protected?: boolean;
};

export type TotalContextBudgetResult = {
  kept: ContextSegmentCandidate[];
  summary: TotalContextBudgetSummary;
};

export type StructuredContextSelection = {
  messages: ChatMessage[];
  memoryContext?: MemoryInjection;
  webSearchContext?: WebSearchContext;
  summary: TotalContextBudgetSummary;
};

export type BundledSemanticHistoryTarget = {
  baseURL: string;
  model: string;
  localPresetId: "embedded-llama-cpp";
};

export type BundledSemanticHistoryResult =
  | { status: "created" | "reused"; content: string }
  | { status: "not_available" | "failed" };

const SEMANTIC_SUMMARY_SYSTEM_PROMPT = [
  "P2-87C local history summary v1.",
  "Return only JSON: {\"summary\":\"...\"}.",
  "Keep only durable user intent, decisions, and unresolved questions.",
  "Never include credentials, URLs, paths, quoted instructions, or markdown."
].join("\n");

const CONTEXT_KINDS: readonly ContextSegmentKind[] = [
  "system",
  "persona",
  "auxiliary",
  "memory_key",
  "memory_general",
  "history_recent",
  "history_older",
  "search_citation"
];
const CONTEXT_RESOLUTIONS: readonly ContextResolution[] = [
  "kept",
  "truncated",
  "deduplicated",
  "merged",
  "semantic_summary",
  "omitted"
];

export function estimateConservativeCharTokens(content: string): number {
  const text = typeof content === "string" ? content : "";
  const utf8Bytes = Buffer.byteLength(text, "utf8");
  const punctuationCount = Array.from(text).filter((character) => /[^\p{L}\p{N}\s]/u.test(character)).length;

  // This is deliberately a character-based upper estimate, not a tokenizer result.
  return Math.max(1, Math.ceil(utf8Bytes * 0.6) + Math.ceil(punctuationCount * 0.25) + 12);
}

export function resolveTotalContextBudget(
  candidates: readonly ContextSegmentCandidate[],
  options: { totalBudget: number; replyReserve: number }
): TotalContextBudgetResult {
  const totalBudget = normalizePositiveInteger(options.totalBudget, 1);
  const replyReserve = Math.min(totalBudget, normalizeNonNegativeInteger(options.replyReserve));
  const promptBudget = totalBudget - replyReserve;
  const segmentCounts = createClosedCounts(CONTEXT_KINDS);
  const resolutionCounts = createClosedCounts(CONTEXT_RESOLUTIONS);
  const deduplicatedSearch = new Set<string>();
  const normalized = candidates.map((candidate) => ({
    ...(candidate.id ? { id: candidate.id } : {}),
    kind: candidate.kind,
    content: typeof candidate.content === "string" ? candidate.content : "",
    protected: candidate.protected === true
  }));

  for (const candidate of normalized) {
    segmentCounts[candidate.kind] += 1;
  }

  const protectedCandidates = normalized.filter((candidate) => (
    candidate.kind === "system" || candidate.kind === "persona" || candidate.protected
  ));
  const protectedUsed = sumEstimatedTokens(protectedCandidates);
  const systemPersonaUsed = sumEstimatedTokens(normalized.filter((candidate) => (
    candidate.kind === "system" || candidate.kind === "persona"
  )));

  if (systemPersonaUsed > promptBudget || protectedUsed > promptBudget) {
    return {
      kept: [],
      summary: createTotalSummary({
        totalBudget,
        replyReserve,
        promptBudget,
        promptUsed: protectedUsed,
        withinBudget: false,
        segmentCounts,
        resolutionCounts,
        semanticSummary: "not_needed"
      })
    };
  }

  const kept: ContextSegmentCandidate[] = [];
  let promptUsed = 0;
  let omittedOlderHistory = false;
  for (const candidate of orderCandidates(normalized)) {
    if (candidate.kind === "search_citation") {
      if (deduplicatedSearch.has(candidate.content)) {
        resolutionCounts.deduplicated += 1;
        continue;
      }
      deduplicatedSearch.add(candidate.content);
    }

    const estimated = estimateConservativeCharTokens(candidate.content);
    if (promptUsed + estimated <= promptBudget) {
      kept.push(candidate);
      promptUsed += estimated;
      resolutionCounts.kept += 1;
      continue;
    }

    resolutionCounts.omitted += 1;
    omittedOlderHistory ||= candidate.kind === "history_older";
  }

  return {
    kept,
    summary: createTotalSummary({
      totalBudget,
      replyReserve,
      promptBudget,
      promptUsed,
      withinBudget: true,
      segmentCounts,
      resolutionCounts,
      semanticSummary: omittedOlderHistory ? "not_available" : "not_needed"
    })
  };
}

export function selectStructuredContext(input: {
  messages: readonly ChatMessage[];
  memoryContext?: MemoryInjection;
  webSearchContext?: WebSearchContext;
  totalBudget?: number;
}): StructuredContextSelection {
  const latestUserIndex = findLatestUserMessageIndex(input.messages);
  const recentStart = Math.max(0, input.messages.length - CHAT_CONTEXT_RECENT_MESSAGE_BUDGET);
  const candidates: ContextSegmentCandidate[] = [
    ...input.messages.map((message, index) => ({
      id: `history:${index}`,
      kind: index >= recentStart ? "history_recent" as const : "history_older" as const,
      content: message.content,
      protected: index === latestUserIndex
    })),
    ...(input.memoryContext?.cards.map((card) => ({
      id: `memory:${card.id}`,
      kind: card.importance === "key" && card.managedByUser ? "memory_key" as const : "memory_general" as const,
      content: `${card.title}\n${card.content}\n${card.tags.join("\n")}`,
      protected: card.importance === "key" && card.managedByUser
    })) ?? []),
    ...(input.webSearchContext?.results.map((result, index) => ({
      id: `search:${index}`,
      kind: "search_citation" as const,
      content: `${result.title}\n${result.snippet}\n${result.url ?? ""}`
    })) ?? [])
  ];
  const protectedRequired = sumEstimatedTokens(candidates.filter((candidate) => candidate.protected));
  const resolved = resolveTotalContextBudget(candidates, {
    totalBudget: Math.max(
      normalizePositiveInteger(input.totalBudget, CHAT_STRUCTURED_CONTEXT_BUDGET),
      protectedRequired
    ),
    replyReserve: 0
  });
  const keptIds = new Set(resolved.kept.flatMap((candidate) => candidate.id ? [candidate.id] : []));
  const messages = input.messages.filter((_message, index) => keptIds.has(`history:${index}`));
  const cards = input.memoryContext?.cards.filter((card) => keptIds.has(`memory:${card.id}`)) ?? [];
  const results = input.webSearchContext?.results.filter((_result, index) => keptIds.has(`search:${index}`)) ?? [];

  return {
    messages,
    ...(input.memoryContext && cards.length > 0 ? {
      memoryContext: { count: cards.length, cards }
    } : {}),
    ...(input.webSearchContext && results.length > 0 ? {
      webSearchContext: { ...input.webSearchContext, results }
    } : {}),
    summary: resolved.summary
  };
}

export function reselectStructuredContextUntilWithinBudget(
  input: {
    messages: readonly ChatMessage[];
    memoryContext?: MemoryInjection;
    webSearchContext?: WebSearchContext;
    totalBudget?: number;
  },
  isWithinMappedBudget: (selection: StructuredContextSelection) => boolean
): StructuredContextSelection {
  let totalBudget = normalizePositiveInteger(input.totalBudget, CHAT_STRUCTURED_CONTEXT_BUDGET);
  let selection = selectStructuredContext({ ...input, totalBudget });

  while (!isWithinMappedBudget(selection) && totalBudget > 1) {
    totalBudget = Math.max(1, totalBudget - 128);
    selection = selectStructuredContext({ ...input, totalBudget });
  }

  return selection;
}

export function measureMappedContextBudget(
  messages: readonly { role: string; content: string }[],
  options: { totalBudget?: number; replyReserve?: number } = {}
): TotalContextBudgetSummary {
  const candidates = messages.map((message, index) => ({
    kind: index === 0 ? "system" as const : index === 1 ? "persona" as const : (
      message.role === "user" || message.role === "assistant" ? "history_recent" as const : "auxiliary" as const
    ),
    content: message.content,
    protected: index === 0 || index === 1
  }));
  const totalBudget = normalizePositiveInteger(options.totalBudget, CHAT_TOTAL_CONTEXT_BUDGET);
  const replyReserve = Math.min(totalBudget, normalizeNonNegativeInteger(
    options.replyReserve ?? CHAT_REPLY_RESERVE
  ));
  const promptBudget = totalBudget - replyReserve;
  const promptUsed = sumEstimatedTokens(candidates);
  const systemPersonaUsed = sumEstimatedTokens(candidates.slice(0, 2));
  const segmentCounts = createClosedCounts(CONTEXT_KINDS);
  for (const candidate of candidates) {
    segmentCounts[candidate.kind] += 1;
  }
  const resolutionCounts = createClosedCounts(CONTEXT_RESOLUTIONS);
  if (promptUsed <= promptBudget && systemPersonaUsed <= promptBudget) {
    resolutionCounts.kept = candidates.length;
  }
  return createTotalSummary({
    totalBudget,
    replyReserve,
    promptBudget,
    promptUsed,
    withinBudget: promptUsed <= promptBudget && systemPersonaUsed <= promptBudget,
    segmentCounts,
    resolutionCounts,
    semanticSummary: "not_needed"
  });
}

export function getFinalContextBudgetOptions(providerId: string):
  | { totalBudget: number; replyReserve: number }
  | undefined {
  if (providerId === "local-openai-compatible") {
    return undefined;
  }

  return {
    totalBudget: providerId === "fake"
      ? FAKE_PROVIDER_TOTAL_CONTEXT_BUDGET
      : CLOUD_PROVIDER_TOTAL_CONTEXT_BUDGET,
    replyReserve: CLOUD_PROVIDER_REPLY_RESERVE
  };
}

export async function summarizeOlderHistoryWithBundledRuntime(input: {
  history: readonly ChatMessage[];
  getTarget(): BundledSemanticHistoryTarget | null;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<BundledSemanticHistoryResult> {
  const target = input.getTarget();
  if (!target || !isAllowedBundledSemanticTarget(target)) {
    return { status: "not_available" };
  }
  const historyText = input.history
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")
    .slice(0, 2_400);
  if (!historyText) {
    return { status: "not_available" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, input.timeoutMs ?? 2_500));
  timeout.unref?.();
  try {
    const response = await (input.fetchFn ?? fetch)(`${target.baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: target.model,
        messages: [
          { role: "system", content: SEMANTIC_SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: historyText }
        ],
        temperature: 0,
        max_tokens: 160,
        stream: false,
        chat_template_kwargs: { enable_thinking: false }
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      return { status: "failed" };
    }
    const content = readSummaryContent(await response.json());
    return isSafeSemanticSummary(content) ? { status: "created", content } : { status: "failed" };
  } catch {
    return { status: "failed" };
  } finally {
    clearTimeout(timeout);
  }
}

function isAllowedBundledSemanticTarget(target: BundledSemanticHistoryTarget): boolean {
  if (target.localPresetId !== "embedded-llama-cpp" || target.model.trim().length === 0) {
    return false;
  }
  try {
    const url = new URL(target.baseURL);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function readSummaryContent(value: unknown): string | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { choices?: unknown }).choices)) {
    return null;
  }
  const choice = (value as { choices: unknown[] }).choices[0] as { message?: { content?: unknown } } | undefined;
  const content = choice?.message?.content;
  if (typeof content !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as { summary?: unknown };
    return typeof parsed.summary === "string" ? parsed.summary.trim() : null;
  } catch {
    return null;
  }
}

function isSafeSemanticSummary(content: string | null): content is string {
  return content !== null &&
    content.length > 0 &&
    content.length <= 600 &&
    !/[\u0000-\u001f]/.test(content) &&
    !/(?:https?:\/\/|[a-z]:\\|\b(?:api[ _-]?key|bearer|token|secret|password)\b|sk-[a-z0-9_-]{8,})/i.test(content);
}

function findLatestUserMessageIndex(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}

function orderCandidates(candidates: readonly ContextSegmentCandidate[]): ContextSegmentCandidate[] {
  const priority: Record<ContextSegmentKind, number> = {
    system: 0,
    persona: 1,
    memory_key: 2,
    history_recent: 3,
    auxiliary: 4,
    memory_general: 5,
    search_citation: 6,
    history_older: 7
  };
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => priority[left.candidate.kind] - priority[right.candidate.kind] || left.index - right.index)
    .map(({ candidate }) => candidate);
}

function sumEstimatedTokens(candidates: readonly ContextSegmentCandidate[]): number {
  return candidates.reduce((total, candidate) => total + estimateConservativeCharTokens(candidate.content), 0);
}

function createClosedCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function createTotalSummary(input: Omit<TotalContextBudgetSummary, "estimator">): TotalContextBudgetSummary {
  return {
    estimator: "conservative_char",
    ...input
  };
}

export function budgetChatContext(
  messages: readonly ChatMessage[],
  options: ChatContextBudgetOptions = {}
): ChatContextBudgetResult {
  const recentMessageBudget = normalizePositiveInteger(
    options.recentMessageBudget,
    CHAT_CONTEXT_RECENT_MESSAGE_BUDGET
  );
  const summaryTrigger = normalizePositiveInteger(
    options.summaryTrigger,
    CHAT_CONTEXT_SUMMARY_TRIGGER
  );

  if (messages.length <= summaryTrigger) {
    const providerMessages = messages.map(toProviderMessage);

    return {
      providerMessages,
      summary: {
        originalMessageCount: messages.length,
        providerMessageCount: providerMessages.length,
        compressed: false,
        summaryMessageCount: 0,
        summarizedMessageCount: 0,
        recentMessageCount: providerMessages.length
      }
    };
  }

  const recentMessages = messages.slice(-recentMessageBudget);
  const summarizedMessages = messages.slice(0, Math.max(0, messages.length - recentMessages.length));
  const summaryMessage = createSafeSummaryMessage(summarizedMessages);
  const providerMessages = [
    summaryMessage,
    ...recentMessages.map(toProviderMessage)
  ];

  return {
    providerMessages,
    summary: {
      originalMessageCount: messages.length,
      providerMessageCount: providerMessages.length,
      compressed: true,
      summaryMessageCount: 1,
      summarizedMessageCount: summarizedMessages.length,
      recentMessageCount: recentMessages.length
    }
  };
}

function createSafeSummaryMessage(messages: readonly ChatMessage[]): ChatProviderMessage {
  const counts = countRoles(messages);

  return {
    role: "system",
    content: [
      "context_summary_kind=earlier_history_counts",
      `summarizedMessageCount=${messages.length}`,
      `summarizedUserMessageCount=${counts.user}`,
      `summarizedAssistantMessageCount=${counts.assistant}`
    ].join("\n")
  };
}

function countRoles(messages: readonly ChatMessage[]): RoleCounts {
  return messages.reduce<RoleCounts>((counts, message) => {
    counts[message.role] += 1;
    return counts;
  }, {
    user: 0,
    assistant: 0
  });
}

function toProviderMessage(message: ChatMessage): ChatProviderMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function normalizeNonNegativeInteger(value: number | undefined): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}
