import * as pangu from "pangu";

type PanguSpacing = {
  spacingText(text: string): string;
};

const panguSpacing = resolvePanguSpacing(pangu);

function resolvePanguSpacing(value: unknown): PanguSpacing {
  const namespaceValue = value as { default?: unknown; spacingText?: unknown };
  const candidate = typeof namespaceValue.spacingText === "function"
    ? namespaceValue
    : namespaceValue.default as { spacingText?: unknown } | undefined;

  if (!candidate || typeof candidate.spacingText !== "function") {
    throw new Error("pangu spacingText is unavailable");
  }

  return candidate as PanguSpacing;
}

export function polishAssistantDisplayText(text: unknown): string {
  if (typeof text !== "string" || text.length === 0) {
    return "";
  }

  return panguSpacing.spacingText(text);
}
