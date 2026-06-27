import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCompanionShelf,
  formatMemoryRibbon,
  formatModeLabel,
  formatPartnerStatus,
  formatPresenceLabel,
  formatProviderHealthResult,
  formatProviderStatus
} from "../src/renderer/chat/partner-presence-presenter.ts";

test("provider status keeps fake, cloud, local, and fallback wording", () => {
  assert.equal(formatProviderStatus({
    providerId: "fake",
    displayName: "Fake Provider",
    isFallback: false
  }), "本地模式：Fake Provider");
  assert.equal(formatProviderStatus({
    providerId: "openai-compatible",
    displayName: "DeepSeek",
    model: "deepseek-v4-flash",
    baseURLHost: "api.deepseek.com",
    isFallback: false
  }), "真实模型：deepseek-v4-flash · api.deepseek.com");
  assert.equal(formatProviderStatus({
    providerId: "local-openai-compatible",
    displayName: "Ollama 本地模型",
    model: "qwen3:1.7b",
    baseURLHost: "localhost:11434",
    isFallback: false
  }), "本地模型：qwen3:1.7b · localhost:11434");
  assert.equal(formatProviderStatus({
    providerId: "fake",
    displayName: "Fake Provider",
    model: "deepseek-v4-flash",
    isFallback: true,
    reason: "missing_api_key"
  }), "本地回退：未配置 API Key · deepseek-v4-flash");
});

test("provider health result wording stays stable", () => {
  assert.equal(formatProviderHealthResult({
    status: "ready",
    baseURLHost: "localhost:11434",
    modelCount: 2
  }), "连接可用：已找到当前模型 · localhost:11434 · 可见模型 2 个");
  assert.equal(formatProviderHealthResult({
    status: "missing_api_key"
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
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: null, ribbonEcho: "等待中" }), {
    text: "本次未使用记忆 · 等待中",
    state: "fallback"
  });
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: 1, ribbonEcho: "正在回复" }), {
    text: "本次使用 1 条记忆 · 正在回复",
    state: "ready"
  });
  assert.deepEqual(formatMemoryRibbon({ memoryInjectionCount: 3, ribbonEcho: "回复完成" }), {
    text: "本次使用 3 条记忆 · 回复完成",
    state: "ready"
  });
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
    actionEchoText: "最近动作：轻轻挥手",
    actionEchoState: "active"
  });
});
