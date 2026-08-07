import { z } from "zod";

export type SpeedsterCardProfile = "SPORTS" | "POKEMON";

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
