import { z } from 'zod';

export const ATLAS_SPORTS_ATTRIBUTES_VERSION = 'atlas-sports-attributes-v1' as const;
export const ATLAS_PUBLIC_SPORTS_ATTRIBUTES_VERSION = 'atlas-sports-attributes-public-v1' as const;
export const ATLAS_SPORTS_ATTRIBUTE_PRESENCE = ['UNKNOWN', 'PRESENT', 'ABSENT'] as const;
export const ATLAS_AUTOGRAPH_TYPES = ['UNKNOWN', 'ON_CARD', 'STICKER', 'CUT', 'FACSIMILE'] as const;
export const ATLAS_RELIC_USE = ['UNKNOWN', 'GAME_USED', 'PLAYER_WORN', 'EVENT_WORN', 'NOT_ASSOCIATED', 'UNSPECIFIED'] as const;
const side = z.enum(['FRONT', 'BACK']);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim()
  && !/[\u0000-\u001f\u007f]|https?:\/\/|data:|<\/?[a-z]/i.test(value), 'Use only the text observed on the card.');
const presence = z.enum(ATLAS_SPORTS_ATTRIBUTE_PRESENCE);
const evidence = z.array(z.strictObject({ side, imageSha256: hash, observation: text(600) })).max(2)
  .refine(values => new Set(values.map(value => value.side)).size === values.length, 'Use one observation per side.');
const serialFacts = { presence, printed: text(30).nullable(), numerator: z.number().int().min(1).max(999999).nullable(), denominator: z.number().int().min(1).max(999999).nullable() };
const autographFacts = { presence, type: z.enum(ATLAS_AUTOGRAPH_TYPES) };
const windowFacts = { position: text(80), material: text(120).nullable(), manufacturerStatement: text(600).nullable(), use: z.enum(ATLAS_RELIC_USE) };
const facts = {
  serial: z.strictObject(serialFacts),
  autograph: z.strictObject(autographFacts),
  relic: z.strictObject({ presence, windows: z.array(z.strictObject(windowFacts)).max(12) }),
};

/** Exact printed copy number is distinct from the checklist card number. */
export function atlasPrintedSerial(value: string) {
  const match = /^(\d{1,6})\s*\/\s*(\d{1,6})$/.exec(value);
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[1]) > Number(match[2]))
    throw new Error('Enter the exact positive copy number, for example 007/099.');
  return { printed: value, numerator: Number(match[1]), denominator: Number(match[2]) };
}

type Facts = z.output<z.ZodObject<typeof facts>>;
function checkFacts(value: Facts, context: z.RefinementCtx) {
  const fail = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
  if (value.serial.presence === 'PRESENT') {
    try {
      const parsed = atlasPrintedSerial(value.serial.printed ?? '');
      if (parsed.numerator !== value.serial.numerator || parsed.denominator !== value.serial.denominator)
        fail(['serial', 'printed'], 'The exact printed serial and numeric values must agree.');
    } catch { fail(['serial', 'printed'], 'Enter the exact positive copy number, for example 007/099.'); }
  } else if (value.serial.printed !== null || value.serial.numerator !== null || value.serial.denominator !== null)
    fail(['serial', 'printed'], 'Unconfirmed numbering must remain unknown.');
  if (value.autograph.presence !== 'PRESENT' && value.autograph.type !== 'UNKNOWN')
    fail(['autograph', 'type'], 'Choose a signature type only when its presence is reviewed.');
  if (value.relic.presence === 'PRESENT' ? value.relic.windows.length === 0 : value.relic.windows.length !== 0)
    fail(['relic', 'windows'], 'Record each visible relic window, or leave the windows empty when unconfirmed.');
  if (new Set(value.relic.windows.map(window => window.position.toLowerCase())).size !== value.relic.windows.length)
    fail(['relic', 'windows'], 'Give each relic window a distinct position.');
  value.relic.windows.forEach((window, index) => {
    if (window.use !== 'UNKNOWN' && !window.manufacturerStatement)
      fail(['relic', 'windows', index, 'manufacturerStatement'], 'Quote the manufacturer statement before classifying use or wear.');
  });
}

/** Authorship is recorded by the existing authenticated identity-edit receipt.
 * This block holds only reviewed card facts and their saved photograph basis. */
export const atlasSportsAttributesSchema = z.strictObject({
  version: z.literal(ATLAS_SPORTS_ATTRIBUTES_VERSION),
  serial: z.strictObject({ ...serialFacts, evidence }),
  autograph: z.strictObject({ ...autographFacts, evidence }),
  relic: z.strictObject({ presence, windows: z.array(z.strictObject({ ...windowFacts, evidence })).max(12), evidence }),
}).superRefine((value, context) => {
  checkFacts(value, context);
  for (const key of ['serial', 'autograph', 'relic'] as const) {
    const item = value[key];
    if (item.presence !== 'UNKNOWN' && item.evidence.length === 0)
      context.addIssue({ code: 'custom', path: [key, 'evidence'], message: 'Record the supporting Front or Back observation.' });
    if (item.presence === 'ABSENT' && item.evidence.length !== 2)
      context.addIssue({ code: 'custom', path: [key, 'evidence'], message: 'A reviewed absence needs both sides. Not detected means unknown.' });
  }
  value.relic.windows.forEach((window, index) => {
    if (!window.evidence.length) context.addIssue({ code: 'custom', path: ['relic', 'windows', index, 'evidence'], message: 'Record the photograph supporting this window.' });
  });
});
export type AtlasSportsAttributes = z.output<typeof atlasSportsAttributesSchema>;

export function parseAtlasSportsAttributes(value: unknown): AtlasSportsAttributes { return atlasSportsAttributesSchema.parse(value); }
export function emptyAtlasSportsAttributes(): AtlasSportsAttributes {
  return { version: ATLAS_SPORTS_ATTRIBUTES_VERSION,
    serial: { presence: 'UNKNOWN', printed: null, numerator: null, denominator: null, evidence: [] },
    autograph: { presence: 'UNKNOWN', type: 'UNKNOWN', evidence: [] },
    relic: { presence: 'UNKNOWN', windows: [], evidence: [] } };
}
export function assertAtlasSportsAttributePhotos(value: unknown, photos: Partial<Record<'FRONT' | 'BACK', string>>) {
  const attributes = parseAtlasSportsAttributes(value);
  const observations = [...attributes.serial.evidence, ...attributes.autograph.evidence, ...attributes.relic.evidence,
    ...attributes.relic.windows.flatMap(window => window.evidence)];
  if (observations.some(observation => photos[observation.side] !== observation.imageSha256))
    throw new Error('ATLAS_SPORTS_ATTRIBUTE_PHOTO_STALE');
  return attributes;
}

/** Public output excludes staff observations, source hashes and review authority.
 * The report's own approval binding establishes which card facts were approved. */
export const atlasPublicSportsAttributesSchema = z.strictObject({ version: z.literal(ATLAS_PUBLIC_SPORTS_ATTRIBUTES_VERSION), ...facts }).superRefine(checkFacts);
export type AtlasPublicSportsAttributes = z.output<typeof atlasPublicSportsAttributesSchema>;
export function projectAtlasSportsAttributes(value: unknown): AtlasPublicSportsAttributes {
  const attributes = parseAtlasSportsAttributes(value);
  return atlasPublicSportsAttributesSchema.parse({ version: ATLAS_PUBLIC_SPORTS_ATTRIBUTES_VERSION,
    serial: { presence: attributes.serial.presence, printed: attributes.serial.printed, numerator: attributes.serial.numerator, denominator: attributes.serial.denominator },
    autograph: { presence: attributes.autograph.presence, type: attributes.autograph.type },
    relic: { presence: attributes.relic.presence, windows: attributes.relic.windows.map(({ position, material, manufacturerStatement, use }) => ({ position, material, manufacturerStatement, use })) } });
}

export const ATLAS_SPORTS_ATTRIBUTE_LABELS: Record<string, string> = {
  UNKNOWN: 'Unknown', PRESENT: 'Present', ABSENT: 'Reviewed absent', ON_CARD: 'On-card', STICKER: 'Sticker', CUT: 'Cut', FACSIMILE: 'Facsimile',
  GAME_USED: 'Game-used', PLAYER_WORN: 'Player-worn', EVENT_WORN: 'Event-worn', NOT_ASSOCIATED: 'Not associated with a specific player, game or event', UNSPECIFIED: 'Use or wear not specified',
};
