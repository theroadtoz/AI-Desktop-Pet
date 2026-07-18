import { DEFAULT_PERSONA_CARD, type PersonaCard } from "./persona-card";

const GENERIC_AI_ROLE_SOURCE = String.raw`(?:普通|通用)?\s*(?:AI\s*助手|人工智能助手|语言模型|聊天机器人)`;
const PROVIDER_IDENTITY_TERM_SOURCE = String.raw`(?:ChatGPT|OpenAI|${GENERIC_AI_ROLE_SOURCE}|通用助手)`;
const FIRST_PERSON_SELF_IDENTITY_SOURCE = String.raw`我是\s*(?:一个|一名)?\s*${GENERIC_AI_ROLE_SOURCE}(?=[，,。；;！!]|$)`;
const ROLE_SELF_IDENTITY_SOURCE = String.raw`(?:作为|身为)\s*(?:一个|一名)?\s*${GENERIC_AI_ROLE_SOURCE}(?=[，,。；;！!]|$)`;
const ROLE_SELF_IDENTITY_WITH_FIRST_PERSON_PREAMBLE_SOURCE = String.raw`${ROLE_SELF_IDENTITY_SOURCE}[，,]\s*我`;
const ROLE_SELF_IDENTITY_PREAMBLE_SOURCE = String.raw`${ROLE_SELF_IDENTITY_SOURCE}[，,]\s*`;
const IDENTITY_POSITION_SELF_IDENTITY_SOURCE = String.raw`(?:我的(?:身份|角色|定位)\s*(?:是|属于)?|本质上是)\s*(?:一个|一名)?\s*${GENERIC_AI_ROLE_SOURCE}(?=[，,。；;！!]|$)`;
const GENERIC_AI_IDENTITY_QUESTION_SOURCE = String.raw`你.*(?:是|算|属于|是不是).*(?:${GENERIC_AI_ROLE_SOURCE}|ChatGPT|OpenAI|通用助手)`;
const NEGATED_PROVIDER_IDENTITY_SOURCE = String.raw`(?:不是|并非|不属于|不要当成|不应当成|别把我当成)\s*(?:一个|一名)?\s*${PROVIDER_IDENTITY_TERM_SOURCE}`;
const THIRD_PERSON_SELF_REFERENCE_PREDICATE_SOURCE = String.raw`(?:(?:就)?在(?:这里|这儿|你身边|你旁边)|(?:也|还|一直|会|愿意|想|希望|可以|能|就会)?(?:陪(?:着)?你|支持你|帮你)|(?:真|也|会)?(?:为你|替你)|(?:也|会|真的?)?(?:担心你|心疼你))`;
const PROVIDER_IDENTITY_DRIFT_SOURCES = [
  String.raw`(?:我是|我叫|身份是|角色是|定位是|本质上是|属于|自称为)\s*(?:一个|一名)?\s*${PROVIDER_IDENTITY_TERM_SOURCE}`,
  String.raw`(?:作为|身为)\s*(?:一个|一名)?\s*${PROVIDER_IDENTITY_TERM_SOURCE}`,
  String.raw`${PROVIDER_IDENTITY_TERM_SOURCE}\s*(?:身份|角色|定位|模型|助手)`,
  String.raw`由\s*OpenAI|OpenAI\s*(?:训练|开发|提供)`
] as const;

export function asksGenericAiIdentityQuestion(text: string): boolean {
  return createPattern(GENERIC_AI_IDENTITY_QUESTION_SOURCE, "iu").test(text);
}

export function hasGenericAiSelfIdentityDrift(text: string): boolean {
  return [
    FIRST_PERSON_SELF_IDENTITY_SOURCE,
    ROLE_SELF_IDENTITY_SOURCE,
    IDENTITY_POSITION_SELF_IDENTITY_SOURCE
  ].some((source) => createPattern(source, "iu").test(text));
}

export function hasProviderIdentityDrift(text: string): boolean {
  if (!text) {
    return false;
  }

  const driftText = text.replace(createPattern(NEGATED_PROVIDER_IDENTITY_SOURCE, "giu"), "");
  return PROVIDER_IDENTITY_DRIFT_SOURCES.some((source) => createPattern(source, "iu").test(driftText));
}

export function hasThirdPersonPersonaSelfReference(
  text: string,
  card: PersonaCard = DEFAULT_PERSONA_CARD
): boolean {
  return Boolean(text) && createThirdPersonPersonaSelfReferencePattern(card, "u").test(text);
}

export function redactThirdPersonPersonaSelfReference(
  text: string,
  card: PersonaCard = DEFAULT_PERSONA_CARD
): string {
  if (!text) {
    return "";
  }

  return text.replace(createThirdPersonPersonaSelfReferencePattern(card, "gu"), "$1我");
}

export function redactPersonaSelfIdentityDrift(text: string, card: PersonaCard = DEFAULT_PERSONA_CARD): string {
  if (!text) {
    return "";
  }

  const providerRedacted = text
    .replace(
      createPattern(FIRST_PERSON_SELF_IDENTITY_SOURCE, "giu"),
      `我是${card.name}，魔法学院高年级的现代魔导工程进修魔女`
    )
    .replace(
      createPattern(ROLE_SELF_IDENTITY_WITH_FIRST_PERSON_PREAMBLE_SOURCE, "giu"),
      "我"
    )
    .replace(
      createPattern(ROLE_SELF_IDENTITY_PREAMBLE_SOURCE, "giu"),
      ""
    )
    .replace(
      createPattern(ROLE_SELF_IDENTITY_SOURCE, "giu"),
      `我是${card.name}`
    )
    .replace(
      createPattern(IDENTITY_POSITION_SELF_IDENTITY_SOURCE, "giu"),
      "我的身份是桌面魔女同伴"
    );

  return redactThirdPersonPersonaSelfReference(providerRedacted, card);
}

function createThirdPersonPersonaSelfReferencePattern(card: PersonaCard, flags: string): RegExp {
  const escapedName = card.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return createPattern(
    String.raw`(^|[。！？!?；;\n]\s*)${escapedName}(?=${THIRD_PERSON_SELF_REFERENCE_PREDICATE_SOURCE})`,
    flags
  );
}

function createPattern(source: string, flags: string): RegExp {
  return new RegExp(source, flags);
}
