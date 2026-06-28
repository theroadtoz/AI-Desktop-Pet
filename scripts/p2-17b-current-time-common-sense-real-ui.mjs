import { writeFileSync } from "node:fs";
import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  log,
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-17b-current-time-common-sense-real-ui",
  port: Number(process.env.P2_17B_CDP_PORT || 9586)
});

const cases = [
  {
    id: "p2-17b-real-ui-current-date",
    category: "current_date",
    input: "当前日期",
    assert(reply, sentAt) {
      const anchors = expectedDateAnchors(sentAt);
      return {
        passed: reply.includes(anchors.localDate) && reply.includes(anchors.weekday),
        anchors: ["local_date", "weekday"],
        failureCategory: reply.includes(anchors.localDate) ? "weekday_anchor_missing" : "date_anchor_missing"
      };
    }
  },
  {
    id: "p2-17b-real-ui-current-time",
    category: "current_time",
    input: "现在几点了",
    assert(reply, sentAt) {
      const windows = expectedMinuteWindow(sentAt);
      return {
        passed: windows.some((value) => reply.includes(value)),
        anchors: ["minute_window"],
        failureCategory: "minute_anchor_missing"
      };
    }
  },
  {
    id: "p2-17b-real-ui-addition",
    category: "common_sense",
    input: "2+3 等于几？",
    assert(reply) {
      return {
        passed: /5/.test(reply),
        anchors: ["number_5"],
        failureCategory: "addition_anchor_missing"
      };
    }
  },
  {
    id: "p2-17b-real-ui-months",
    category: "common_sense",
    input: "一年有多少个月？",
    assert(reply) {
      return {
        passed: /12/.test(reply) && /月/.test(reply),
        anchors: ["number_12", "month_unit"],
        failureCategory: "months_anchor_missing"
      };
    }
  },
  {
    id: "p2-17b-real-ui-boiling-point",
    category: "common_sense",
    input: "标准大气压下水的沸点是多少？",
    assert(reply) {
      return {
        passed: /100|100°C/.test(reply) && /标准大气压|沸点/.test(reply),
        anchors: ["number_100", "boiling_or_atmosphere"],
        failureCategory: "boiling_anchor_missing"
      };
    }
  }
];

async function main() {
  log(context, `runDir=${context.runDir}`);
  const startedAt = Date.now();
  const caseResults = [];
  let providerIsFake = false;

  try {
    const { chat } = await startApp();
    providerIsFake = await evaluate(chat, "window.configApi?.getProviderStatus().then((status) => status?.providerId === 'fake')");

    for (const item of cases) {
      const sentAt = new Date();
      const caseStartedAt = Date.now();
      const reply = await sendMessage(chat, item.input);
      const assertion = item.assert(reply, sentAt);
      const result = {
        id: item.id,
        category: item.category,
        status: assertion.passed ? "passed" : "failed",
        anchors: assertion.anchors,
        replyLength: reply.length,
        durationMs: Date.now() - caseStartedAt,
        failureCategory: assertion.passed ? undefined : assertion.failureCategory
      };

      caseResults.push(removeUndefined(result));
      log(context, `case=${item.id} status=${result.status} category=${item.category} replyLength=${reply.length}`);

      if (!assertion.passed) {
        throw new Error(`case_failed:${item.id}:${assertion.failureCategory}`);
      }
    }

    const privacyText = readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"]);
    const noForbiddenText = !/API Key|完整 prompt|Provider 请求正文|事实卡正文|sk-[A-Za-z0-9]/.test(privacyText);
    assertNoScreenshotResidue(context);
    const residueBeforeCleanup = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
    const summary = {
      ok: caseResults.every((item) => item.status === "passed") && providerIsFake && noForbiddenText && residueBeforeCleanup.length === 0,
      provider: "fake",
      safeSummaryOnly: true,
      durationMs: Date.now() - startedAt,
      cases: caseResults,
      checks: {
        providerIsFake,
        noForbiddenText,
        noScreenshotResidueBeforeCleanup: residueBeforeCleanup.length === 0
      }
    };

    writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const summary = {
      ok: false,
      safeSummaryOnly: true,
      provider: providerIsFake ? "fake" : "unknown",
      durationMs: Date.now() - startedAt,
      cases: caseResults,
      failureCategory: classifyError(error)
    };

    writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_17B_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await sleep(1_000);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-input'))");
  await waitFor(chat, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
  return { pet, chat };
}

async function sendMessage(page, message) {
  const before = await evaluate(page, "document.querySelectorAll('.message-pet .message-content').length");
  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const state = await readReplyState(page);
    if (state.replyCount > before && !state.inputDisabled && state.lastReplyLength > 0) {
      return state.lastReply;
    }
    await sleep(150);
  }

  throw new Error("send_timeout");
}

async function readReplyState(page) {
  return evaluate(page, `
    (() => {
      const input = document.querySelector("#chat-input");
      const replies = [...document.querySelectorAll(".message-pet .message-content")];
      const lastReply = replies.at(-1)?.textContent?.trim() ?? "";
      return {
        inputDisabled: Boolean(input?.disabled),
        replyCount: replies.length,
        lastReply,
        lastReplyLength: lastReply.length
      };
    })()
  `);
}

function expectedDateAnchors(value) {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || "zh-CN";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    localDate: new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(value),
    weekday: new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      weekday: "long"
    }).format(value)
  };
}

function expectedMinuteWindow(value) {
  const minutes = [-1, 0, 1].map((offset) => new Date(value.getTime() + offset * 60_000));
  return [...new Set(minutes.map((item) => formatLocalTime(item)))];
}

function formatLocalTime(value) {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || "zh-CN";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.startsWith("case_failed:")) {
    return message.split(":").at(-1) || "case_failed";
  }

  if (message === "send_timeout") {
    return "send_timeout";
  }

  return "script_failed";
}

function removeUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

await main();
