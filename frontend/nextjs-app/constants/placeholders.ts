export const PLACEHOLDER_IDS = {
  HERO_TRIO_LEFT: "PI1-L",
  HERO_TRIO_CENTER: "PI1-C",
  HERO_TRIO_RIGHT: "PI1-R",
  HERO_TRIO_CONTAINER: "PI1",
  HERO_CATEGORY_SPORTS: "PI2",
  HERO_CATEGORY_POKEMON: "PI3",
  HERO_CATEGORY_COMICS: "PI4",
} as const;

type PlaceholderIdMap = typeof PLACEHOLDER_IDS;
export type PlaceholderKey = PlaceholderIdMap[keyof PlaceholderIdMap];
