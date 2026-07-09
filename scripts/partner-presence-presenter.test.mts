import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_ECHO_IDLE_MESSAGE,
  formatCompanionShelf,
  formatContextTransparency,
  formatDailyCompanionRhythm,
  formatHistoryContextPreview,
  formatMemoryActivity,
  formatMemoryRibbon,
  formatModeLabel,
  formatPartnerStatus,
  formatPresenceLabel,
  formatProviderHealthResult,
  formatProviderStatus
} from "../src/renderer/chat/partner-presence-presenter.ts";
import type { ChatContextTransparencyPayload, ChatMemoryActivityPayload } from "../src/shared/ipc-contract.ts";

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

function createContextTransparency(overrides: Partial<ChatContextTransparencyPayload> = {}): ChatContextTransparencyPayload {
  const base: ChatContextTransparencyPayload = {
    requestVersion: 1,
    contextBudget: {
      originalMessageCount: 1,
      providerMessageCount: 1,
      compressed: false,
      summaryMessageCount: 0,
      summarizedMessageCount: 0,
      recentMessageCount: 1
    },
    memory: {
      injectionCount: 0
    },
    webSearch: {
      included: false,
      citationCount: 0
    }
  };

  return {
    ...base,
    ...overrides,
    contextBudget: {
      ...base.contextBudget,
      ...overrides.contextBudget
    },
    memory: {
      ...base.memory,
      ...overrides.memory
    },
    webSearch: {
      ...base.webSearch,
      ...overrides.webSearch
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
    providerId: "fake",
    displayName: "本地即时对话",
    isFallback: false
  }), "本地即时对话 · 内置模型准备好后自动切换");
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
  assert.doesNotMatch(formatProviderHealthResult({
    providerId: "local-openai-compatible",
    status: "model_missing",
    model: "ai-desktop-pet-local",
    baseURLHost: "127.0.0.1:8080",
    localPresetId: "embedded-llama-cpp",
    modelCount: 0
  }), /Ollama|ollama/);
  assert.doesNotMatch(formatProviderHealthResult({
    providerId: "local-openai-compatible",
    status: "service_unreachable",
    model: "ai-desktop-pet-local",
    baseURLHost: "127.0.0.1:8080",
    localPresetId: "embedded-llama-cpp"
  }), /Ollama|ollama/);
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
  }), "桌面伙伴：小夏 · 读书模式 · 专注陪伴");
  assert.equal(formatPartnerStatus({
    userProfileLabel: null,
    dialogueModeId: "default",
    presenceModeId: "default"
  }), "桌面伙伴：等待本地身份 · 默认陪伴 · 默认陪伴");
});

test("memory ribbon handles 0, 1, and many memory counts", () => {
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: null, ribbonEcho: ACTIVITY_ECHO_IDLE_MESSAGE }), {
    text: "她这轮轻装陪着 · 她安静待着",
    state: "fallback"
  });
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: 1, ribbonEcho: "正在回复" }), {
    text: "她带着 1 条已允许的记忆靠近 · 她在想怎么说",
    state: "ready"
  });
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: 3, ribbonEcho: "回复完成" }), {
    text: "她带着 3 条已允许的记忆靠近 · 她刚说完",
    state: "ready"
  });
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: 2, ribbonEcho: "已中断" }), {
    text: "她带着 2 条已允许的记忆靠近 · 她先停在这里",
    state: "ready"
  });
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: null, ribbonEcho: "回复失败" }), {
    text: "她这轮轻装陪着 · 她暂时没接上模型",
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
    text: "记忆关闭；她只陪你聊，不会替你保存",
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
    text: "她刚记下 1 条新记忆；她整理了 1 条相近记忆；她带着 2 条已允许的记忆靠近；她把长聊收拢成轻便脉络",
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

  assert.equal(sensitive.text, "她把敏感部分先放下；她这轮轻装陪着");
  assert.doesNotMatch(sensitive.text, /SECRET_SENTINEL|capturedCount|skippedReason|memoryContext|providerMessages|prompt|注入|安全摘要/);
});

test("context transparency presenter describes short and compressed turns without debug fields", () => {
  const short = formatContextTransparency(createContextTransparency());

  assert.equal(short.state, "fallback");
  assert.match(short.text, /当前这几句/);
  assert.match(short.text, /不需要收拢长聊/);
  assert.match(short.text, /轻装陪着/);
  assert.match(short.text, /打开历史只是本机查看/);
  assert.doesNotMatch(short.text, /requestVersion|originalMessageCount|providerMessages|prompt|SECRET_SENTINEL/);

  const compressed = formatContextTransparency(createContextTransparency({
    contextBudget: {
      originalMessageCount: 13,
      providerMessageCount: 9,
      compressed: true,
      summaryMessageCount: 1,
      summarizedMessageCount: 5,
      recentMessageCount: 8
    },
    memory: {
      injectionCount: 2
    },
    webSearch: {
      included: true,
      citationCount: 3
    }
  }));

  assert.equal(compressed.state, "ready");
  assert.match(compressed.text, /收好 5 条较早消息/);
  assert.match(compressed.text, /保留最近 8 条/);
  assert.match(compressed.text, /2 条已允许记忆/);
  assert.match(compressed.text, /3 条引用线索/);
  assert.doesNotMatch(compressed.text, /safeQuery|snippet|result body|providerMessages|requestVersion|prompt|安全摘要|Provider 请求/);
});

test("daily companion rhythm merges low-value context and memory into quiet reply status", () => {
  const rhythm = formatDailyCompanionRhythm({
    phase: "replying",
    activityEcho: "正在回复",
    memoryActivity: createMemoryActivity(),
    contextTransparency: createContextTransparency()
  });

  assert.deepEqual(rhythm, {
    primaryText: "她在想怎么说",
    secondaryText: null,
    text: "她在想怎么说",
    state: "ready",
    kind: "chat-replying"
  });
  assert.doesNotMatch(rhythm.text, /compressed|injection|webSearch|requestVersion|providerMessages|prompt|SECRET_SENTINEL/);
});

test("daily companion rhythm prioritizes sensitive skip, compression, injection, memory activity, and search", () => {
  const sensitive = formatDailyCompanionRhythm({
    phase: "complete",
    memoryActivity: createMemoryActivity({
      autoCapture: { enabled: true, skippedReason: "sensitive" }
    }),
    contextTransparency: createContextTransparency({
      contextBudget: { compressed: true }
    })
  });
  assert.equal(sensitive.text, "她把敏感部分先放下");
  assert.equal(sensitive.kind, "memory-sensitive-skip");

  const compressed = formatDailyCompanionRhythm({
    phase: "complete",
    memoryActivity: createMemoryActivity({
      injection: { count: 3 }
    }),
    contextTransparency: createContextTransparency({
      contextBudget: { compressed: true, summarizedMessageCount: 9, recentMessageCount: 8 }
    })
  });
  assert.equal(compressed.text, "她把长聊收拢成轻便脉络");
  assert.equal(compressed.kind, "context-compressed");

  const injected = formatDailyCompanionRhythm({
    phase: "complete",
    memoryActivity: createMemoryActivity({
      injection: { count: 2 }
    })
  });
  assert.equal(injected.text, "她带着已允许的记忆靠近");
  assert.equal(injected.kind, "memory-injected");

  const captured = formatDailyCompanionRhythm({
    phase: "complete",
    memoryActivity: createMemoryActivity({
      autoCapture: { enabled: true, capturedCount: 1, keyCount: 1 }
    }),
    contextTransparency: createContextTransparency({
      webSearch: { included: true, citationCount: 2 }
    })
  });
  assert.equal(captured.text, "她把记忆轻轻归好");
  assert.equal(captured.kind, "memory-captured");

  const search = formatDailyCompanionRhythm({
    phase: "complete",
    contextTransparency: createContextTransparency({
      webSearch: { included: true, citationCount: 2 }
    })
  });
  assert.equal(search.text, "她带着联网引用线索回来");
  assert.equal(search.kind, "search-cited");
});

test("daily companion rhythm keeps important context as a short secondary line while replying", () => {
  const rhythm = formatDailyCompanionRhythm({
    phase: "replying",
    activityEcho: "正在回复",
    contextTransparency: createContextTransparency({
      contextBudget: {
        compressed: true,
        summarizedMessageCount: 6,
        recentMessageCount: 8
      }
    })
  });

  assert.equal(rhythm.primaryText, "她在想怎么说");
  assert.equal(rhythm.secondaryText, "她把长聊收拢成轻便脉络");
  assert.equal(rhythm.text, "她在想怎么说 · 她把长聊收拢成轻便脉络");
  assert.equal(rhythm.kind, "chat-replying");
  assert.doesNotMatch(rhythm.text, /summarizedMessageCount|originalMessageCount|providerMessages|prompt/);
});

test("history context preview only estimates count and boundary", () => {
  const short = formatHistoryContextPreview({ messageCount: 3 });
  assert.equal(short.state, "fallback");
  assert.match(short.text, /3 条消息不会自动发送/);
  assert.match(short.text, /这段短聊天继续/);

  const long = formatHistoryContextPreview({ messageCount: 12, summaryTrigger: 12, recentMessageBudget: 8 });
  assert.equal(long.state, "ready");
  assert.match(long.text, /12 条消息不会自动发送/);
  assert.match(long.text, /5 条较早消息收成轻便脉络/);
  assert.match(long.text, /保留最近 8 条/);
  assert.doesNotMatch(long.text, /providerMessages|content|prompt|SECRET_SENTINEL|用户原文|安全摘要/);
});

test("companion shelf presenter keeps action echo and lock wording", () => {
  assert.deepEqual(formatCompanionShelf({
    accessoryLabel: "无配件",
    petScale: 1,
    isPetLocked: false,
    activityEcho: ACTIVITY_ECHO_IDLE_MESSAGE,
    activityEchoState: "idle"
  }), {
    accessoryText: "配件：无配件",
    scaleText: "大小：100%",
    lockText: "锁定：未锁定",
    lockState: "fallback",
    actionEchoText: "小动作：她安静待着",
    actionEchoState: "idle"
  });

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
