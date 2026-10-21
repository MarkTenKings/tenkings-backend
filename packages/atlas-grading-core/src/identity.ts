import { z } from "zod";
import { atlasSportsAttributesSchema } from './sports-attributes';
export * from './sports-attributes';

export type SpeedsterCardProfile = "SPORTS" | "POKEMON";
export const SPEEDSTER_POKEMON_LAYOUT_TYPES = ["POKEMON", "TRAINER", "ENERGY"] as const;
export type SpeedsterPokemonLayoutType = typeof SPEEDSTER_POKEMON_LAYOUT_TYPES[number];

const optionalText = (label: string, max = 120) => z
  .union([z.string().max(max, `${label} is too long.`), z.null()])
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  });

const sportsIdentitySchema = z.object({
  playerName: optionalText("Player name"),
  year: optionalText("Year", 24),
  manufacturer: optionalText("Manufacturer"),
  productSet: optionalText("Product / set"),
  parallel: optionalText("Parallel"),
  insert: optionalText("Insert"),
  cardNumber: optionalText("Card number"),
  // Never materialize this key for historical identities.
  sportsAttributes: atlasSportsAttributesSchema.optional(),
}).strict();

const pokemonIdentitySchema = z.object({
  cardName: optionalText("Card name"),
  year: optionalText("Year", 24),
  // Omission must stay omission for historical Pokémon identity hashes.
  manufacturer: z.string().trim().min(1).max(120).optional(),
  productSet: optionalText("Set"),
  parallel: optionalText("Parallel"),
  cardNumber: optionalText("Card number"),
  layoutType: z.enum(SPEEDSTER_POKEMON_LAYOUT_TYPES, {
    error: "Pokémon layout type is required.",
  }).nullable().optional(),
}).strict();

export type SpeedsterSportsIdentity = z.output<typeof sportsIdentitySchema>;
export type SpeedsterPokemonIdentity = z.output<typeof pokemonIdentitySchema>;
export type SpeedsterSessionIdentity = SpeedsterSportsIdentity | SpeedsterPokemonIdentity;

export class SpeedsterIdentityValidationError extends Error {
  readonly fields: Record<string, string>;

  constructor(error: z.ZodError) {
    super("Check the supplied ATLAS identity fields.");
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
 * Descriptive identity is independent of physical grading. Unconfirmed values
 * remain null, and absent historical Pokémon layout/manufacturer keys stay
 * absent. The caller still supplies the supported physical card profile.
 */
export function canonicalizeNewSpeedsterSessionIdentity(
  cardProfile: SpeedsterCardProfile,
  value: unknown,
): SpeedsterSessionIdentity {
  const parsed = (cardProfile === "SPORTS" ? sportsIdentitySchema : pokemonIdentitySchema).safeParse(value);
  if (!parsed.success) throw new SpeedsterIdentityValidationError(parsed.error);
  return parsed.data;
}

export function speedsterPokemonLayoutType(identity: SpeedsterSessionIdentity): SpeedsterPokemonLayoutType | null {
  return "cardName" in identity ? identity.layoutType ?? null : null;
}
