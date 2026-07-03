import type {
  WebSearchPrivacyDecision,
  WebSearchReasonCode
} from "../../../shared/web-search";
import { classifySearchQuery } from "./search-query-classifier";

export type SearchPrivacyGatewayInput = {
  text: string;
  enabled: boolean;
};

const MAX_SAFE_QUERY_LENGTH = 160;
const SECRET_PATTERN = /(api\s*key|密钥|密码|password|token|secret|sk-[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]+)/i;
const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:\\|\\\\|\/Users\/|\/home\/|\/mnt\/|file:\/\/)[^\s，。！？；;]+/g;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s-]{7,}\d)/g;
const ID_CARD_PATTERN = /\b\d{15}(?:\d{2}[\dXx])?\b/g;
const PRIVATE_MEMORY_PATTERN = /(我的|我).{0,12}(聊天记录|历史|记忆|事实卡|住址|地址|手机号|身份证|邮箱|密码|密钥|token|API\s*key)/i;

export function createSearchPrivacyDecision(input: SearchPrivacyGatewayInput): WebSearchPrivacyDecision {
  const classification = classifySearchQuery(input.text);
  const reasonCodes: WebSearchReasonCode[] = [...classification.reasonCodes];

  if (!input.enabled) {
    return createDecision("blocked", "", addReason(reasonCodes, "search_disabled"), "联网搜索未启用。");
  }

  if (!classification.shouldSearch) {
    return createDecision("blocked", "", reasonCodes, "未识别到明确搜索意图或实时外部事实需求。");
  }

  const normalized = normalizeText(input.text);

  if (!normalized) {
    return createDecision("blocked", "", addReason(reasonCodes, "empty_query"), "搜索文本为空。");
  }

  if (SECRET_PATTERN.test(normalized)) {
    return createDecision("blocked", "", addReason(reasonCodes, "sensitive_secret"), "包含密钥、密码或令牌类敏感信息。");
  }

  if (PRIVATE_MEMORY_PATTERN.test(normalized)) {
    return createDecision("blocked", "", addReason(reasonCodes, "private_memory_request"), "包含个人记忆、历史或身份信息请求。");
  }

  const redactions: WebSearchReasonCode[] = [];
  let safeQuery = stripSearchCommand(normalized);

  safeQuery = safeQuery.replace(LOCAL_PATH_PATTERN, () => {
    redactions.push("redacted_local_path");
    return " ";
  });
  safeQuery = safeQuery.replace(EMAIL_PATTERN, () => {
    redactions.push("redacted_personal_identifier");
    return " ";
  });
  safeQuery = safeQuery.replace(PHONE_PATTERN, () => {
    redactions.push("redacted_personal_identifier");
    return " ";
  });
  safeQuery = safeQuery.replace(ID_CARD_PATTERN, () => {
    redactions.push("redacted_personal_identifier");
    return " ";
  });

  safeQuery = normalizeQuery(safeQuery);

  if (!safeQuery) {
    return createDecision(
      "blocked",
      "",
      addReasons(reasonCodes, redactions.length > 0 ? redactions : ["empty_query"]),
      "净化后没有可发送给 MCP 搜索的公开查询。"
    );
  }

  const dedupedReasons = addReasons(reasonCodes, redactions);
  const status = redactions.length > 0 ? "redacted" : "allowed";
  const redactionSummary = redactions.length > 0
    ? "已移除本地路径或个人标识符，只保留公开查询词。"
    : "无需移除敏感内容。";

  return createDecision(status, safeQuery, dedupedReasons, redactionSummary);
}

function stripSearchCommand(text: string): string {
  return text
    .replace(/记住这点[:：]?\s*/g, "")
    .replace(/请你|麻烦你|帮我|帮忙/g, "")
    .replace(/(?:联网|上网|网络|网页|web|internet|mcp).{0,8}(?:搜索|查询|查找|查证|检索|找一下|看一下)/gi, " ")
    .replace(/(?:搜索一下|搜一下|搜搜|搜索|查一下|查找|检索|查证|看看网上|网上看看)/gi, " ");
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeQuery(input: string): string {
  return input
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SAFE_QUERY_LENGTH)
    .trim();
}

function createDecision(
  status: WebSearchPrivacyDecision["status"],
  safeQuery: string,
  reasonCodes: WebSearchReasonCode[],
  redactionSummary: string
): WebSearchPrivacyDecision {
  return {
    status,
    safeQuery,
    reasonCodes: [...new Set(reasonCodes)],
    redactionSummary
  };
}

function addReason(
  reasonCodes: WebSearchReasonCode[],
  reasonCode: WebSearchReasonCode
): WebSearchReasonCode[] {
  return addReasons(reasonCodes, [reasonCode]);
}

function addReasons(
  reasonCodes: WebSearchReasonCode[],
  nextReasonCodes: readonly WebSearchReasonCode[]
): WebSearchReasonCode[] {
  return [...new Set([...reasonCodes, ...nextReasonCodes])];
}
