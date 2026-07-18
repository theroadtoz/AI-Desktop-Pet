import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  asksGenericAiIdentityQuestion,
  hasGenericAiSelfIdentityDrift,
  hasProviderIdentityDrift,
  hasThirdPersonPersonaSelfReference,
  redactThirdPersonPersonaSelfReference,
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
  assert.match(redacted, /我会回答/);
  assert.doesNotMatch(redacted, /作为西塔/);
  assert.match(redacted, /我的身份是桌面魔女同伴/);
  assert.doesNotMatch(redacted, /我是一个AI助手|作为语言模型|普通 AI 助手|本质上是聊天机器人/);
});

test("removes assistant-role preambles without replacing them with a Xita declaration", () => {
  assert.equal(
    redactPersonaSelfIdentityDrift("作为语言模型，我会尽量准确。"),
    "我会尽量准确。"
  );
  assert.equal(
    redactPersonaSelfIdentityDrift("作为AI助手，可以啊。"),
    "可以啊。"
  );
  assert.equal(
    redactPersonaSelfIdentityDrift("作为语言模型。"),
    "我是西塔。"
  );
  assert.doesNotMatch(
    redactPersonaSelfIdentityDrift("身为一名聊天机器人，我想听听。"),
    /作为西塔|身为西塔/
  );
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

test("detects and rewrites only clear third-person Xita self references", () => {
  const drift = "我理解你今天不太好。西塔在这里，随时准备支持你。别怕。西塔会陪着你；西塔真为你高兴。";
  const expected = "我理解你今天不太好。我在这里，随时准备支持你。别怕。我会陪着你；我真为你高兴。";

  assert.equal(hasThirdPersonPersonaSelfReference(drift), true);
  assert.equal(redactThirdPersonPersonaSelfReference(drift), expected);

  for (const text of [
    "你可以叫我西塔。",
    "西塔是我的名字。",
    "我有一位同学叫西塔，她正在整理实验记录。",
    "同学告诉我，西塔会在下午来实验室。西塔在实验室整理记录。",
    "同学告诉我，西塔在这里等你。",
    "“西塔在这里”是需要避免的第三人称示例。"
  ]) {
    assert.equal(hasThirdPersonPersonaSelfReference(text), false);
    assert.equal(redactThirdPersonPersonaSelfReference(text), text);
  }
});
