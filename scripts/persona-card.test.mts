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
  assert.match(DEFAULT_PERSONA_CARD.displayName, /学院进修魔女|桌面魔女同伴/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /魔法学院高年级|研究型魔女/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /现代魔导工程/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /现代科技/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /少女样貌/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /很长阅历/);
  assert.match(DEFAULT_PERSONA_CARD.desktopScenario, /Windows 桌面/);
  assert.match(DEFAULT_PERSONA_CARD.desktopScenario, /Live2D 桌面魔女同伴/);
  assert.deepEqual(DEFAULT_PERSONA_CARD.coreTraits.slice(0, 4), ["耐心", "乐观", "学识渊博", "可靠"]);
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
  assert.match(localPrompt, /魔法学院高年级进修魔女/);
  assert.match(localPrompt, /名字=西塔/);
  assert.match(localPrompt, /现代魔导工程进修生/);
  assert.match(localPrompt, /Windows Live2D 桌面魔女同伴/);
  assert.match(localPrompt, /长寿阅历低频呈现/);
  assert.match(localPrompt, /技术名词准确/);
  assert.match(localPrompt, /桌面边缘轻声陪伴/);
  assert.match(localPrompt, /收拢思路/);
  assert.match(localPrompt, /不固定口癖/);
  assert.match(localPrompt, /Provider本地模型Live2D记忆窗口术语不魔法化/);
  assert.match(localPrompt, /耐心.*乐观.*学识渊博.*可靠/);
  assert.doesNotMatch(combined, /现代老魔女|千年判断力|活了上千年/);
});

test("persona card records privacy, memory, action, and search boundaries only", () => {
  const cardText = JSON.stringify(DEFAULT_PERSONA_CARD);
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();
  const combined = `${cardText}\n${cloudPrompt}\n${localPrompt}`;

  assert.match(cloudPrompt, /隐私边界/);
  assert.match(cloudPrompt, /记忆边界/);
  assert.match(cloudPrompt, /桌面边缘/);
  assert.match(cloudPrompt, /课堂笔记感/);
  assert.match(cloudPrompt, /固定口癖|夸张咒语/);
  assert.match(cloudPrompt, /准确技术名词/);
  assert.match(cloudPrompt, /技术术语.*魔法化/);
  assert.match(cloudPrompt, /受限语义动作白名单/);
  assert.match(cloudPrompt, /默认关闭/);
  assert.match(localPrompt, /不编造记忆/);
  assert.match(localPrompt, /不读隐私|不声称读取隐私/);
  assert.match(localPrompt, /(未联网|离线).*不假装搜索/);
  assert.match(localPrompt, /不输出 JSON|不要输出 JSON/);
  assert.doesNotMatch(combined, /Tavily|SearXNG|Brave Search/);
  assert.doesNotMatch(combined, /"action"\s*:/);
  assert.doesNotMatch(combined, /P2-\d+[A-Z]?-事实卡正文|fact card 正文内容/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
