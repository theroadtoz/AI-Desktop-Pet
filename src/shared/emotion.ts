export const emotionTags = [
  "neutral",
  "happy",
  "sad",
  "surprised",
  "confused",
  "angry"
] as const;

export type EmotionTag = (typeof emotionTags)[number];

export const emotionIntensities = ["low", "medium", "high"] as const;

export type EmotionIntensity = (typeof emotionIntensities)[number];

export type EmotionClassification = Readonly<{
  emotion: EmotionTag;
  intensity: EmotionIntensity;
}>;

export const emotionPresentationModes = ["neutral", "micro", "emphasis"] as const;

export type EmotionPresentationMode = (typeof emotionPresentationModes)[number];

export type EmotionPresentation = Readonly<EmotionClassification & {
  mode: EmotionPresentationMode;
}>;

const EMPHASIS_EMOTIONS = new Set<EmotionTag>(["happy", "sad", "angry", "surprised"]);

export function isEmotionTag(value: unknown): value is EmotionTag {
  return typeof value === "string" && emotionTags.includes(value as EmotionTag);
}

export function isEmotionIntensity(value: unknown): value is EmotionIntensity {
  return typeof value === "string" && emotionIntensities.includes(value as EmotionIntensity);
}

export function isEmotionClassification(value: unknown): value is EmotionClassification {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const classification = value as Partial<EmotionClassification>;
  return isEmotionTag(classification.emotion) && isEmotionIntensity(classification.intensity);
}

export function selectEmotionPresentation(
  classification: EmotionClassification
): EmotionPresentation {
  const { emotion, intensity } = classification;

  if (emotion === "neutral") {
    return { emotion, intensity, mode: "neutral" };
  }

  if (intensity === "high" && EMPHASIS_EMOTIONS.has(emotion)) {
    return { emotion, intensity, mode: "emphasis" };
  }

  return { emotion, intensity, mode: "micro" };
}

export function isEmotionPresentation(value: unknown): value is EmotionPresentation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const presentation = value as Partial<EmotionPresentation>;
  const mode = presentation.mode;
  return isEmotionClassification(presentation)
    && typeof mode === "string"
    && emotionPresentationModes.includes(mode as EmotionPresentationMode)
    && selectEmotionPresentation(presentation).mode === mode;
}
