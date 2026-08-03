import {
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "model-reply-motion-real-ui",
  port: Number(process.env.MODEL_REPLY_MOTION_CDP_PORT || 9690),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake"
  }
});

const checks = {};

try {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await evaluate(pet, "window.petApi.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-form'))");

  await evaluate(chat, `
    (() => {
      window.__modelReplyScrollCalls = [];
      window.__thinkingMotion = null;
      const originalScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options) {
        window.__modelReplyScrollCalls.push({
          className: this.className,
          options
        });
        return originalScrollIntoView.call(this, options);
      };
      const presence = document.querySelector(".phone-presence");
      new MutationObserver(() => {
        if (!presence.classList.contains("is-thinking")) return;
        const style = getComputedStyle(presence);
        window.__thinkingMotion = {
          name: style.animationName,
          duration: style.animationDuration,
          iterationCount: style.animationIterationCount
        };
      }).observe(presence, { attributes: true, attributeFilter: ["class"] });
      const input = document.querySelector("#chat-input");
      input.value = "请回复一条用于动效验收的消息";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#chat-form").requestSubmit();
    })()
  `);

  await waitFor(chat, "Boolean(document.querySelector('.message-pet.is-entering-pet'))", 10_000);
  checks.thinkingMotionMatchesFigma = await evaluate(chat, `
    window.__thinkingMotion?.name === "figma-thinking-breathe" &&
    window.__thinkingMotion?.duration === "2s" &&
    window.__thinkingMotion?.iterationCount === "infinite"
  `);
  const observedTracks = await evaluate(chat, `
    (() => {
      const item = document.querySelector(".message-pet.is-entering-pet");
      const style = getComputedStyle(item);
      item.getAnimations().forEach((animation) => animation.pause());
      return {
        name: style.animationName,
        duration: style.animationDuration,
        easing: style.animationTimingFunction
      };
    })()
  `);
  checks.exactFigmaTracks =
    observedTracks.name === "message-pet-enter-opacity, message-pet-enter-translate" &&
    observedTracks.duration === "0.12s, 0.24s" &&
    observedTracks.easing === "ease-out, cubic-bezier(0.45, 1.45, 0.8, 1)";
  checks.opacityEndDoesNotInterruptTranslation = await evaluate(chat, `
    (() => {
      const item = document.querySelector(".message-pet.is-entering-pet");
      item.dispatchEvent(new AnimationEvent("animationend", {
        animationName: "message-pet-enter-opacity"
      }));
      return item.classList.contains("is-entering-pet");
    })()
  `);
  checks.translationEndCompletesEntrance = await evaluate(chat, `
    (() => {
      const item = document.querySelector(".message-pet.is-entering-pet");
      item.dispatchEvent(new AnimationEvent("animationend", {
        animationName: "message-pet-enter-translate"
      }));
      return !item.classList.contains("is-entering-pet");
    })()
  `);
  checks.replyUsesMeasuredVisibilityScroll = await waitFor(chat, `
    window.__modelReplyScrollCalls.some((call) =>
      String(call.className).includes("message-pet") &&
      call.options?.block === "nearest" &&
      call.options?.behavior === "smooth"
    )
  `, 2_000).then(() => true);

  const result = { ok: Object.values(checks).every(Boolean), checks, observedTracks };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
} finally {
  await stopElectron(context);
  cleanupRealUiRun(context);
}
