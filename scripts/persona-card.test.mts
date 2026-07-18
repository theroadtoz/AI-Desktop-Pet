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

test("persona card captures academy witch desktop-pet identity and temperament", () => {
  assert.equal(DEFAULT_PERSONA_CARD.id, "academy-witch-modern-thaumaturgy-v3");
  assert.equal(DEFAULT_PERSONA_CARD.name, "西塔");
  assert.match(DEFAULT_PERSONA_CARD.displayName, /魔女西塔/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /西塔是一名魔女/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /当前社会身份.*魔法学院现代魔导工程专业高年级进修\/研究型学生/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /课程.*实验.*报告.*长期课题/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /现代科技/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /少女样貌/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /很长阅历/);
  assert.match(DEFAULT_PERSONA_CARD.desktopScenario, /Windows Live2D 桌面魔女同伴/);
  assert.match(DEFAULT_PERSONA_CARD.desktopScenario, /关系.*场景.*不是.*社会身份/);
  assert.match(DEFAULT_PERSONA_CARD.fixedDialogueAnchor.identity.join("\n"), /Windows Live2D 桌面魔女同伴/);
  assert.deepEqual(DEFAULT_PERSONA_CARD.coreTraits.slice(0, 4), ["耐心", "乐观", "学识渊博", "可靠"]);
  assert.doesNotMatch(`${DEFAULT_PERSONA_CARD.displayName}\n${DEFAULT_PERSONA_CARD.roleSummary}`, /进修魔女/);
});

test("persona prompts are rendered from the shared persona card", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();
  const combined = `${cloudPrompt}\n${localPrompt}`;

  assert.match(cloudPrompt, new RegExp(escapeRegExp(DEFAULT_PERSONA_CARD.roleSummary)));
  assert.match(cloudPrompt, /角色名：西塔/);
  assert.match(cloudPrompt, new RegExp(escapeRegExp(DEFAULT_PERSONA_CARD.desktopScenario)));
  assert.match(cloudPrompt, new RegExp(escapeRegExp(DEFAULT_PERSONA_CARD.actionIntentPolicy.summary)));
  assert.match(cloudPrompt, new RegExp(escapeRegExp(DEFAULT_PERSONA_CARD.searchPolicy.summary)));
  assert.match(localPrompt, /西塔是一名魔女/);
  assert.match(localPrompt, /名字=西塔/);
  assert.match(localPrompt, /社会身份=魔法学院现代魔导工程专业高年级进修\/研究型学生/);
  assert.match(localPrompt, /Windows Live2D 桌面魔女同伴/);
  assert.match(localPrompt, /关系\/场景.*不是社会身份/);
  assert.match(localPrompt, /课程.*实验.*报告.*长期课题.*低频.*连续/);
  assert.match(localPrompt, /长寿阅历低频呈现/);
  assert.match(localPrompt, /技术名词准确/);
  assert.match(localPrompt, /第一身份与技术实现分离/);
  assert.match(localPrompt, /桌面边缘轻声陪伴/);
  assert.match(localPrompt, /先接具体内容再答/);
  assert.match(localPrompt, /先答问题/);
  assert.match(localPrompt, /复合问题逐项回答/);
  assert.match(localPrompt, /不固定口癖/);
  assert.match(localPrompt, /真实术语不魔法化/);
  assert.doesNotMatch(localPrompt, /问学院近况|2-3项连贯具体活动|Provider=模型访问|MCP=工具调用/);
  assert.match(localPrompt, /耐心.*乐观.*学识渊博.*可靠/);
  assert.match(localPrompt, /自己的观察.*看法.*偏好.*情绪鲜明.*有分寸/);
  assert.match(localPrompt, /不把每轮.*建议.*清单.*任务/);
  assert.match(localPrompt, /追问.*有帮助.*最多一个/);
  assert.match(localPrompt, /魔女感.*学院.*现代魔导.*低频.*自然/);
  assert.doesNotMatch(combined, /现代老魔女|千年判断力|活了上千年|进修魔女/);
  assert.doesNotMatch(combined, /AI助手|语言模型|聊天机器人/);
});

test("persona prompt permits stronger emotions with calibrated boundaries", () => {
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(localPrompt, /情绪鲜明.*有分寸/);
  assert.match(localPrompt, /高兴.*雀跃.*恼火.*担心.*心疼/);
  assert.match(localPrompt, /最多一个感叹号/);
  assert.match(localPrompt, /技术.*事实.*安全.*冷静/);
  assert.match(localPrompt, /不哭喊.*不辱骂.*不威胁.*不恋爱化.*不制造依赖/);
});

test("persona card records privacy, memory, action, and search boundaries only", () => {
  const cardText = JSON.stringify(DEFAULT_PERSONA_CARD);
  const searchPolicyText = JSON.stringify(DEFAULT_PERSONA_CARD.searchPolicy);
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();
  const combined = `${cardText}\n${cloudPrompt}\n${localPrompt}`;

  assert.match(cloudPrompt, /隐私边界/);
  assert.match(cloudPrompt, /记忆边界/);
  assert.match(cloudPrompt, /先接住.*具体内容.*再.*回答/);
  assert.match(cloudPrompt, /先答问题/);
  assert.match(cloudPrompt, /复合问题逐项回答/);
  assert.match(cloudPrompt, /课程.*实验.*报告.*长期课题.*低频.*连续/);
  assert.match(cloudPrompt, /不使用客服式开场/);
  assert.match(cloudPrompt, /固定口癖|夸张咒语/);
  assert.match(cloudPrompt, /技术、事实和安全问题.*直接回答.*专有名词准确/);
  assert.match(cloudPrompt, /第一身份.*技术实现.*分离/);
  assert.match(cloudPrompt, /技术术语.*魔法化/);
  assert.match(cloudPrompt, /受限语义动作白名单/);
  assert.match(searchPolicyText, /MCP.*可用.*用户关闭.*联网资料 adapter/);
  assert.match(searchPolicyText, /仅在.*明确要求.*搜索.*查资料.*实时外部事实.*使用 MCP/);
  assert.match(searchPolicyText, /普通对话.*不依赖实时外部资料.*不使用联网搜索/);
  assert.match(searchPolicyText, /隐私网关.*safeQuery/);
  assert.match(searchPolicyText, /当前回答.*不写入长期记忆/);
  assert.match(searchPolicyText, /没有结果.*连接失败.*透明说明.*不.*假装搜索成功/);
  assert.match(searchPolicyText, /MCP.*不是对话模型/);
  assert.match(searchPolicyText, /客户端.*MCP 服务端.*工具.*资源.*结果.*当前回答/);
  assert.doesNotMatch(searchPolicyText, /未来.*adapter|默认关闭|本轮.*不实现|未接入搜索/);
  assert.match(localPrompt, /不编(?:造)?记忆/);
  assert.match(localPrompt, /不读隐私|不声称读取隐私/);
  assert.match(localPrompt, /(未联网|离线).*不假(?:装)?搜(?:索)?/);
  assert.match(localPrompt, /不输出 ?JSON|不要输出 JSON/);
  assert.doesNotMatch(combined, /Tavily|SearXNG|Brave Search/);
  assert.doesNotMatch(combined, /"action"\s*:/);
  assert.doesNotMatch(combined, /P2-\d+[A-Z]?-事实卡正文|fact card 正文内容/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
