-- Additive compatibility guard only. Existing session identity JSON is never
-- rewritten; historical Pokémon identities without layoutType remain valid.
BEGIN;

ALTER TABLE "AiGraderV2Session"
ADD CONSTRAINT "AiGraderV2Session_identity_layout_type_check"
CHECK (
  NOT ("identity" ? 'layoutType')
  OR (
    "cardProfile" = 'POKEMON'
    AND jsonb_typeof("identity" -> 'layoutType') = 'string'
    AND "identity" ->> 'layoutType' IN ('POKEMON', 'TRAINER', 'ENERGY')
  )
)
NOT VALID;

ALTER TABLE "AiGraderV2Session"
VALIDATE CONSTRAINT "AiGraderV2Session_identity_layout_type_check";

CREATE TYPE "AiGraderV2PokemonLayoutType" AS ENUM ('POKEMON', 'TRAINER', 'ENERGY');

CREATE TABLE "AiGraderV2LegacyMapLayoutAuthority" (
  "id" TEXT NOT NULL,
  "sourceSessionId" TEXT NOT NULL,
  "layoutType" "AiGraderV2PokemonLayoutType" NOT NULL,
  "selectedByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiGraderV2LegacyMapLayoutAuthority_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiGraderV2LegacyMapLayoutAuthority_sourceSessionId_key"
ON "AiGraderV2LegacyMapLayoutAuthority"("sourceSessionId");

CREATE INDEX "AiGraderV2LegacyMapLayoutAuthority_layoutType_createdAt_idx"
ON "AiGraderV2LegacyMapLayoutAuthority"("layoutType", "createdAt");

ALTER TABLE "AiGraderV2LegacyMapLayoutAuthority"
ADD CONSTRAINT "AiGraderV2LegacyMapLayoutAuthority_sourceSessionId_fkey"
FOREIGN KEY ("sourceSessionId") REFERENCES "AiGraderV2Session"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_ai_grader_v2_legacy_map_layout_authority_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AiGraderV2LegacyMapLayoutAuthority is append-only';
END;
$$;

CREATE TRIGGER "AiGraderV2LegacyMapLayoutAuthority_reject_update"
BEFORE UPDATE ON "AiGraderV2LegacyMapLayoutAuthority"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_grader_v2_legacy_map_layout_authority_mutation"();

CREATE TRIGGER "AiGraderV2LegacyMapLayoutAuthority_reject_delete"
BEFORE DELETE ON "AiGraderV2LegacyMapLayoutAuthority"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_grader_v2_legacy_map_layout_authority_mutation"();

-- Card Map revisions are immutable evidence. Application code only appends a
-- new revision and advances the mutable map pointer; no revision row may be
-- rewritten or removed, including by a future accidental ORM call.
CREATE OR REPLACE FUNCTION "reject_ai_grader_v2_card_type_map_revision_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AiGraderV2CardTypeMapRevision is append-only';
END;
$$;

CREATE TRIGGER "AiGraderV2CardTypeMapRevision_reject_update"
BEFORE UPDATE ON "AiGraderV2CardTypeMapRevision"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_grader_v2_card_type_map_revision_mutation"();

CREATE TRIGGER "AiGraderV2CardTypeMapRevision_reject_delete"
BEFORE DELETE ON "AiGraderV2CardTypeMapRevision"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_grader_v2_card_type_map_revision_mutation"();

COMMIT;
