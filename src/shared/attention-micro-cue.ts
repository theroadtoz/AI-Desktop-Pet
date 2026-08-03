export const ATTENTION_MICRO_CUE_CHANNEL = "pet:attention-micro-cue";

export type AttentionMicroCueStartCommand = Readonly<{
  operation: "start";
  kind: "attention-micro-cue";
  intensity: "low";
}>;

export type AttentionMicroCueCancelCommand = Readonly<{
  operation: "cancel";
}>;

export type AttentionMicroCueCommand =
  | AttentionMicroCueStartCommand
  | AttentionMicroCueCancelCommand;

export const ATTENTION_MICRO_CUE_START_COMMAND: AttentionMicroCueStartCommand = Object.freeze({
  operation: "start",
  kind: "attention-micro-cue",
  intensity: "low"
});

export const ATTENTION_MICRO_CUE_CANCEL_COMMAND: AttentionMicroCueCancelCommand = Object.freeze({
  operation: "cancel"
});

export function parseAttentionMicroCueCommand(value: unknown): AttentionMicroCueCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const command = value as Record<string, unknown>;
  if (command.operation === "cancel") {
    return Object.keys(command).length === 1
      ? ATTENTION_MICRO_CUE_CANCEL_COMMAND
      : null;
  }

  return command.operation === "start" &&
    command.kind === "attention-micro-cue" &&
    command.intensity === "low" &&
    Object.keys(command).length === 3
    ? ATTENTION_MICRO_CUE_START_COMMAND
    : null;
}
