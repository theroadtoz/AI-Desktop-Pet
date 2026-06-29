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

test("persona card captures witch desktop-pet identity and temperament", () => {
  assert.equal(DEFAULT_PERSONA_CARD.id, "ancient-witch-modern-scholar-v2");
  assert.match(DEFAULT_PERSONA_CARD.displayName, /老魔女/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /老魔女/);
  assert.match(DEFAULT_PERSONA_CARD.roleSummary, /现代科技/);
  assert.match(DEFAULT_PERSONA_CARD.desktopScenario, /Windows 桌面|Live2D 伙伴/);
  assert.deepEqual(DEFAULT_PERSONA_CARD.coreTraits.slice(0, 3), ["耐心", "乐观", "学识渊博"]);
});

test("persona prompts are rendered from the shared persona card", () => {
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();

  assert.match(cloudPrompt, new RegExp(escapeRegExp(DEFAULT_PERSONA_CARD.roleSummary)));
  assert.match(cloudPrompt, new RegExp(escapeRegExp(DEFAULT_PERSONA_CARD.desktopScenario)));
  assert.match(cloudPrompt, new RegExp(escapeRegExp(DEFAULT_PERSONA_CARD.actionIntentPolicy.summary)));
  assert.match(cloudPrompt, new RegExp(escapeRegExp(DEFAULT_PERSONA_CARD.searchPolicy.summary)));
  assert.match(localPrompt, new RegExp(escapeRegExp(DEFAULT_PERSONA_CARD.displayName)));
  assert.match(localPrompt, /现代科技/);
  assert.match(localPrompt, /判断力/);
  assert.match(localPrompt, /Windows 桌面/);
  assert.match(localPrompt, /Live2D 伙伴/);
  assert.match(localPrompt, /耐心、乐观、学识渊博/);
});

test("persona card records privacy, memory, action, and search boundaries only", () => {
  const cardText = JSON.stringify(DEFAULT_PERSONA_CARD);
  const cloudPrompt = createDefaultPersonaPrompt();
  const localPrompt = createLocalSmallModelPersonaPrompt();
  const combined = `${cardText}\n${cloudPrompt}\n${localPrompt}`;

  assert.match(cloudPrompt, /隐私边界/);
  assert.match(cloudPrompt, /记忆边界/);
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
