import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import {
  POKEMON_TCG_STANDARD_CORNER_PROFILE_HEIGHT_MM,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_ID,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_WIDTH_MM,
  canonicalJsonV1,
  trustedPokemonCardFormatAuthorityV1Schema,
  type TrustedPokemonCardFormatAuthorityV1,
  type TrustedPokemonCardFormatAuthorityArtifactV1,
} from "@tenkings/shared";
import type { AiGraderProductionActor } from "./aiGraderProductionAuth";

export const AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ENV =
  "AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY" as const;
export const AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ID_ENV =
  "AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ID" as const;

const identityFieldSchema = z.string().trim().min(1).max(191);
const lookupSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
  setId: identityFieldSchema,
  programId: identityFieldSchema,
  cardNumber: z.string().trim().min(1).max(128),
  variantId: identityFieldSchema.nullable(),
  parallelId: identityFieldSchema.nullable(),
});

const physicalFormatClaimSchema = z.strictObject({
  schemaVersion: z.literal("ten-kings-card-physical-format-authority-v1"),
  trustStatus: z.literal("trusted"),
  game: z.string().trim().min(1).max(64),
  physicalFormat: z.enum([
    "standard",
    "jumbo",
    "oversize",
    "nonstandard",
    "unresolved",
  ]),
  widthMm: z.number().finite().positive(),
  heightMm: z.number().finite().positive(),
  cardTitle: z.string().trim().min(1).max(300),
  formatVariant: z.enum([
    "japanese",
    "international",
    "wizards_era",
    "vintage",
    "modern",
    "standard_foil",
    "standard_promo",
  ]),
  contradictory: z.literal(false),
  provenance: z.literal("ten_kings_owner_approved_card_format_record"),
});

const sourceTrustSchema = z.strictObject({
  schemaVersion: z.literal("ten-kings-set-taxonomy-identity-authority-v1"),
  trustStatus: z.literal("trusted"),
  immutableIdentityResolution: z.literal(true),
});

export type TrustedPokemonCardLookupV1 = z.infer<typeof lookupSchema>;

export interface HostedPokemonCardAuthorityRecordV1 {
  id: string;
  setId: string;
  programId: string;
  cardNumber: string;
  playerName: string | null;
  metadataJson: unknown;
  sourceId: string;
  updatedAt: string;
  source: {
    id: string;
    setId: string;
    sourceKind: string;
    parserVersion: string | null;
    sourceTimestamp: string | null;
    metadataJson: unknown;
  };
  variation: null | {
    id: string;
    setId: string;
    programId: string;
    variationId: string;
    sourceId: string | null;
    updatedAt: string;
  };
  parallel: null | {
    id: string;
    setId: string;
    parallelId: string;
    sourceId: string | null;
    updatedAt: string;
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exactHmacConfiguration(env: NodeJS.ProcessEnv): { key: string; keyId: string } {
  const key = env[AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ENV]?.trim() ?? "";
  const keyId = env[AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ID_ENV]?.trim() ?? "";
  if (Buffer.byteLength(key, "utf8") < 32 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(keyId)) {
    throw new Error(
      "Trusted card-format authority signing is unavailable; the hosted HMAC key and key ID must be configured.",
    );
  }
  return { key, keyId };
}

function exactIso(value: string | Date, label: string): string {
  const date = value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (!value || !Number.isFinite(date.valueOf())) throw new Error(label + " is invalid.");
  return date.toISOString();
}

function signPokemonCardFormatAuthorityArtifactV1(input: {
  artifact: TrustedPokemonCardFormatAuthorityArtifactV1;
  hmacKey: string;
  hmacKeyId: string;
}): TrustedPokemonCardFormatAuthorityV1 {
  if (Buffer.byteLength(input.hmacKey, "utf8") < 32 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.hmacKeyId)) {
    throw new Error("Trusted card-format authority signing configuration is invalid.");
  }
  const artifactBytes = canonicalJsonV1(input.artifact);
  return trustedPokemonCardFormatAuthorityV1Schema.parse({
    schemaVersion: "ten-kings-trusted-card-format-authority-v1",
    artifact: input.artifact,
    artifactSha256: sha256(artifactBytes),
    authentication: {
      algorithm: "hmac-sha256",
      keyId: input.hmacKeyId,
      signature: createHmac("sha256", input.hmacKey)
        .update(artifactBytes, "utf8")
        .digest("hex"),
    },
  });
}

export function signAuthenticatedOperatorPokemonStandardCardAuthorityV1(input: {
  tenantId: string;
  lookup: TrustedPokemonCardLookupV1;
  actor: Extract<AiGraderProductionActor, { type: "human_operator" }>;
  hmacKey: string;
  hmacKeyId: string;
}): TrustedPokemonCardFormatAuthorityV1 {
  const lookup = lookupSchema.parse(input.lookup);
  const recordedAt = exactIso(
    input.actor.audit.requestedAt,
    "Authenticated operator request timestamp",
  );
  const operatorIdSha256 = sha256(input.actor.user.id);
  const cardIdentity = {
    title: lookup.title,
    sideCount: 2 as const,
    tenantId: input.tenantId,
    setId: lookup.setId,
    programId: lookup.programId,
    cardNumber: lookup.cardNumber,
    variantId: lookup.variantId,
    parallelId: lookup.parallelId,
  };
  const cardSnapshot = {
    schemaVersion: "ten-kings-authenticated-operator-card-identity-v1",
    cardIdentity,
    operatorIdSha256,
    operatorRole: input.actor.role,
    recordedAt,
  };
  const sourceSnapshot = {
    schemaVersion: "ten-kings-authenticated-operator-identity-source-v1",
    actorType: input.actor.type,
    operatorIdSha256,
    operatorRole: input.actor.role,
    requestedAction: input.actor.audit.action,
    recordedAt,
  };
  const artifact: TrustedPokemonCardFormatAuthorityArtifactV1 = {
    resolverVersion: "ten-kings-authenticated-operator-card-format-resolver-v1",
    cardIdentity,
    formatSelection: {
      game: "pokemon_tcg",
      physicalFormat: "standard",
      widthMm: POKEMON_TCG_STANDARD_CORNER_PROFILE_WIDTH_MM,
      heightMm: POKEMON_TCG_STANDARD_CORNER_PROFILE_HEIGHT_MM,
      profileId: POKEMON_TCG_STANDARD_CORNER_PROFILE_ID,
      profileVersion: POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION,
      profileArtifactSha256: POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
    },
    sourceRecord: {
      recordType: "authenticated_operator_card_identity",
      recordId: `operator-card:${sha256(canonicalJsonV1(cardIdentity))}`,
      recordUpdatedAt: recordedAt,
      recordSha256: sha256(canonicalJsonV1(cardSnapshot)),
    },
    identitySourceArtifact: {
      artifactType: "authenticated_operator_input",
      artifactId: `operator:${operatorIdSha256}`,
      artifactSha256: sha256(canonicalJsonV1(sourceSnapshot)),
      trustStatus: "trusted",
    },
    provenance: {
      authority: "ten_kings_authenticated_operator_card_identity",
      physicalFormatAuthority:
        "ten_kings_authenticated_operator_pokemon_standard_selection",
      browserSelfDeclarationAccepted: false,
    },
  };
  return signPokemonCardFormatAuthorityArtifactV1({
    artifact,
    hmacKey: input.hmacKey,
    hmacKeyId: input.hmacKeyId,
  });
}

export function signHostedPokemonStandardCardAuthorityV1(input: {
  tenantId: string;
  lookup: TrustedPokemonCardLookupV1;
  record: HostedPokemonCardAuthorityRecordV1;
  hmacKey: string;
  hmacKeyId: string;
}): TrustedPokemonCardFormatAuthorityV1 {
  const lookup = lookupSchema.parse(input.lookup);
  const row = input.record;
  if (row.setId !== lookup.setId || row.programId !== lookup.programId ||
      row.cardNumber !== lookup.cardNumber || row.sourceId !== row.source.id ||
      row.source.setId !== row.setId) {
    throw new Error("Hosted Pokémon identity records are contradictory.");
  }
  if (lookup.variantId) {
    if (!row.variation || row.variation.variationId !== lookup.variantId ||
        row.variation.setId !== row.setId || row.variation.programId !== row.programId ||
        (row.variation.sourceId && row.variation.sourceId !== row.source.id)) {
      throw new Error("Hosted Pokémon variant identity is unresolved or contradictory.");
    }
  } else if (row.variation) {
    throw new Error("Hosted Pokémon identity supplied an unexpected variant record.");
  }
  if (lookup.parallelId) {
    if (!row.parallel || row.parallel.parallelId !== lookup.parallelId ||
        row.parallel.setId !== row.setId ||
        (row.parallel.sourceId && row.parallel.sourceId !== row.source.id)) {
      throw new Error("Hosted Pokémon parallel identity is unresolved or contradictory.");
    }
  } else if (row.parallel) {
    throw new Error("Hosted Pokémon identity supplied an unexpected parallel record.");
  }
  const cardMetadata = record(row.metadataJson);
  const sourceMetadata = record(row.source.metadataJson);
  const claim = physicalFormatClaimSchema.safeParse(
    cardMetadata.aiGraderPhysicalFormatAuthority,
  );
  const sourceTrust = sourceTrustSchema.safeParse(
    sourceMetadata.aiGraderIdentityAuthority,
  );
  if (!claim.success || !sourceTrust.success) {
    throw new Error("Hosted card identity or physical format is unresolved or untrusted.");
  }
  if (claim.data.game !== "pokemon_tcg") {
    throw new Error("Trusted card-format record is not Pokémon TCG; no Pokémon profile was selected.");
  }
  if (claim.data.physicalFormat !== "standard") {
    throw new Error(
      `Trusted Pokémon physical format ${claim.data.physicalFormat} is not supported; no nearest profile was selected.`,
    );
  }
  if (claim.data.widthMm !== POKEMON_TCG_STANDARD_CORNER_PROFILE_WIDTH_MM ||
      claim.data.heightMm !== POKEMON_TCG_STANDARD_CORNER_PROFILE_HEIGHT_MM) {
    throw new Error("Trusted Pokémon standard dimensions do not match 63.50 mm by 88.90 mm.");
  }
  const sourceSnapshot = {
    id: row.source.id,
    setId: row.source.setId,
    sourceKind: row.source.sourceKind,
    parserVersion: row.source.parserVersion,
    sourceTimestamp: row.source.sourceTimestamp
      ? exactIso(row.source.sourceTimestamp, "Taxonomy source timestamp")
      : null,
    metadataJson: row.source.metadataJson,
  };
  const cardSnapshot = {
    id: row.id,
    setId: row.setId,
    programId: row.programId,
    cardNumber: row.cardNumber,
    playerName: row.playerName,
    metadataJson: row.metadataJson,
    sourceId: row.sourceId,
    updatedAt: exactIso(row.updatedAt, "Set-card updatedAt"),
    variation: row.variation ? {
      id: row.variation.id,
      setId: row.variation.setId,
      programId: row.variation.programId,
      variationId: row.variation.variationId,
      sourceId: row.variation.sourceId,
      updatedAt: exactIso(row.variation.updatedAt, "Variation updatedAt"),
    } : null,
    parallel: row.parallel ? {
      id: row.parallel.id,
      setId: row.parallel.setId,
      parallelId: row.parallel.parallelId,
      sourceId: row.parallel.sourceId,
      updatedAt: exactIso(row.parallel.updatedAt, "Parallel updatedAt"),
    } : null,
  };
  const artifact: TrustedPokemonCardFormatAuthorityArtifactV1 = {
    resolverVersion: "ten-kings-hosted-card-format-resolver-v1",
    cardIdentity: {
      title: claim.data.cardTitle,
      sideCount: 2,
      tenantId: input.tenantId,
      setId: row.setId,
      programId: row.programId,
      cardNumber: row.cardNumber,
      variantId: lookup.variantId,
      parallelId: lookup.parallelId,
    },
    formatSelection: {
      game: "pokemon_tcg",
      physicalFormat: "standard",
      widthMm: POKEMON_TCG_STANDARD_CORNER_PROFILE_WIDTH_MM,
      heightMm: POKEMON_TCG_STANDARD_CORNER_PROFILE_HEIGHT_MM,
      profileId: POKEMON_TCG_STANDARD_CORNER_PROFILE_ID,
      profileVersion: POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION,
      profileArtifactSha256: POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
    },
    sourceRecord: {
      recordType: "hosted_set_card",
      recordId: row.id,
      recordUpdatedAt: exactIso(row.updatedAt, "Set-card updatedAt"),
      recordSha256: sha256(canonicalJsonV1(cardSnapshot)),
    },
    identitySourceArtifact: {
      artifactType: "set_taxonomy_source",
      artifactId: row.source.id,
      artifactSha256: sha256(canonicalJsonV1(sourceSnapshot)),
      trustStatus: "trusted",
    },
    provenance: {
      authority: "ten_kings_hosted_immutable_card_identity",
      physicalFormatAuthority: "ten_kings_owner_approved_card_format_record",
      browserSelfDeclarationAccepted: false,
    },
  };
  return signPokemonCardFormatAuthorityArtifactV1({
    artifact,
    hmacKey: input.hmacKey,
    hmacKeyId: input.hmacKeyId,
  });
}

export function parseTrustedPokemonCardLookupBody(value: unknown): TrustedPokemonCardLookupV1 {
  const body = record(value);
  if (Object.keys(body).length !== 1 || !("lookup" in body)) {
    throw new Error("Trusted Pokémon format resolution accepts only one exact lookup object.");
  }
  return lookupSchema.parse(body.lookup);
}

export async function resolvePokemonStandardCardAuthorityRuntime(input: {
  tenantId: string;
  lookup: TrustedPokemonCardLookupV1;
  actor?: AiGraderProductionActor;
  dbClient?: any;
  env?: NodeJS.ProcessEnv;
}): Promise<TrustedPokemonCardFormatAuthorityV1> {
  const env = input.env ?? process.env;
  const { key, keyId } = exactHmacConfiguration(env);
  if (input.actor?.type === "human_operator") {
    return signAuthenticatedOperatorPokemonStandardCardAuthorityV1({
      tenantId: input.tenantId,
      lookup: input.lookup,
      actor: input.actor,
      hmacKey: key,
      hmacKeyId: keyId,
    });
  }
  const db = input.dbClient ?? (await import("@tenkings/database")).prisma as any;
  const row = await db.setCard?.findUnique?.({
    where: {
      setId_programId_cardNumber: {
        setId: input.lookup.setId,
        programId: input.lookup.programId,
        cardNumber: input.lookup.cardNumber,
      },
    },
    select: {
      id: true,
      setId: true,
      programId: true,
      cardNumber: true,
      playerName: true,
      metadataJson: true,
      sourceId: true,
      updatedAt: true,
      source: {
        select: {
          id: true,
          setId: true,
          sourceKind: true,
          parserVersion: true,
          sourceTimestamp: true,
          metadataJson: true,
        },
      },
    },
  });
  if (!row || !row.source || !row.sourceId) {
    throw new Error("Trusted hosted Pokémon card identity was not found.");
  }
  const [variation, parallel] = await Promise.all([
    input.lookup.variantId
      ? db.setVariation?.findUnique?.({
          where: {
            setId_programId_variationId: {
              setId: input.lookup.setId,
              programId: input.lookup.programId,
              variationId: input.lookup.variantId,
            },
          },
          select: {
            id: true, setId: true, programId: true, variationId: true,
            sourceId: true, updatedAt: true,
          },
        })
      : null,
    input.lookup.parallelId
      ? db.setParallel?.findUnique?.({
          where: {
            setId_parallelId: {
              setId: input.lookup.setId,
              parallelId: input.lookup.parallelId,
            },
          },
          select: {
            id: true, setId: true, parallelId: true, sourceId: true, updatedAt: true,
          },
        })
      : null,
  ]);
  const isoRecord = (entry: any) => entry
    ? { ...entry, updatedAt: new Date(entry.updatedAt).toISOString() }
    : null;
  return signHostedPokemonStandardCardAuthorityV1({
    tenantId: input.tenantId,
    lookup: input.lookup,
    record: {
      ...row,
      updatedAt: new Date(row.updatedAt).toISOString(),
      source: {
        ...row.source,
        sourceTimestamp: row.source.sourceTimestamp
          ? new Date(row.source.sourceTimestamp).toISOString()
          : null,
      },
      variation: isoRecord(variation),
      parallel: isoRecord(parallel),
    },
    hmacKey: key,
    hmacKeyId: keyId,
  });
}
