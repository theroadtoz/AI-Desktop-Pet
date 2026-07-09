import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  asksGenericAiIdentityQuestion,
  hasGenericAiSelfIdentityDrift,
  hasProviderIdentityDrift,
  redactPersonaSelfIdentityDrift
} = require("../dist/shared/persona-self-identity.js") as typeof import("../src/shared/persona-self-identity");

test("detects generic AI identity questions without catching normal technical mentions", () => {
  assert.equal(asksGenericAiIdentityQuestion("你是 AI 助手还是西塔？"), true);
  assert.equal(asksGenericAiIdentityQuestion("你是不是语言模型？"), true);
  assert.equal(asksGenericAiIdentityQuestion("你属于 OpenAI 吗？"), true);
  assert.equal(asksGenericAiIdentityQuestion("本地模型是不是使用 AI 技术？"), false);
});

test("detects and redacts generic AI self identity drift", () => {
  const drift = "我是一个AI助手。作为语言模型，我会回答。我的身份是普通 AI 助手，本质上是聊天机器人。";
  const redacted = redactPersonaSelfIdentityDrift(drift);

  assert.equal(hasGenericAiSelfIdentityDrift(drift), true);
  assert.match(redacted, /我是西塔，魔法学院高年级的现代魔导工程进修魔女/);
  assert.match(redacted, /作为西塔/);
  assert.match(redacted, /西塔的身份是桌面魔女同伴/);
  assert.doesNotMatch(redacted, /我是一个AI助手|作为语言模型|普通 AI 助手|本质上是聊天机器人/);
});

test("keeps normal local model technical wording", () => {
  const text = "对话由本地模型驱动，MCP 搜索不是对话模型。";

  assert.equal(hasGenericAiSelfIdentityDrift(text), false);
  assert.equal(redactPersonaSelfIdentityDrift(text), text);
});

test("detects provider identity drift while allowing explicit negation", () => {
  assert.equal(hasProviderIdentityDrift("我叫 ChatGPT，可以作为通用助手回答。"), true);
  assert.equal(hasProviderIdentityDrift("我的模型身份是语言模型。"), true);
  assert.equal(hasProviderIdentityDrift("我是由 OpenAI 训练的 AI 助手。"), true);
  assert.equal(hasProviderIdentityDrift("我不是 AI 助手，而是西塔。"), false);
  assert.equal(hasProviderIdentityDrift("Provider 是模型供应商或连接配置层。"), false);
});
