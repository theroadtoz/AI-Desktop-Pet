import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_ECHO_IDLE_MESSAGE,
  formatCompanionShelf,
  formatMemoryActivity,
  formatMemoryRibbon,
  formatModeLabel,
  formatPartnerStatus,
  formatPresenceLabel,
  formatProviderHealthResult,
  formatProviderStatus
} from "../src/renderer/chat/partner-presence-presenter.ts";
import type { ChatMemoryActivityPayload } from "../src/shared/ipc-contract.ts";

function createMemoryActivity(overrides: Partial<ChatMemoryActivityPayload> = {}): ChatMemoryActivityPayload {
  const base: ChatMemoryActivityPayload = {
    requestVersion: 1,
    autoCapture: {
      enabled: true,
      skippedReason: "no_candidate",
      capturedCount: 0,
      keyCount: 0,
      generalCount: 0,
      mergedCount: 0,
      deduplicatedCount: 0,
      compressionTriggered: false,
      totalCards: 0,
      injectionBudget: 8
    },
    injection: {
      count: 0
    },
    contextBudget: {
      compressed: false,
      summaryMessageCount: 0,
      summarizedMessageCount: 0,
      recentMessageCount: 1
    }
  };

  return {
    ...base,
    ...overrides,
    autoCapture: {
      ...base.autoCapture,
      ...overrides.autoCapture
    },
    injection: {
      ...base.injection,
      ...overrides.injection
    },
    contextBudget: {
      ...base.contextBudget,
      ...overrides.contextBudget
    }
  };
}

test("provider status keeps fake, cloud, local, and fallback wording", () => {
  assert.equal(formatProviderStatus({
    providerId: "fake",
    displayName: "Fake Provider",
    isFallback: false
  }), "开发模式：Fake Provider（不会调用真实模型）");
  assert.equal(formatProviderStatus({
    providerId: "openai-compatible",
    displayName: "External OpenAI-compatible",
    model: "external-chat-model",
    baseURLHost: "api.example.com",
    isFallback: false
  }), "外部模型：external-chat-model · api.example.com");
  assert.equal(formatProviderStatus({
    providerId: "local-openai-compatible",
    displayName: "Ollama 本地模型",
    model: "qwen2.5:3b-instruct",
    baseURLHost: "localhost:11434",
    isFallback: false
  }), "本地模型：qwen2.5:3b-instruct · localhost:11434");
  assert.equal(formatProviderStatus({
    providerId: "openai-compatible",
    displayName: "External OpenAI-compatible",
    model: "external-chat-model",
    isFallback: true,
    reason: "missing_api_key"
  }), "外部模型未就绪：需要配置 API Key 后才会发起请求 · external-chat-model");
  assert.equal(formatProviderStatus({
    providerId: "local-openai-compatible",
    displayName: "Ollama 本地模型",
    model: "qwen2.5:3b-instruct",
    isFallback: true,
    reason: "invalid_config"
  }), "模型未就绪：Provider 配置无效，当前不会调用真实模型");
});

test("provider health result wording stays stable", () => {
  assert.equal(formatProviderHealthResult({
    providerId: "local-openai-compatible",
    status: "ready",
    model: "qwen2.5:3b-instruct",
    baseURLHost: "localhost:11434",
    modelCount: 2
  }), "连接可用：已找到当前模型 · localhost:11434 · 可见模型 2 个");
  assert.equal(formatProviderHealthResult({
    providerId: "local-openai-compatible",
    status: "model_missing",
    model: "qwen2.5:3b-instruct",
    baseURLHost: "localhost:11434",
    localPresetId: "ollama",
    modelCount: 1
  }), "Ollama 可达，但未找到 qwen2.5:3b-instruct；请手动运行 ollama pull qwen2.5:3b-instruct 后再检查 · localhost:11434 · 可见模型 1 个");
  assert.equal(formatProviderHealthResult({
    providerId: "local-openai-compatible",
    status: "service_unreachable",
    model: "qwen2.5:3b-instruct",
    baseURLHost: "localhost:11434",
    localPresetId: "ollama"
  }), "Ollama 不可达：请确认已安装并启动 Ollama，且 Base URL 指向 http://localhost:11434/v1 · localhost:11434");
  assert.equal(formatProviderHealthResult({
    providerId: "openai-compatible",
    status: "missing_api_key",
    model: "external-chat-model"
  }), "云端 Provider 需要先配置 API Key；本次未发起检查请求。");
});

test("partner status combines profile, dialogue mode, and presence mode", () => {
  assert.equal(formatModeLabel("default"), "默认陪伴");
  assert.equal(formatModeLabel("work"), "工作模式");
  assert.equal(formatPresenceLabel("quiet"), "安静陪伴");
  assert.equal(formatPartnerStatus({
    userProfileLabel: "小夏",
    dialogueModeId: "reading",
    presenceModeId: "focus"
  }), "桌面伙伴：小夏 · 读书模式 · 存在：专注陪伴");
  assert.equal(formatPartnerStatus({
    userProfileLabel: null,
    dialogueModeId: "default",
    presenceModeId: "default"
  }), "桌面伙伴：等待本地身份 · 默认陪伴 · 存在：默认陪伴");
});

test("memory ribbon handles 0, 1, and many memory counts", () => {
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: null, ribbonEcho: ACTIVITY_ECHO_IDLE_MESSAGE }), {
    text: "这轮没有带入记忆 · 她安静待着",
    state: "fallback"
  });
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: 1, ribbonEcho: "正在回复" }), {
    text: "她带上了 1 条已允许的记忆 · 她在想怎么说",
    state: "ready"
  });
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: 3, ribbonEcho: "回复完成" }), {
    text: "她带上了 3 条已允许的记忆 · 她刚说完",
    state: "ready"
  });
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: 2, ribbonEcho: "已中断" }), {
    text: "她带上了 2 条已允许的记忆 · 她先停在这里",
    state: "ready"
  });
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: null, ribbonEcho: "回复失败" }), {
    text: "这轮没有带入记忆 · 她暂时没接上模型",
    state: "fallback"
  });
});

test("memory activity presenter keeps companion wording and safe fields only", () => {
  assert.deepEqual(formatMemoryActivity(createMemoryActivity({
    autoCapture: {
      enabled: false,
      skippedReason: "disabled",
      capturedCount: 0,
      keyCount: 0,
      generalCount: 0,
      mergedCount: 0,
      deduplicatedCount: 0,
      compressionTriggered: false,
      totalCards: 2,
      injectionBudget: 8
    }
  })), {
    text: "记忆关闭；她不会替你保存，也没有带入记忆",
    state: "fallback"
  });

  assert.deepEqual(formatMemoryActivity(createMemoryActivity({
    autoCapture: {
      enabled: true,
      skippedReason: null,
      capturedCount: 1,
      keyCount: 1,
      generalCount: 0,
      mergedCount: 1,
      deduplicatedCount: 0,
      compressionTriggered: false,
      totalCards: 3,
      injectionBudget: 8
    },
    injection: {
      count: 2
    },
    contextBudget: {
      compressed: true,
      summaryMessageCount: 1,
      summarizedMessageCount: 12,
      recentMessageCount: 8
    }
  })), {
    text: "她刚记下 1 条关键记忆；她整理了 1 条相近记忆；她这轮带上了 2 条已允许的记忆；长会话已收束成安全摘要",
    state: "ready"
  });

  const sensitive = formatMemoryActivity(createMemoryActivity({
    autoCapture: {
      enabled: true,
      skippedReason: "sensitive",
      capturedCount: 0,
      keyCount: 0,
      generalCount: 0,
      mergedCount: 0,
      deduplicatedCount: 0,
      compressionTriggered: false,
      totalCards: 1,
      injectionBudget: 8
    }
  }));

  assert.equal(sensitive.text, "她跳过了敏感内容；这轮没有带入记忆");
  assert.doesNotMatch(sensitive.text, /SECRET_SENTINEL|capturedCount|skippedReason|memoryContext|providerMessages|prompt/);
});

test("companion shelf presenter keeps action echo and lock wording", () => {
  assert.deepEqual(formatCompanionShelf({
    accessoryLabel: "眼镜",
    petScale: 1.15,
    isPetLocked: true,
    activityEcho: "轻轻挥手",
    activityEchoState: "active"
  }), {
    accessoryText: "配件：眼镜",
    scaleText: "大小：115%",
    lockText: "锁定：已锁定",
    lockState: "ready",
    actionEchoText: "小动作：轻轻挥手",
    actionEchoState: "active"
  });
});
