import type {
  AutomaticConversationContextId,
  AutomaticConversationSource,
  AutomaticPresenceStateId
} from "../../../shared/automatic-situation-context";
import type { ProactiveCompanionCadence } from "../../../shared/proactive-companion-settings";

export type CompanionContextChannel =
  | "dialogue-tone"
  | "affect-action"
  | "reply-completion-affect-action"
  | "reply-completion-action"
  | "automatic-mode-action"
  | "proactive-source"
  | "proactive-environment"
  | "proactive-silence";

export type CompanionContextLifecycle =
  | "ready"
  | "unavailable"
  | "system-locked"
  | "suspended"
  | "sleep";

export type CompanionContextInteraction =
  | "idle"
  | "chat-visible"
  | "user-active"
  | "model-busy";

export type CompanionContextEngagement = "allowed" | "defer" | "suppressed" | "unknown";
export type CompanionContextAffectBand = "default" | "gentle" | "focused" | "sleepy";
export type CompanionContextDecision = "allow" | "defer" | "suppress";
export type CompanionContextReplay = "never" | "existing-single-chat-close";
export type CompanionContextActionIntent =
  | "none"
  | "affect-action"
  | "reply-completion-action"
  | "automatic-mode-action";

export type CompanionContextArbitrationReason =
  | "allowed"
  | "lifecycle_unavailable"
  | "lifecycle_system_locked"
  | "lifecycle_suspended"
  | "lifecycle_sleep"
  | "presentation_busy"
  | "model_busy"
  | "chat_visible"
  | "user_active"
  | "affect_disabled"
  | "affect_action_chat_visible"
  | "focus_suppressed"
  | "proactive_off"
  | "source_disabled"
  | "environment_disabled"
  | "engagement_suppressed"
  | "engagement_deferred"
  | "affect_quiet_environment"
  | "explicit_game_proactive_owns_presentation";

export type CompanionContextArbitrationInput = Readonly<{
  channel: CompanionContextChannel;
  lifecycle: CompanionContextLifecycle;
  interaction: CompanionContextInteraction;
  engagement: CompanionContextEngagement;
  dialogueMode: AutomaticConversationContextId;
  dialogueSource: AutomaticConversationSource;
  presenceMode: AutomaticPresenceStateId;
  affectBand: CompanionContextAffectBand;
  presentationBusy: boolean;
  proactiveCadence: ProactiveCompanionCadence;
  affectEnabled: boolean;
  relevantSourceEnabled: boolean;
  environmentEnabled: boolean;
}>;

export type CompanionContextArbitrationResult = Readonly<{
  decision: CompanionContextDecision;
  reason: CompanionContextArbitrationReason;
  replay: CompanionContextReplay;
  actionIntent: CompanionContextActionIntent;
  priority: number;
}>;

function result(
  decision: CompanionContextDecision,
  reason: CompanionContextArbitrationReason,
  actionIntent: CompanionContextActionIntent = "none"
): CompanionContextArbitrationResult {
  return {
    decision,
    reason,
    replay: decision === "defer" ? "existing-single-chat-close" : "never",
    actionIntent,
    priority: actionIntent === "reply-completion-action"
      ? 30
      : actionIntent === "affect-action"
        ? 20
        : actionIntent === "automatic-mode-action"
          ? 10
          : 0
  };
}

/**
 * Stateless joint gate. It accepts only closed main-process values and never
 * owns queues, timers, state snapshots, or renderer requests.
 */
export function resolveCompanionContextArbitration(
  input: CompanionContextArbitrationInput
): CompanionContextArbitrationResult {
  const lifecycleReason: Partial<Record<CompanionContextLifecycle, CompanionContextArbitrationReason>> = {
    unavailable: "lifecycle_unavailable",
    "system-locked": "lifecycle_system_locked",
    suspended: "lifecycle_suspended",
    sleep: "lifecycle_sleep"
  };
  const terminalLifecycleReason = lifecycleReason[input.lifecycle];
  if (terminalLifecycleReason) {
    return result("suppress", terminalLifecycleReason);
  }

  if (input.channel === "dialogue-tone") {
    return input.affectEnabled
      ? result("allow", "allowed")
      : result("suppress", "affect_disabled");
  }

  if (input.channel === "automatic-mode-action") {
    if (input.dialogueSource === "user-explicit" && input.dialogueMode === "game") {
      return result("suppress", "explicit_game_proactive_owns_presentation");
    }
    if (input.presentationBusy) return result("suppress", "presentation_busy");
    if (input.interaction === "model-busy") return result("suppress", "model_busy");
    return result("allow", "allowed", "automatic-mode-action");
  }

  if (input.channel === "affect-action") {
    if (!input.affectEnabled) return result("suppress", "affect_disabled");
    if (input.presentationBusy) return result("suppress", "presentation_busy");
    if (input.interaction === "model-busy") return result("suppress", "model_busy");
    if (input.interaction === "chat-visible") return result("suppress", "affect_action_chat_visible");
    if (input.interaction === "user-active") return result("suppress", "user_active");
    if (input.dialogueMode === "work" || input.dialogueMode === "reading" || input.presenceMode === "focus") {
      return result("suppress", "focus_suppressed");
    }
    return result("allow", "allowed", "affect-action");
  }

  if (input.channel === "reply-completion-affect-action") {
    if (!input.affectEnabled) return result("suppress", "affect_disabled");
    if (input.presentationBusy) return result("suppress", "presentation_busy");
    if (input.interaction === "model-busy") return result("suppress", "model_busy");
    if (input.dialogueMode === "work" || input.dialogueMode === "reading" || input.presenceMode === "focus") {
      return result("suppress", "focus_suppressed");
    }
    return result("allow", "allowed", "affect-action");
  }

  if (input.channel === "reply-completion-action") {
    if (input.presentationBusy) return result("suppress", "presentation_busy");
    if (input.interaction === "model-busy") return result("suppress", "model_busy");
    if (input.dialogueMode === "work" || input.dialogueMode === "reading" || input.presenceMode === "focus") {
      return result("suppress", "focus_suppressed");
    }
    return result("allow", "allowed", "reply-completion-action");
  }

  if (input.proactiveCadence === "off") return result("suppress", "proactive_off");
  if (!input.relevantSourceEnabled) return result("suppress", "source_disabled");
  if (input.channel === "proactive-environment" && !input.environmentEnabled) {
    return result("suppress", "environment_disabled");
  }
  if (input.engagement === "suppressed") return result("suppress", "engagement_suppressed");
  if (input.engagement === "defer") return result("suppress", "engagement_deferred");
  if (input.channel === "proactive-source" && input.interaction !== "idle") {
    const reason = input.interaction === "model-busy"
      ? "model_busy"
      : input.interaction === "chat-visible"
        ? "chat_visible"
        : "user_active";
    return result("defer", reason);
  }
  if (input.presentationBusy) return result("suppress", "presentation_busy");
  if (input.interaction === "model-busy") return result("suppress", "model_busy");
  if (input.interaction === "chat-visible" || input.interaction === "user-active") {
    return result("defer", input.interaction === "chat-visible" ? "chat_visible" : "user_active");
  }
  if (
    (input.channel === "proactive-environment" || input.channel === "proactive-silence") &&
    input.affectEnabled &&
    input.affectBand === "focused"
  ) {
    return result("suppress", "affect_quiet_environment");
  }
  if (
    input.channel === "proactive-environment" &&
    (input.dialogueMode === "work" || input.dialogueMode === "reading" || input.presenceMode === "focus")
  ) {
    return result("suppress", "focus_suppressed");
  }
  return result("allow", "allowed");
}
