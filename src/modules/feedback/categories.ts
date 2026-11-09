export const FEEDBACK_CATEGORIES = ["bug", "idea", "other"] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_MAX_LENGTH = 2000;

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return FEEDBACK_CATEGORIES.includes(value as FeedbackCategory);
}

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Algo no funciona",
  idea: "Idea o mejora",
  other: "Otra cosa",
};

export const FEEDBACK_PLACEHOLDERS: Record<FeedbackCategory, string> = {
  bug: "Escribí qué pasó y qué estabas haciendo. Por ejemplo: «Al guardar la orden me salió un error y se borró lo que había cargado».",
  idea: "Contanos qué te ahorraría tiempo. Por ejemplo: «Estaría bueno filtrar el tablero por técnico».",
  other: "Escribí lo que quieras contarle al equipo de soporte.",
};
