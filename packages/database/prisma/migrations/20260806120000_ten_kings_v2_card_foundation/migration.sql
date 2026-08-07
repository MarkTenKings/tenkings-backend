CREATE TYPE "CollectibleCardV2OwnerType" AS ENUM ('HOUSE', 'ACCOUNT', 'EXTERNAL');
CREATE TYPE "CollectibleCardV2SaleMode" AS ENUM ('PACK', 'DIRECT');
CREATE TYPE "CollectibleCardV2LifecycleState" AS ENUM (
  'GRADED',
  'IN_INVENTORY',
  'ASSIGNED_TO_PACK',
  'LISTED_DIRECT',
  'AT_LOCATION',
  'VAULTED',
  'SHIP_REQUESTED',
  'SHIPPED',
  'EXTERNAL',
  'VOID'
);
CREATE TYPE "CardOwnershipEventV2Reason" AS ENUM (
  'GRADED_CREATED',
  'PACK_PURCHASE',
  'DIRECT_PURCHASE',
  'BUYBACK',
  'ADMIN_CORRECTION'
);
CREATE TYPE "CardOwnershipEventV2Channel" AS ENUM ('ONLINE', 'KIOSK', 'STORE', 'ADMIN');

CREATE TABLE "CollectibleCardV2" (
  "id" TEXT NOT NULL,
  "speedsterSessionId" TEXT NOT NULL,
  "humanGradeLabelId" TEXT NOT NULL,
  "publicReportSlug" TEXT NOT NULL,
  "publicToken" TEXT NOT NULL,
  "category" "HumanGradeCardType" NOT NULL,
  "playerName" TEXT,
  "cardName" TEXT,
  "year" TEXT NOT NULL,
  "manufacturer" TEXT,
  "productSet" TEXT NOT NULL,
  "parallel" TEXT,
  "insert" TEXT,
  "cardNumber" TEXT,
  "gradeSnapshot" JSONB NOT NULL,
  "currentOwnerType" "CollectibleCardV2OwnerType" NOT NULL DEFAULT 'HOUSE',
  "currentOwnerId" TEXT,
  "saleMode" "CollectibleCardV2SaleMode" NOT NULL DEFAULT 'PACK',
  "lifecycleState" "CollectibleCardV2LifecycleState" NOT NULL DEFAULT 'GRADED',
  "locationId" UUID,
  "marketValueCents" INTEGER,
  "marketValueConfirmedAt" TIMESTAMP(3),
  "marketValueConfirmedByAdminId" TEXT,
  "directPriceCents" INTEGER,
  "compsSnapshot" JSONB,
  "compsPublic" BOOLEAN NOT NULL DEFAULT false,
  "nfcVerifiedAt" TIMESTAMP(3),
  "nfcVerifiedByAdminId" TEXT,
  "nfcVerifiedByWorkstationId" TEXT,
  "createdByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CollectibleCardV2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CollectibleCardV2_public_token_shape" CHECK ("publicToken" ~ '^tk2c_[A-Za-z0-9_-]{32}$'),
  CONSTRAINT "CollectibleCardV2_category_identity_shape" CHECK (
    ("category" = 'SPORTS' AND "playerName" IS NOT NULL AND length(btrim("playerName")) > 0 AND "cardName" IS NULL) OR
    ("category" = 'POKEMON' AND "cardName" IS NOT NULL AND length(btrim("cardName")) > 0 AND "playerName" IS NULL)
  ),
  CONSTRAINT "CollectibleCardV2_owner_shape" CHECK (
    ("currentOwnerType" = 'ACCOUNT' AND "currentOwnerId" IS NOT NULL) OR
    ("currentOwnerType" IN ('HOUSE', 'EXTERNAL') AND "currentOwnerId" IS NULL)
  ),
  CONSTRAINT "CollectibleCardV2_market_value_nonnegative" CHECK ("marketValueCents" IS NULL OR "marketValueCents" >= 0),
  CONSTRAINT "CollectibleCardV2_direct_price_nonnegative" CHECK ("directPriceCents" IS NULL OR "directPriceCents" >= 0)
);

CREATE TABLE "CardOwnershipEventV2" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "fromOwnerType" "CollectibleCardV2OwnerType",
  "fromOwnerId" TEXT,
  "toOwnerType" "CollectibleCardV2OwnerType" NOT NULL,
  "toOwnerId" TEXT,
  "reason" "CardOwnershipEventV2Reason" NOT NULL,
  "referenceType" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "pricePaidCents" INTEGER,
  "tkdAmountCents" INTEGER,
  "channel" "CardOwnershipEventV2Channel",
  "actorAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CardOwnershipEventV2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CardOwnershipEventV2_from_owner_shape" CHECK (
    ("fromOwnerType" IS NULL AND "fromOwnerId" IS NULL) OR
    ("fromOwnerType" = 'ACCOUNT' AND "fromOwnerId" IS NOT NULL) OR
    ("fromOwnerType" IN ('HOUSE', 'EXTERNAL') AND "fromOwnerId" IS NULL)
  ),
  CONSTRAINT "CardOwnershipEventV2_to_owner_shape" CHECK (
    ("toOwnerType" = 'ACCOUNT' AND "toOwnerId" IS NOT NULL) OR
    ("toOwnerType" IN ('HOUSE', 'EXTERNAL') AND "toOwnerId" IS NULL)
  ),
  CONSTRAINT "CardOwnershipEventV2_price_paid_nonnegative" CHECK ("pricePaidCents" IS NULL OR "pricePaidCents" >= 0),
  CONSTRAINT "CardOwnershipEventV2_tkd_amount_nonnegative" CHECK ("tkdAmountCents" IS NULL OR "tkdAmountCents" >= 0),
  CONSTRAINT "CardOwnershipEventV2_reference_nonempty" CHECK (length(btrim("referenceType")) > 0 AND length(btrim("referenceId")) > 0)
);

CREATE UNIQUE INDEX "CollectibleCardV2_speedsterSessionId_key" ON "CollectibleCardV2"("speedsterSessionId");
CREATE UNIQUE INDEX "CollectibleCardV2_humanGradeLabelId_key" ON "CollectibleCardV2"("humanGradeLabelId");
CREATE UNIQUE INDEX "CollectibleCardV2_publicReportSlug_key" ON "CollectibleCardV2"("publicReportSlug");
CREATE UNIQUE INDEX "CollectibleCardV2_publicToken_key" ON "CollectibleCardV2"("publicToken");
CREATE INDEX "CollectibleCardV2_lifecycleState_category_saleMode_idx" ON "CollectibleCardV2"("lifecycleState", "category", "saleMode");
CREATE INDEX "CollectibleCardV2_currentOwnerType_currentOwnerId_idx" ON "CollectibleCardV2"("currentOwnerType", "currentOwnerId");
CREATE INDEX "CollectibleCardV2_locationId_lifecycleState_idx" ON "CollectibleCardV2"("locationId", "lifecycleState");

CREATE UNIQUE INDEX "CardOwnershipEventV2_referenceType_referenceId_key" ON "CardOwnershipEventV2"("referenceType", "referenceId");
CREATE INDEX "CardOwnershipEventV2_cardId_createdAt_idx" ON "CardOwnershipEventV2"("cardId", "createdAt");
CREATE INDEX "CardOwnershipEventV2_reason_createdAt_idx" ON "CardOwnershipEventV2"("reason", "createdAt");

ALTER TABLE "CollectibleCardV2"
  ADD CONSTRAINT "CollectibleCardV2_speedsterSessionId_fkey"
  FOREIGN KEY ("speedsterSessionId") REFERENCES "AiGraderV2Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CollectibleCardV2"
  ADD CONSTRAINT "CollectibleCardV2_humanGradeLabelId_fkey"
  FOREIGN KEY ("humanGradeLabelId") REFERENCES "HumanGradeLabel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CollectibleCardV2"
  ADD CONSTRAINT "CollectibleCardV2_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CardOwnershipEventV2"
  ADD CONSTRAINT "CardOwnershipEventV2_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "CollectibleCardV2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_card_ownership_event_v2_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CardOwnershipEventV2 is append-only';
END;
$$;

CREATE TRIGGER "CardOwnershipEventV2_append_only"
BEFORE UPDATE OR DELETE ON "CardOwnershipEventV2"
FOR EACH ROW
EXECUTE FUNCTION "reject_card_ownership_event_v2_mutation"();
