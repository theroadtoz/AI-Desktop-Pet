import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { load } from "cheerio";
import { normalizeDialogueAffectSettings } from "../src/shared/dialogue-affect-settings.ts";
import { normalizeEnvironmentActionSettings } from "../src/shared/environment-action-settings.ts";
import { forceWebSearchEnabled } from "../src/shared/web-search.ts";
import {
  DEFAULT_HISTORY_RETENTION_LIMIT,
  HISTORY_RETENTION_LIMITS,
  isHistoryRetentionLimit,
  normalizeStoredHistoryRetentionLimit
} from "../src/shared/history-retention.ts";

const htmlPath = new URL("../src/renderer/chat/index.html", import.meta.url);

test("设置导航只提供基础设置和记忆与历史两个任务入口", async () => {
  const $ = load(await readFile(htmlPath, "utf8"));
  const labels = $(".settings-nav [data-settings-page]")
    .toArray()
    .map((element) => $(element).text().trim());

  assert.deepEqual(labels, ["基础设置", "记忆和历史"]);
  assert.equal($("#settings-advanced-page").length, 0);
  assert.equal($("#settings-back-row").length, 0);
});

test("基础设置用一级折叠组整合基础、外观和模型", async () => {
  const $ = load(await readFile(htmlPath, "utf8"));
  const basicPage = $("#settings-basic-page");

  assert.equal(basicPage.find(":scope > details").length, 3);
  assert.equal(basicPage.find("#general-settings-group #proactive-companion-enabled").length, 1);
  assert.equal(basicPage.find("#general-settings-group #new-conversation-button").length, 1);
  assert.equal(basicPage.find("#appearance-settings-group #pet-scale").length, 1);
  assert.equal(basicPage.find("#model-settings-group #web-search-timeout").length, 1);
  assert.equal(basicPage.find("#user-profile-settings-title").length, 0);
  assert.equal(basicPage.find("#environment-action-settings-title").length, 0);
  assert.equal(basicPage.find("#dialogue-affect-settings-title").length, 0);
  assert.equal($("#user-welcome-panel").length, 0);
});

test("环境感知忽略历史关闭配置并始终保持开启", () => {
  assert.deepEqual(
    normalizeEnvironmentActionSettings({
      version: 4,
      basicEnabled: false,
      musicEnabled: false,
      explicitGameContextEnabled: false,
      userSelected: {
        basicEnabled: true,
        musicEnabled: true,
        explicitGameContextEnabled: true
      }
    }),
    {
      basicEnabled: true,
      musicEnabled: true,
      explicitGameContextEnabled: true
    }
  );
});

test("对话情感适配忽略历史关闭配置并始终保持开启", () => {
  assert.deepEqual(
    normalizeDialogueAffectSettings({ version: 1, enabled: false }),
    { enabled: true }
  );
});

test("内置 MCP 忽略历史关闭配置并始终保持开启", () => {
  assert.equal(forceWebSearchEnabled({
    enabled: false,
    command: "bundled-baidu-search",
    args: [],
    toolName: "search",
    timeoutMs: 30_000,
    maxResults: 2
  }).enabled, true);
});

test("历史固定保留 2048 个会话并折叠在记忆和历史页面", async () => {
  const $ = load(await readFile(htmlPath, "utf8"));

  assert.deepEqual(HISTORY_RETENTION_LIMITS, [2_048]);
  assert.equal(DEFAULT_HISTORY_RETENTION_LIMIT, 2_048);
  assert.equal(isHistoryRetentionLimit(2_048), true);
  assert.equal(isHistoryRetentionLimit(500), false);
  assert.equal($("#history-retention-limit").length, 0);
  assert.equal($("#save-history-retention-button").length, 0);
  assert.equal($("#clear-history-button").length, 0);
  assert.equal($("#history-page #new-conversation-button").length, 0);
  assert.equal($("#settings-data-page #history-settings-group #conversation-list").length, 1);
});

test("历史上限迁移保留旧存储并统一升级为 2048", () => {
  assert.equal(normalizeStoredHistoryRetentionLimit(100), 2_048);
  assert.equal(normalizeStoredHistoryRetentionLimit(500), 2_048);
  assert.equal(normalizeStoredHistoryRetentionLimit(1_000), 2_048);
  assert.equal(normalizeStoredHistoryRetentionLimit(2_048), 2_048);
  assert.equal(normalizeStoredHistoryRetentionLimit(999), null);
});

test("外观页只保留自动保存的大小滑块和桌宠锁定", async () => {
  const $ = load(await readFile(htmlPath, "utf8"));
  const appearancePage = $("#appearance-settings-group");

  assert.equal(appearancePage.find("#pet-scale").length, 1);
  assert.equal(appearancePage.find("#pet-scale-value:not(.status-box)").length, 1);
  assert.equal(appearancePage.find("#toggle-pet-lock-button").length, 1);
  assert.equal(appearancePage.find("#pet-accessory-groups").length, 0);
  assert.equal(appearancePage.find("#save-pet-accessory-button").length, 0);
  assert.equal(appearancePage.find("#save-pet-scale-button").length, 0);
  assert.equal(appearancePage.find("#companion-control-shelf").length, 0);
  assert.equal(appearancePage.find("#pet-lock-status").length, 0);
});

test("模型页分离对话模型与永久开启的 MCP 并移除运行时调试入口", async () => {
  const $ = load(await readFile(htmlPath, "utf8"));

  assert.equal($("#provider-id option[value='fake']").length, 0);
  assert.equal($("#local-model-diagnostic-section").length, 0);
  assert.equal($("#llama-cpp-runtime-section").length, 0);
  assert.equal($("#llama-cpp-runtime-executable-button").length, 0);
  assert.equal($("#llama-cpp-runtime-model-button").length, 0);
  assert.equal($("#web-search-enabled").length, 0);
  assert.equal($("#web-search-profile").length, 0);
  assert.equal($("#web-search-refresh-button").length, 0);
  assert.equal($("#model-settings-group #provider-display-name").length, 0);
  assert.equal($("#model-settings-group #provider-temperature").length, 0);
  assert.equal($("#model-settings-group #provider-max-tokens").length, 0);
  assert.equal($("#model-settings-group #provider-timeout").length, 0);
  assert.deepEqual(
    $("#model-settings-group #local-provider-preset option").map((_, option) => $(option).attr("value")).get(),
    ["embedded-llama-cpp", "custom-local"]
  );
  assert.equal($("#model-settings-group #external-provider-settings #provider-api-key").length, 1);
  assert.equal($("#model-settings-group #web-search-timeout").length, 1);
  assert.equal($("#model-settings-group #web-search-max-results").length, 1);
  assert.equal($("#model-settings-group #web-search-test-button").length, 1);
});

test("记忆页只展示开关、单项录入、搜索、折叠列表和批量管理", async () => {
  const $ = load(await readFile(htmlPath, "utf8"));
  const page = $("#settings-data-page");

  assert.equal(page.find(":scope > details").length, 2);
  assert.equal(page.find("#memory-settings-group #memory-enabled").length, 1);
  assert.equal(page.find("#new-memory-button").length, 1);
  assert.equal(page.find("#memory-search").length, 1);
  assert.equal(page.find("details #memory-list").length, 1);
  assert.equal(page.find("#memory-manage-button").length, 1);
  assert.equal(page.find("#memory-delete-selected-button").length, 1);
  assert.equal(page.find("#memory-forget-selected-button").length, 1);
  assert.equal(page.find("#memory-cancel-manage-button").length, 1);
  assert.equal(page.find("#memory-management-actions[hidden]").length, 1);
  assert.equal(page.find("#memory-reviews").length, 0);
  assert.equal(page.find("[data-memory-filter]").length, 0);
  assert.equal(page.find("#memory-safe-stats").length, 0);
  assert.equal(page.find("#memory-suppressions").length, 0);
  assert.equal(page.find("#clear-memory-button").length, 0);
  assert.equal(page.find("#memory-draft-title").length, 0);
  assert.equal(page.find("#memory-draft-tags").length, 0);
});
