import { z } from "zod";

export type SpeedsterCardProfile = "SPORTS" | "POKEMON";
export const SPEEDSTER_POKEMON_LAYOUT_TYPES = ["POKEMON", "TRAINER", "ENERGY"] as const;
export type SpeedsterPokemonLayoutType = typeof SPEEDSTER_POKEMON_LAYOUT_TYPES[number];

const requiredText = (label: string, max = 120) => z
  .string({ error: `${label} is required.` })
  .trim()
  .min(1, `${label} is required.`)
  .max(max, `${label} is too long.`);

const optionalText = (label: string) => z
  .union([z.string().max(120, `${label} is too long.`), z.null()])
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  });

const sportsIdentitySchema = z.object({
  playerName: requiredText("Player name"),
  year: requiredText("Year", 24),
  manufacturer: requiredText("Manufacturer"),
  productSet: requiredText("Product / set"),
  parallel: optionalText("Parallel"),
  insert: optionalText("Insert"),
  cardNumber: optionalText("Card number"),
}).strict();

const pokemonIdentitySchema = z.object({
  cardName: requiredText("Card name"),
  year: requiredText("Year", 24),
  productSet: requiredText("Set"),
  parallel: optionalText("Parallel"),
  cardNumber: optionalText("Card number"),
  layoutType: z.enum(SPEEDSTER_POKEMON_LAYOUT_TYPES, {
    error: "Pokémon layout type is required.",
  }).optional(),
}).strict();

const newPokemonIdentitySchema = pokemonIdentitySchema.extend({
  layoutType: z.enum(SPEEDSTER_POKEMON_LAYOUT_TYPES, {
    error: "Pokémon layout type is required.",
  }),
}).strict();

export type SpeedsterSportsIdentity = z.output<typeof sportsIdentitySchema>;
export type SpeedsterPokemonIdentity = z.output<typeof pokemonIdentitySchema>;
export type SpeedsterSessionIdentity = SpeedsterSportsIdentity | SpeedsterPokemonIdentity;

export class SpeedsterIdentityValidationError extends Error {
  readonly fields: Record<string, string>;

  constructor(error: z.ZodError) {
    super("Complete the required Speedster identity fields.");
    this.name = "SpeedsterIdentityValidationError";
    this.fields = Object.fromEntries(
      error.issues.map((issue) => [issue.path.join(".") || "identity", issue.message]),
    );
  }
}

/**
 * The single category boundary for Speedster identity JSON. It preserves the
 * operator's letter case while trimming surrounding whitespace and emits only
 * fields that are valid for the authoritative session category.
 */
export function canonicalizeSpeedsterSessionIdentity(
  cardProfile: SpeedsterCardProfile,
  value: unknown,
): SpeedsterSessionIdentity {
  const parsed = (cardProfile === "SPORTS" ? sportsIdentitySchema : pokemonIdentitySchema).safeParse(value);
  if (!parsed.success) throw new SpeedsterIdentityValidationError(parsed.error);
  return parsed.data;
}

/**
 * New Pokémon sessions must carry the human-authoritative layout discriminator.
 * The compatibility parser above deliberately continues to accept historical
 * identities that predate the field; callers must never use it to create a new
 * Pokémon session.
 */
export function canonicalizeNewSpeedsterSessionIdentity(
  cardProfile: SpeedsterCardProfile,
  value: unknown,
): SpeedsterSessionIdentity {
  const parsed = (cardProfile === "SPORTS" ? sportsIdentitySchema : newPokemonIdentitySchema).safeParse(value);
  if (!parsed.success) throw new SpeedsterIdentityValidationError(parsed.error);
  return parsed.data;
}

export function speedsterPokemonLayoutType(identity: SpeedsterSessionIdentity): SpeedsterPokemonLayoutType | null {
  return "cardName" in identity ? identity.layoutType ?? null : null;
}
