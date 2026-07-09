import { redactPersonaSelfIdentityDrift } from "../../../shared/persona-self-identity";

const PRIVATE_MARKER_REPLACEMENT = "[私有标记]";
const SECRET_REPLACEMENT = "[敏感密钥]";
const TOKEN_REPLACEMENT = "[敏感令牌]";
const LOCAL_PATH_REPLACEMENT = "[本地路径]";
const STREAM_HOLDBACK_LENGTH = 160;

export function redactAssistantReplyPrivateMarkers(text: string): string {
  if (!text) {
    return "";
  }

  return text
    .replace(/[A-Za-z]:\\[^\r\n"'<>|]+/gu, LOCAL_PATH_REPLACEMENT)
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, SECRET_REPLACEMENT)
    .replace(/Bearer\s+[^\s，。！？；、]+/giu, TOKEN_REPLACEMENT)
    .replace(/\bAI_DESKTOP_PET_API_KEY\b/giu, PRIVATE_MARKER_REPLACEMENT)
    .replace(/\b[A-Z0-9-]{2,}_[A-Z0-9_-]*SENTINEL[A-Z0-9_-]*\b/gu, PRIVATE_MARKER_REPLACEMENT)
    .replace(/\b(?:PRIVATE|SECRET|TOKEN)[_-][A-Za-z0-9_-]+\b/gu, PRIVATE_MARKER_REPLACEMENT);
}

export function redactAssistantPersonaSelfIdentityDrift(text: string): string {
  return redactPersonaSelfIdentityDrift(text);
}

export function sanitizeAssistantReplyForDisplay(text: string): string {
  return redactAssistantPersonaSelfIdentityDrift(redactAssistantReplyPrivateMarkers(text));
}

export function createAssistantReplyPrivacyStreamGuard(onDelta: (text: string) => void): {
  push(text: string): void;
  flush(): void;
} {
  let pending = "";

  return {
    push(text) {
      if (!text) {
        return;
      }

      pending += text;

      if (pending.length <= STREAM_HOLDBACK_LENGTH) {
        return;
      }

      const emitLength = pending.length - STREAM_HOLDBACK_LENGTH;
      const safeText = sanitizeAssistantReplyForDisplay(pending.slice(0, emitLength));
      pending = pending.slice(emitLength);

      if (safeText) {
        onDelta(safeText);
      }
    },
    flush() {
      const safeText = sanitizeAssistantReplyForDisplay(pending);
      pending = "";

      if (safeText) {
        onDelta(safeText);
      }
    }
  };
}
