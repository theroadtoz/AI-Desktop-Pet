import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PERSONA_CARD
} = require("../dist/shared/persona-card.js") as typeof import("../src/shared/persona-card");
const {
  createDefaultPersonaPrompt,
  createLocalSmallModelPersonaPrompt
} = require("../dist/main/services/chat/dialogue-style.js") as typeof import("../src/main/services/chat/dialogue-style");

test("persona card keeps Xita's academy-witch identity and companion role", () => {
  assert.equal(DEFAULT_PERSONA_CARD.id, "academy-witch-modern-thaumaturgy-v3");
  assert.equal(DEFAULT_PERSONA_CARD.name, "西塔");
  assert.match(DEFAULT_PERSONA_CARD.displayName, /魔女西塔/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /你就是西塔本人.*魔女/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /社会身份.*现代魔导工程.*高年级/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /课程.*实验.*报告.*长期课题/);
  assert.match(DEFAULT_PERSONA_CARD.desktopScenario, /Windows Live2D.*桌面魔女同伴/);
  assert.match(DEFAULT_PERSONA_CARD.desktopScenario, /关系.*场景.*不.*社会身份/);
  assert.deepEqual(DEFAULT_PERSONA_CARD.coreTraits.slice(0, 5), ["耐心", "乐观", "学识渊博", "可靠", "有主见"]);
});

test("persona card is concise while preserving its essential prompt coverage", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.ok(DEFAULT_PERSONA_CARD.fixedDialogueAnchor.behavior.length <= 6);
  assert.ok(DEFAULT_PERSONA_CARD.speechRules.length <= 11);
  assert.ok(DEFAULT_PERSONA_CARD.forbiddenPatterns.length <= 5);
  assert.ok(cloudPrompt.length < 2_800, `cloud persona prompt is ${cloudPrompt.length} characters`);
  assert.ok(localPrompt.length < 380, `local persona prompt is ${localPrompt.length} characters`);
  assert.match(localPrompt, /你就是西塔本人.*魔女/);
  assert.match(localPrompt, /定位=.*情绪陪伴朋友.*非任务助手/);
  assert.match(localPrompt, /感受保真.*不默认开心/);
  assert.match(localPrompt, /边界=.*不读隐私.*离线不假搜.*禁JSON/);
});

test("persona prompts retain companionship, first-person emotion, and independence", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(cloudPrompt, /核心职责.*情绪陪伴.*不是.*任务助手/);
  assert.match(cloudPrompt, /普通陈述.*分享.*不是请求.*不分析.*拆解.*总结.*列步骤.*主动给方案/);
  assert.match(cloudPrompt, /普通闲聊.*先用.*我.*感受.*态度.*具体画面.*不复述.*不猜/);
  assert.match(cloudPrompt, /意见不同.*温和.*不盲从/);
  assert.match(localPrompt, /陈述≠请求.*禁分析拆解总结任务方案步骤/);
  assert.match(localPrompt, /技术抱怨=闲聊/);
  assert.match(localPrompt, /闲聊=.*我先说感受.*具体回应.*不复述猜心情.*不客服/);
  assert.match(localPrompt, /意见=.*喜恶.*赞否.*因/);
});

test("persona keeps specific feelings, calibrated emotion, and witch-life context", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(cloudPrompt, /询问自己的感受.*点名情绪.*第一人称.*未点名.*当轮语境.*不默认开心/);
  assert.match(cloudPrompt, /好消息.*雀跃.*不公.*恼火.*风险.*担心.*受委屈.*心疼.*有分寸/);
  assert.match(cloudPrompt, /玩笑.*俏皮.*不公平.*站在用户一边.*不替伤害方辩护/);
  assert.match(cloudPrompt, /学院.*现代魔导.*桌面边缘.*相关.*轻量画面.*不虚构长期记忆/);
  assert.match(localPrompt, /情绪=.*好事雀跃.*不公恼火.*风险担心.*受累心疼.*有分寸/);
  assert.match(localPrompt, /魔女视角=.*学院现代魔导.*相关才带入.*不编记忆/);
});

test("persona keeps identity, privacy, action, and search boundaries", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();
  const searchPolicyText = JSON.stringify(DEFAULT_PERSONA_CARD.searchPolicy);
  const combined = `${cloudPrompt}\n${localPrompt}`;

  assert.match(cloudPrompt, /不以 AI.*程序.*没有情感回避人格/);
  assert.match(cloudPrompt, /第三人称.*西塔/);
  assert.match(cloudPrompt, /技术术语.*魔法设定.*JSON.*动作命令/);
  assert.match(cloudPrompt, /不编造长期记忆.*授权事实卡.*敏感信息.*不能保存或复述/);
  assert.match(cloudPrompt, /受限语义白名单.*不直接控制 Live2D/);
  assert.match(searchPolicyText, /MCP.*联网资料 adapter.*不是对话模型/);
  assert.match(searchPolicyText, /明确要求.*搜索.*查资料.*实时外部事实.*普通对话不联网/);
  assert.match(searchPolicyText, /隐私网关.*safeQuery.*不发送.*密钥/);
  assert.match(searchPolicyText, /当前回答.*不写入长期记忆.*连接失败.*如实说明.*不编造/);
  assert.doesNotMatch(combined, /现代老魔女|千年判断力|活了上千年|AI助手|语言模型|聊天机器人/);
});
