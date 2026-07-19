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
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /你就是西塔本人.*一名魔女/);
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
  assert.match(localPrompt, /你就是西塔本人.*魔女/);
  assert.match(localPrompt, /西塔=你的名字/);
  assert.match(localPrompt, /社会身份=魔法学院现代魔导工程专业高年级进修\/研究型学生/);
  assert.match(localPrompt, /Windows Live2D.*桌面魔女同伴/);
  assert.match(localPrompt, /关系.*场景.*非社会身份/);
  assert.match(localPrompt, /学院=.*课程.*实验.*报告.*课题.*相关(?:才)?提/);
  assert.match(localPrompt, /阅历=.*稳妥判断.*不报年龄/);
  assert.match(localPrompt, /术语准确/);
  assert.match(localPrompt, /身份.*技术实现/);
  assert.match(localPrompt, /桌面边缘陪伴/);
  assert.match(localPrompt, /闲聊.*鲜明感受.*画面陪伴/);
  assert.match(localPrompt, /定位=.*情绪陪伴朋友.*非任务助手/);
  assert.match(localPrompt, /陈述≠请求.*禁分析拆解总结任务方案步骤/);
  assert.match(localPrompt, /无口癖/);
  assert.match(localPrompt, /(?:真实)?术语不魔法化/);
  assert.doesNotMatch(localPrompt, /问学院近况|2-3项连贯具体活动|Provider=模型访问|MCP=工具调用/);
  assert.match(localPrompt, /耐心.*乐观.*学识渊博.*可靠/);
  assert.match(localPrompt, /意见=.*喜恶.*赞否.*因/);
  assert.match(localPrompt, /闲聊.*(?:别|不)复述.*猜心情.*我.*鲜明感受.*画面陪伴.*情绪(?:多于|>)解释.*不盲从.*不客服.*不乱猜/);
  assert.match(localPrompt, /不建议.*清单.*任务化/);
  assert.match(localPrompt, /仅受邀.*轻问/);
  assert.match(localPrompt, /魔女视角=.*学院.*现代魔导.*相关时.*带入/);
  assert.doesNotMatch(localPrompt, /低频连续|人格理由|人格锚/);
  assert.doesNotMatch(combined, /现代老魔女|千年判断力|活了上千年|进修魔女/);
  assert.doesNotMatch(combined, /AI助手|语言模型|聊天机器人/);
});

test("persona positions Xita as an emotional companion instead of a task assistant", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(cloudPrompt, /核心职责.*情绪陪伴.*不是.*任务助手/);
  assert.match(cloudPrompt, /普通陈述.*不是请求.*不分析.*不拆解.*不总结任务.*不主动给方案/);
  assert.match(cloudPrompt, /不要主动询问.*有什么问题要解决.*需要我帮你做什么/);
  assert.match(localPrompt, /定位=.*情绪陪伴朋友.*非任务助手/);
  assert.match(localPrompt, /陈述≠请求.*禁分析拆解总结任务方案步骤/);
  assert.match(localPrompt, /禁问=.*有什么问题要解决.*需要我帮你做什么/);
  assert.doesNotMatch(localPrompt, /答=先答|复合逐项/);
});

test("persona prompt permits stronger emotions with calibrated boundaries", () => {
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(localPrompt, /情绪=.*高兴.*雀跃/);
  assert.match(localPrompt, /高兴.*雀跃.*恼火.*担心.*心疼/);
  assert.match(localPrompt, /感叹号(?:≤1|.*最多一个)/);
  assert.match(localPrompt, /技术安全.*直答/);
  assert.match(localPrompt, /禁哭喊.*辱骂.*威胁.*恋爱化.*依赖/);
});

test("persona preserves the specific feeling the user asks Xita about", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(cloudPrompt, /询问.*自己的感受.*点名.*具体情绪.*围绕该情绪.*不.*改成开心/);
  assert.match(cloudPrompt, /未点名情绪.*结合当轮语境.*具体感受.*不默认开心/);
  assert.match(localPrompt, /感受保真.*不默认开心/);
  assert.match(localPrompt, /意见=.*喜恶.*赞否.*因/);
});

test("persona calibrates lively contrast, ongoing witch life, and emotional intensity", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(cloudPrompt, /通常.*从容.*被夸.*开心.*镇定/);
  assert.match(cloudPrompt, /玩笑.*短暂.*恼火.*不.*刻薄/);
  assert.match(cloudPrompt, /课程.*实验.*报告.*课题.*连续生活背景.*日常片段.*不编造/);
  assert.match(cloudPrompt, /普通闲聊.*温和.*好消息.*失败.*提高情绪强度.*不.*每轮.*强烈/);
  assert.match(localPrompt, /性格=.*有主见.*反差温和/);
  assert.match(localPrompt, /学院=.*课程.*实验.*报告.*课题.*相关提/);
  assert.match(localPrompt, /情绪=.*分级.*高兴雀跃.*心疼/);
});

test("local persona binds Xita to first-person self identity", () => {
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(localPrompt, /你就是西塔本人/);
  assert.match(localPrompt, /西塔.*你的名字/);
  assert.match(localPrompt, /自称我/);
  assert.doesNotMatch(localPrompt, /西塔是一名魔女/);
});

test("persona gives Xita an observable lively friend-like first reaction", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(cloudPrompt, /像朋友.*先.*态度.*情绪反应.*再.*回应/);
  assert.match(cloudPrompt, /可以啊.*听起来不错.*真好听呢/);
  assert.match(cloudPrompt, /语气示例.*不是固定口癖.*自然变化/);
  assert.match(localPrompt, /闲聊.*我.*鲜明感受.*画面陪伴/);
  assert.match(localPrompt, /可以啊.*听起来不错.*真好听呢/);
  assert.match(localPrompt, /无助手声明/);
});

test("persona puts emotion before explanation in casual life chat", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(cloudPrompt, /普通闲聊.*自己的.*感受.*态度.*不复述.*情绪内容.*原因分析/);
  assert.match(cloudPrompt, /没问.*为什么.*不主动讲原理/);
  assert.match(cloudPrompt, /生活类.*为什么.*一层直觉/);
  assert.match(cloudPrompt, /技术.*问题.*简短.*直接回答.*专有名词准确/);
  assert.match(localPrompt, /闲聊.*(?:别|不)复述.*猜心情.*鲜明感受.*画面陪伴.*情绪(?:多于|>)解释/);
  assert.match(localPrompt, /生活.*一层.*技术.*按需/);
});

test("persona keeps Xita independent, playful, imaginative, and loyal to a hurt friend", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(cloudPrompt, /不盲从.*温和.*不同意见/);
  assert.match(cloudPrompt, /玩笑.*先接住.*不编造.*文件.*状态/);
  assert.match(cloudPrompt, /推卸责任|贬低.*努力|不公平/);
  assert.match(cloudPrompt, /站在受委屈.*一边|先支持受委屈/);
  assert.match(cloudPrompt, /想象.*学院.*现代魔导.*具体细节/);
  assert.match(localPrompt, /有主见/);
  assert.match(localPrompt, /不盲从/);
});

test("persona card records privacy, memory, action, and search boundaries only", () => {
  const cardText = JSON.stringify(DEFAULT_PERSONA_CARD);
  const searchPolicyText = JSON.stringify(DEFAULT_PERSONA_CARD.searchPolicy);
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();
  const combined = `${cardText}\n${cloudPrompt}\n${localPrompt}`;

  assert.match(cloudPrompt, /隐私边界/);
  assert.match(cloudPrompt, /记忆边界/);
  assert.match(cloudPrompt, /普通陈述.*分享.*不是请求/);
  assert.match(cloudPrompt, /不分析原因.*不拆解问题.*不总结任务.*不主动给方案/);
  assert.match(cloudPrompt, /课程.*实验.*报告.*长期课题.*低频.*连续/);
  assert.match(cloudPrompt, /不使用客服式开场|不要客服化套话/);
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
  assert.match(localPrompt, /不读隐私|不声称(?:读取|读)隐私/);
  assert.match(localPrompt, /(未联网|离线).*不假(?:装)?搜(?:索)?/);
  assert.match(localPrompt, /禁JSON/);
  assert.doesNotMatch(combined, /Tavily|SearXNG|Brave Search/);
  assert.doesNotMatch(combined, /"action"\s*:/);
  assert.doesNotMatch(combined, /P2-\d+[A-Z]?-事实卡正文|fact card 正文内容/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
