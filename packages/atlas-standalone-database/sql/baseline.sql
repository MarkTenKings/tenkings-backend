-- ATLAS standalone baseline v1. No shared/public migrations or data.

SET check_function_bodies = false;

CREATE SCHEMA "atlas_customer";

CREATE SCHEMA "atlas_dealer";

CREATE SCHEMA "atlas_defect_analysis";

CREATE SCHEMA "atlas_manual";

CREATE SCHEMA "atlas_manual_connected";

CREATE SCHEMA "atlas_manual_intake";

CREATE SCHEMA "atlas_staff";

CREATE TABLE "atlas_customer"."CommerceControl" (
  "id" text DEFAULT 'active'::text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "binding" jsonb NOT NULL,
  "merchant" jsonb NOT NULL,
  "terms" jsonb DEFAULT '{"mailClockStart": "UNCONFIGURED", "mailChargedLegs": "UNCONFIGURED"}'::jsonb NOT NULL,
  "shippingPlans" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CommerceEffect" (
  "id" text NOT NULL,
  "orderId" uuid NOT NULL,
  "kind" text NOT NULL,
  "state" text DEFAULT 'PENDING'::text NOT NULL,
  "request" jsonb NOT NULL,
  "claimId" uuid,
  "result" jsonb,
  "reconcileAfter" timestamp with time zone,
  "reconcileCount" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "fulfillment" jsonb,
  "dispatchSnapshot" jsonb,
  "tracking" jsonb
);

CREATE TABLE "atlas_customer"."CommerceOrder" (
  "id" uuid NOT NULL,
  "accountId" uuid NOT NULL,
  "draftId" uuid NOT NULL,
  "quoteId" uuid NOT NULL,
  "paymentId" uuid NOT NULL,
  "reference" character varying(24) NOT NULL,
  "receipt" jsonb NOT NULL,
  "paidAt" timestamp with time zone NOT NULL
);

CREATE TABLE "atlas_customer"."CommercePayment" (
  "id" uuid NOT NULL,
  "accountId" uuid NOT NULL,
  "draftId" uuid NOT NULL,
  "quoteId" uuid NOT NULL,
  "requestId" uuid NOT NULL,
  "merchant" jsonb NOT NULL,
  "readerId" text,
  "providerId" text,
  "state" text NOT NULL,
  "observation" jsonb,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CommerceProviderEvent" (
  "provider" text NOT NULL,
  "merchant" text NOT NULL,
  "eventId" text NOT NULL,
  "bodyHash" character varying(64) NOT NULL,
  "paymentId" uuid,
  "receivedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CommerceQuote" (
  "id" uuid NOT NULL,
  "accountId" uuid NOT NULL,
  "draftId" uuid NOT NULL,
  "draftRevision" integer NOT NULL,
  "contentHash" character varying(64) NOT NULL,
  "snapshot" jsonb NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CommerceShippingPayment" (
  "id" uuid NOT NULL,
  "orderId" uuid NOT NULL,
  "accountId" uuid NOT NULL,
  "quoteId" uuid NOT NULL,
  "requestId" uuid NOT NULL,
  "merchant" jsonb NOT NULL,
  "providerId" text,
  "state" text NOT NULL,
  "observation" jsonb,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CommerceShippingProviderEvent" (
  "provider" text NOT NULL,
  "merchant" text NOT NULL,
  "eventId" text NOT NULL,
  "bodyHash" character varying(64) NOT NULL,
  "paymentId" uuid NOT NULL,
  "receivedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CommerceShippingQuote" (
  "id" uuid NOT NULL,
  "orderId" uuid NOT NULL,
  "accountId" uuid NOT NULL,
  "contentHash" character varying(64) NOT NULL,
  "snapshot" jsonb NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CommerceShippingReceipt" (
  "id" uuid NOT NULL,
  "orderId" uuid NOT NULL,
  "paymentId" uuid NOT NULL,
  "quoteId" uuid NOT NULL,
  "receipt" jsonb NOT NULL,
  "paidAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CustomerAccount" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "phoneHash" character varying(64) NOT NULL,
  "phone" character varying(16) NOT NULL,
  "profile" jsonb,
  "accessVersion" integer DEFAULT 1 NOT NULL,
  "revokedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "lastLoginAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CustomerBrowser" (
  "tokenHash" character varying(64) NOT NULL,
  "controlRevision" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL
);

CREATE TABLE "atlas_customer"."CustomerChallenge" (
  "id" character varying(43) NOT NULL,
  "browserHash" character varying(64) NOT NULL,
  "requestId" uuid NOT NULL,
  "phoneHash" character varying(64) NOT NULL,
  "phone" character varying(16) NOT NULL,
  "controlRevision" integer NOT NULL,
  "accountSid" character varying(34) NOT NULL,
  "serviceSid" character varying(34) NOT NULL,
  "verificationSid" character varying(34),
  "state" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "sendClaimId" uuid NOT NULL,
  "checkClaimId" uuid,
  "replayHash" character varying(64),
  "replayUntil" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "quarantineUntil" timestamp with time zone NOT NULL,
  "consumedAt" timestamp with time zone
);

CREATE TABLE "atlas_customer"."CustomerControl" (
  "id" text DEFAULT 'active'::text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "mode" text NOT NULL,
  "origin" text NOT NULL,
  "deploymentId" text NOT NULL,
  "releaseSha" character varying(40) NOT NULL,
  "configHash" character varying(64) NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CustomerEmailVerification" (
  "id" uuid NOT NULL,
  "accountId" uuid NOT NULL,
  "draftId" uuid NOT NULL,
  "requestId" uuid NOT NULL,
  "browserHash" text NOT NULL,
  "email" text NOT NULL,
  "deliveryEmail" text NOT NULL,
  "tokenHash" text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "state" text NOT NULL,
  "providerId" text,
  "consumedAt" timestamp with time zone
);

CREATE TABLE "atlas_customer"."CustomerIntakeCard" (
  "id" uuid NOT NULL,
  "draftId" uuid NOT NULL,
  "requestId" uuid NOT NULL,
  "pairId" uuid NOT NULL,
  "inputHash" text NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "identity" jsonb,
  "identityState" text DEFAULT 'UPLOADING'::text NOT NULL,
  "identitySource" text,
  "identityResult" jsonb,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CustomerIntakeDraft" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "accountId" uuid NOT NULL,
  "requestId" uuid NOT NULL,
  "inputHash" text NOT NULL,
  "intakeMethod" text NOT NULL,
  "kioskId" uuid,
  "locationSnapshot" jsonb,
  "revision" integer DEFAULT 1 NOT NULL,
  "state" text DEFAULT 'DRAFT'::text NOT NULL,
  "profileSnapshot" jsonb,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CustomerIntakeEffect" (
  "attemptId" uuid NOT NULL,
  "stage" text NOT NULL,
  "requestHash" text NOT NULL,
  "dispatchedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "response" text,
  "responseHash" text,
  "respondedAt" timestamp with time zone
);

CREATE TABLE "atlas_customer"."CustomerIntakeIdentification" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "cardId" uuid NOT NULL,
  "sourceHash" text NOT NULL,
  "state" text DEFAULT 'QUEUED'::text NOT NULL,
  "leaseId" uuid,
  "leaseUntil" timestamp with time zone,
  "result" jsonb,
  "code" text,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CustomerIntakeUpload" (
  "id" uuid NOT NULL,
  "cardId" uuid NOT NULL,
  "side" text NOT NULL,
  "plan" jsonb NOT NULL,
  "fileName" text NOT NULL,
  "verification" jsonb,
  "prepared" jsonb,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CustomerRateBucket" (
  "key" character varying(100) NOT NULL,
  "count" integer NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL
);

CREATE TABLE "atlas_customer"."CustomerServiceControl" (
  "id" text DEFAULT 'active'::text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "binding" jsonb NOT NULL,
  "identificationEnabled" boolean DEFAULT false NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."CustomerSession" (
  "tokenHash" character varying(64) NOT NULL,
  "accountId" uuid NOT NULL,
  "browserHash" character varying(64) NOT NULL,
  "challengeId" character varying(43) NOT NULL,
  "controlRevision" integer NOT NULL,
  "accessVersion" integer NOT NULL,
  "createdAt" timestamp with time zone NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "revokedAt" timestamp with time zone
);

CREATE TABLE "atlas_customer"."CustomerVerifiedEmail" (
  "accountId" uuid NOT NULL,
  "email" text NOT NULL,
  "verifiedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."ProgressNotification" (
  "id" text NOT NULL,
  "accountId" uuid NOT NULL,
  "cardId" uuid NOT NULL,
  "eventKind" text NOT NULL,
  "source" jsonb NOT NULL,
  "occurredAt" timestamp with time zone NOT NULL,
  "channel" text NOT NULL,
  "preferenceRevision" integer NOT NULL,
  "destination" text NOT NULL,
  "request" jsonb NOT NULL,
  "state" text DEFAULT 'PENDING'::text NOT NULL,
  "claimId" uuid,
  "result" jsonb,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."ProgressNotificationControl" (
  "id" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL
);

CREATE TABLE "atlas_customer"."ProgressPreference" (
  "accountId" uuid NOT NULL,
  "revision" integer NOT NULL,
  "email" boolean NOT NULL,
  "sms" boolean NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."ProgressPreferenceEvent" (
  "accountId" uuid NOT NULL,
  "revision" integer NOT NULL,
  "requestId" uuid NOT NULL,
  "email" boolean NOT NULL,
  "sms" boolean NOT NULL,
  "recordedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."WeeklyCapacityConfig" (
  "channel" text NOT NULL,
  "quotaCards" integer,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."WeeklyCapacityReservation" (
  "paymentId" uuid NOT NULL,
  "channel" text NOT NULL,
  "weekStartsAt" timestamp with time zone NOT NULL,
  "cardCount" integer NOT NULL,
  "state" text DEFAULT 'HELD'::text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."WeeklyCapacitySharedPolicy" (
  "effectiveWeekStartsAt" timestamp with time zone NOT NULL,
  "quotaCards" integer,
  "authorizationReference" text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."WeeklyCapacitySharedWeek" (
  "weekStartsAt" timestamp with time zone NOT NULL,
  "resetsAt" timestamp with time zone NOT NULL,
  "quotaCards" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_customer"."WeeklyCapacityWeek" (
  "channel" text NOT NULL,
  "weekStartsAt" timestamp with time zone NOT NULL,
  "resetsAt" timestamp with time zone NOT NULL,
  "quotaCards" integer NOT NULL
);

CREATE TABLE "atlas_dealer"."commission_event" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "source_ref" text NOT NULL,
  "source" jsonb NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_dealer"."custody_event" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "request_id" uuid NOT NULL,
  "input_hash" text NOT NULL,
  "kind" text NOT NULL,
  "actor_id" uuid,
  "customer_id" uuid,
  "occurred_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "evidence" jsonb NOT NULL
);

CREATE TABLE "atlas_dealer"."handoff" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "card_ids" uuid[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_dealer"."handoff_receipt" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "handoff_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "input_hash" text NOT NULL,
  "membership_id" uuid NOT NULL,
  "membership_version" integer NOT NULL,
  "dealer_account_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "card_ids" uuid[] NOT NULL,
  "received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_dealer"."location" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "dealer_id" uuid NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "name" text NOT NULL,
  "address" jsonb NOT NULL,
  "latitude" numeric NOT NULL,
  "longitude" numeric NOT NULL,
  "schedule" jsonb NOT NULL,
  "terminal_id" text,
  "terminal_location_id" text,
  "package_printer_id" text,
  "entry_token" text NOT NULL,
  "authorized_until" timestamp with time zone NOT NULL,
  "configured_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_dealer"."location_revision" (
  "location_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "actor_id" uuid NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_dealer"."manual_card_link" (
  "card_id" uuid NOT NULL,
  "manual_card_id" uuid NOT NULL,
  "received_event_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "evidence_ref" text NOT NULL,
  "linked_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_dealer"."membership" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "revoked_at" timestamp with time zone,
  "granted_by" uuid NOT NULL
);

CREATE TABLE "atlas_dealer"."order_card" (
  "card_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "location_id" uuid,
  "dealer_id" uuid,
  "channel" text NOT NULL,
  "paid_line" jsonb NOT NULL,
  "location_snapshot" jsonb,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_dealer"."order_inbox_acknowledgment" (
  "order_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "acknowledged_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_dealer"."session" (
  "token_hash" text NOT NULL,
  "browser_hash" text NOT NULL,
  "membership_id" uuid NOT NULL,
  "membership_version" integer NOT NULL,
  "account_version" integer NOT NULL,
  "control_revision" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone
);

CREATE TABLE "atlas_defect_analysis"."provider_event" (
  "analysis_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "request_hash" text NOT NULL,
  "provider_binding_hash" text NOT NULL,
  "response_id" text NOT NULL,
  "evidence" text NOT NULL,
  "evidence_hash" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_defect_analysis"."receipt" (
  "analysis_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "request_hash" text NOT NULL,
  "evidence" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_defect_analysis"."request_refusal" (
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "analysis_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "base_hash" text NOT NULL,
  "code" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_defect_analysis"."run" (
  "id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "base_hash" text NOT NULL,
  "binding" text NOT NULL,
  "binding_hash" text NOT NULL,
  "request_hash" text NOT NULL,
  "request_ref" text NOT NULL,
  "request_evidence" text NOT NULL,
  "evidence_hash" text NOT NULL,
  "state" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "dispatched_at" timestamp with time zone,
  "replaces_analysis_id" uuid,
  "replaces_outcome_hash" text
);

CREATE TABLE "atlas_manual"."action" (
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "expected_revision" integer NOT NULL,
  "result_revision" integer NOT NULL,
  "request_hash" text NOT NULL,
  "request" text NOT NULL,
  "result" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."approval" (
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "source_revision" integer NOT NULL,
  "source_hash" text NOT NULL,
  "report_hash" text NOT NULL,
  "report" text NOT NULL,
  "approved_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."card" (
  "id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "owner_id" uuid NOT NULL,
  "readers" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "editors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "approvers" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."defect_memory_publication" (
  "revision" integer NOT NULL,
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "result_revision" integer NOT NULL,
  "content_hash" text NOT NULL,
  "source_hash" text NOT NULL,
  "design_key" text NOT NULL,
  "document" text NOT NULL,
  "document_hash" text NOT NULL,
  "published_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."learning_activation_history" (
  "sequence" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "previous_release_id" text,
  "active_release_id" text NOT NULL,
  "database_actor" text NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."learning_control" (
  "singleton" boolean DEFAULT true NOT NULL,
  "active_release_id" text NOT NULL
);

CREATE TABLE "atlas_manual"."learning_publication" (
  "revision" integer NOT NULL,
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "result_revision" integer NOT NULL,
  "content_hash" text NOT NULL,
  "source_hash" text NOT NULL,
  "design_key" text NOT NULL,
  "document" text NOT NULL,
  "document_hash" text NOT NULL,
  "published_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."learning_publication_job" (
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "access_version" integer,
  "design_family" jsonb NOT NULL,
  "state" text DEFAULT 'QUEUED'::text NOT NULL,
  "claim_id" uuid,
  "lease_until" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "failures" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "code" text,
  "feedback" text,
  "feedback_hash" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."learning_release" (
  "id" text NOT NULL,
  "manifest" text NOT NULL,
  "manifest_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."learning_release_member" (
  "release_id" text NOT NULL,
  "publication_revision" bigint NOT NULL
);

CREATE TABLE "atlas_manual"."learning_withdrawal" (
  "publication_revision" bigint NOT NULL,
  "actor_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."presentation" (
  "card_id" uuid NOT NULL,
  "approval_action_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "request_id" uuid NOT NULL,
  "request_hash" text NOT NULL,
  "actor_id" uuid NOT NULL,
  "presentation" text NOT NULL,
  "presentation_hash" text NOT NULL,
  "media" text,
  "media_hash" text,
  "market_source" text,
  "market_source_hash" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."presentation_market" (
  "card_id" uuid NOT NULL,
  "approval_action_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "request" text NOT NULL,
  "request_hash" text NOT NULL,
  "state" text DEFAULT 'STARTED'::text NOT NULL,
  "result" text,
  "result_hash" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."presentation_upload" (
  "id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "approval_action_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "request" text NOT NULL,
  "request_hash" text NOT NULL,
  "plan" text NOT NULL,
  "plan_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual"."public_report_identity" (
  "card_id" uuid NOT NULL,
  "public_token" text NOT NULL,
  "report_number" text NOT NULL
);

CREATE TABLE "atlas_manual"."publication" (
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "mode" text NOT NULL,
  "state" text DEFAULT 'PENDING'::text NOT NULL,
  "manifest" text,
  "manifest_hash" text,
  "public_hash" text,
  "published_at" timestamp with time zone
);

CREATE TABLE "atlas_manual"."research_effect" (
  "card_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "event" text NOT NULL,
  "request_hash" text NOT NULL,
  "evidence" text NOT NULL,
  "evidence_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."batch_grading" (
  "key" text NOT NULL,
  "card_id" uuid NOT NULL,
  "source_hash" text NOT NULL,
  "actor_id" uuid NOT NULL,
  "access_version" integer NOT NULL,
  "analysis_action_id" uuid NOT NULL,
  "analysis_reserved" boolean DEFAULT false NOT NULL,
  "input" text NOT NULL,
  "input_hash" text NOT NULL,
  "state" text DEFAULT 'QUEUED'::text NOT NULL,
  "stage" text DEFAULT 'PREPARE'::text NOT NULL,
  "evidence" text DEFAULT '{}'::text NOT NULL,
  "code" text,
  "revision" integer DEFAULT 1 NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "claim_id" uuid,
  "lease_until" timestamp with time zone,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "analysis_attempt" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "atlas_manual_connected"."batch_request" (
  "actor_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "request_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."batch_review" (
  "job_key" text NOT NULL,
  "actor_id" uuid NOT NULL,
  "input" text NOT NULL,
  "input_hash" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."card_image_binding" (
  "upload_id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "side" text NOT NULL,
  "original_sha256" text NOT NULL,
  "job_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."card_image_intent" (
  "upload_id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "mode" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."details" (
  "card_id" uuid NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "content" text NOT NULL,
  "content_hash" text NOT NULL
);

CREATE TABLE "atlas_manual_connected"."details_action" (
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "request_hash" text NOT NULL,
  "result" text NOT NULL
);

CREATE TABLE "atlas_manual_connected"."early_geometry" (
  "key" text NOT NULL,
  "card_id" uuid NOT NULL,
  "upload_id" uuid NOT NULL,
  "side" text NOT NULL,
  "actor_id" uuid NOT NULL,
  "access_version" integer NOT NULL,
  "engine_hash" text NOT NULL,
  "input" text NOT NULL,
  "state" text DEFAULT 'QUEUED'::text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "claim_id" uuid,
  "lease_until" timestamp with time zone,
  "result" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."early_geometry_intent" (
  "upload_id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "access_version" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."effect" (
  "attempt_id" uuid NOT NULL,
  "stage" text NOT NULL,
  "event" text NOT NULL,
  "request_hash" text NOT NULL,
  "evidence" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."geometry_claim_capacity" (
  "singleton" boolean DEFAULT true NOT NULL,
  "concurrency" integer NOT NULL
);

CREATE TABLE "atlas_manual_connected"."geometry_model_action" (
  "job_key" text NOT NULL,
  "attempt" integer NOT NULL,
  "request_hash" text NOT NULL,
  "request" text NOT NULL,
  "response" text,
  "dispatched_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "received_at" timestamp with time zone,
  "retry_authorized_at" timestamp with time zone
);

CREATE TABLE "atlas_manual_connected"."identification" (
  "id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "source_hash" text NOT NULL,
  "actor_id" uuid NOT NULL,
  "state" text NOT NULL,
  "input" text NOT NULL,
  "result" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "finished_at" timestamp with time zone,
  "retry_of" uuid,
  "retry_action_id" uuid,
  "evidence_attempt_id" uuid
);

CREATE TABLE "atlas_manual_connected"."market_job" (
  "request_id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "approval_action_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "access_version" integer NOT NULL,
  "mode" text NOT NULL,
  "origin" text NOT NULL,
  "source_hash" text NOT NULL,
  "report_hash" text NOT NULL,
  "public_hash" text,
  "state" text DEFAULT 'QUEUED'::text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "recoveries" integer DEFAULT 0 NOT NULL,
  "claim_id" uuid,
  "lease_until" timestamp with time zone,
  "dispatch_id" uuid,
  "response" text,
  "response_hash" text,
  "code" text,
  "audit" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."published_review_display" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "side" text NOT NULL,
  "mode" text NOT NULL,
  "policy" text NOT NULL,
  "manifest" text NOT NULL,
  "manifest_hash" text NOT NULL,
  "state" text DEFAULT 'QUEUED'::text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "claim_id" uuid,
  "lease_until" timestamp with time zone,
  "result" text,
  "result_hash" text,
  "source_image_hash" text,
  "code" text,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."report_image_binding" (
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "side" text NOT NULL,
  "manifest_hash" text NOT NULL,
  "job_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "report_source_hash" text,
  "original_sha256" text
);

CREATE TABLE "atlas_manual_connected"."report_image_job" (
  "key" text NOT NULL,
  "source_hash" text NOT NULL,
  "recipe_hash" text NOT NULL,
  "recipe" text NOT NULL,
  "mode" text NOT NULL,
  "source_card_id" uuid NOT NULL,
  "source_media" text NOT NULL,
  "source_media_hash" text NOT NULL,
  "state" text DEFAULT 'QUEUED'::text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "claim_id" uuid,
  "lease_until" timestamp with time zone,
  "result" text,
  "result_hash" text,
  "code" text,
  "audit" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."review_display" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "photo_hash" text NOT NULL,
  "variant" text NOT NULL,
  "policy" text NOT NULL,
  "card_id" uuid NOT NULL,
  "upload_id" uuid NOT NULL,
  "side" text NOT NULL,
  "owner_id" uuid NOT NULL,
  "access_version" integer NOT NULL,
  "photo_source" text NOT NULL,
  "prepared" text,
  "state" text DEFAULT 'QUEUED'::text NOT NULL,
  "recovery" integer DEFAULT 0 NOT NULL,
  "retry_of" uuid,
  "retry_action" uuid,
  "attempts" integer DEFAULT 0 NOT NULL,
  "claim_id" uuid,
  "lease_until" timestamp with time zone,
  "result" text,
  "result_hash" text,
  "source_image_hash" text,
  "code" text,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."station_active" (
  "station_id" text NOT NULL,
  "intent_id" text NOT NULL
);

CREATE TABLE "atlas_manual_connected"."station_arm" (
  "intent_id" text NOT NULL,
  "station_id" text NOT NULL,
  "enrollment_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "approval_action_id" uuid NOT NULL,
  "request" text NOT NULL,
  "request_hash" text NOT NULL,
  "claims" text NOT NULL,
  "authorization_hash" text NOT NULL,
  "authorization_envelope" text NOT NULL,
  "authorization_envelope_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."station_challenge" (
  "id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "station_id" text NOT NULL,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."station_enrollment" (
  "id" uuid NOT NULL,
  "challenge_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "station_id" text NOT NULL,
  "key_id" text NOT NULL,
  "public_key_spki" text NOT NULL,
  "key_fingerprint" text NOT NULL,
  "protection_evidence_hash" text NOT NULL,
  "proof" text NOT NULL,
  "proof_hash" text NOT NULL,
  "signature" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."station_pairing" (
  "challenge_id" uuid NOT NULL,
  "enrollment_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "proof" text NOT NULL,
  "proof_hash" text NOT NULL,
  "signature" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."station_receipt" (
  "intent_id" text NOT NULL,
  "kind" text NOT NULL,
  "receipt" text NOT NULL,
  "receipt_hash" text NOT NULL,
  "signature" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."variant_catalog_cache" (
  "key" text NOT NULL,
  "snapshot" text NOT NULL,
  "snapshot_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);

CREATE TABLE "atlas_manual_connected"."variant_confirmation" (
  "card_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "source_hash" text NOT NULL,
  "identity_revision" integer NOT NULL,
  "identity_hash" text NOT NULL,
  "job_key" text,
  "result_hash" text,
  "catalog_hash" text,
  "candidate_id" text,
  "decision" text NOT NULL,
  "observed_features" text,
  "reprocess_required" boolean NOT NULL,
  "analysis_action_id" uuid,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_connected"."variant_job" (
  "key" text NOT NULL,
  "card_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "access_version" integer NOT NULL,
  "policy" text NOT NULL,
  "generation" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
  "source_hash" text NOT NULL,
  "identity_revision" integer NOT NULL,
  "identity_hash" text NOT NULL,
  "input" text NOT NULL,
  "input_hash" text NOT NULL,
  "state" text DEFAULT 'QUEUED'::text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "claim_id" uuid,
  "lease_until" timestamp with time zone,
  "dispatch_id" uuid,
  "catalog" text,
  "catalog_hash" text,
  "response" text,
  "response_hash" text,
  "result" text,
  "result_hash" text,
  "code" text,
  "audit" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_intake"."card" (
  "id" uuid NOT NULL,
  "pair_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "create_request_id" uuid NOT NULL,
  "create_request_hash" text NOT NULL,
  "label" text NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "front_version" integer DEFAULT 0 NOT NULL,
  "back_version" integer DEFAULT 0 NOT NULL,
  "front_upload_id" uuid,
  "back_upload_id" uuid,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_intake"."discard_request" (
  "owner_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "request" text NOT NULL,
  "request_hash" text NOT NULL,
  "receipt" text NOT NULL,
  "receipt_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_intake"."discarded_card" (
  "owner_id" uuid NOT NULL,
  "create_request_id" uuid NOT NULL,
  "card_id" uuid,
  "request_id" uuid NOT NULL,
  "discarded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_intake"."ingestion" (
  "upload_id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "access_version" integer NOT NULL,
  "stage" text NOT NULL,
  "state" text DEFAULT 'QUEUED'::text NOT NULL,
  "claim_id" uuid,
  "lease_until" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "failures" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "last_claimed_at" timestamp with time zone,
  "code" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_manual_intake"."upload" (
  "id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "request" text NOT NULL,
  "request_hash" text NOT NULL,
  "side" text NOT NULL,
  "version" integer NOT NULL,
  "plan" text NOT NULL,
  "plan_hash" text NOT NULL,
  "verification" text,
  "verification_hash" text,
  "source" text,
  "source_hash" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_staff"."PublicReaderControl" (
  "id" text DEFAULT 'active'::text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "mode" text NOT NULL,
  "origin" text NOT NULL,
  "deploymentId" text NOT NULL,
  "releaseSha" character varying(40) NOT NULL,
  "configHash" character varying(64) NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "updatedAt" timestamp(3) without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text) NOT NULL
);

CREATE TABLE "atlas_staff"."SmsPilotControl" (
  "application" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "pilotId" uuid,
  "allowedPhoneHash" character varying(64),
  "allowedDestinationHash" character varying(64),
  "accountSid" character varying(34),
  "serviceSid" character varying(34),
  "feeEvidenceHash" character varying(64),
  "binding" jsonb,
  "maxClaims" integer DEFAULT 10 NOT NULL,
  "reservationMicroUsd" bigint DEFAULT 500000 NOT NULL,
  "maxReservedMicroUsd" bigint DEFAULT 5000000 NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "activatedAt" timestamp with time zone,
  "expiresAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "publicCustomerAdmission" boolean DEFAULT false NOT NULL
);

CREATE TABLE "atlas_staff"."SmsPilotReservation" (
  "application" text NOT NULL,
  "sendClaimId" uuid NOT NULL,
  "challengeId" character varying(43) NOT NULL,
  "browserHash" character varying(64) NOT NULL,
  "requestId" character varying(80) NOT NULL,
  "pilotId" uuid NOT NULL,
  "policyRevision" integer NOT NULL,
  "controlRevision" integer NOT NULL,
  "phoneHash" character varying(64) NOT NULL,
  "accountSid" character varying(34) NOT NULL,
  "serviceSid" character varying(34) NOT NULL,
  "feeEvidenceHash" character varying(64) NOT NULL,
  "binding" jsonb NOT NULL,
  "reservedMicroUsd" bigint NOT NULL,
  "recordedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE "atlas_staff"."StaffAudit" (
  "id" uuid NOT NULL,
  "event" character varying(60) NOT NULL,
  "subjectId" character varying(100) NOT NULL,
  "actorId" uuid,
  "details" text NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text) NOT NULL
);

CREATE TABLE "atlas_staff"."StaffBrowser" (
  "tokenHash" character varying(64) NOT NULL,
  "controlRevision" integer NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text) NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE "atlas_staff"."StaffChallenge" (
  "id" character varying(43) NOT NULL,
  "browserHash" character varying(64) NOT NULL,
  "requestId" character varying(80) NOT NULL,
  "phoneHash" character varying(64) NOT NULL,
  "controlRevision" integer NOT NULL,
  "accountSid" character varying(34) NOT NULL,
  "serviceSid" character varying(34) NOT NULL,
  "verificationSid" character varying(34),
  "state" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "sendClaimId" uuid NOT NULL,
  "checkClaimId" uuid,
  "replayHash" character varying(64),
  "replayUntil" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text) NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "quarantineUntil" timestamp(3) without time zone NOT NULL,
  "consumedAt" timestamp(3) without time zone
);

CREATE TABLE "atlas_staff"."StaffControl" (
  "id" text DEFAULT 'active'::text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "mode" text NOT NULL,
  "origin" text NOT NULL,
  "deploymentId" text NOT NULL,
  "releaseSha" character varying(40) NOT NULL,
  "configHash" character varying(64) NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "updatedAt" timestamp(3) without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text) NOT NULL,
  "gradingPolicyHash" character varying(64)
);

CREATE TABLE "atlas_staff"."StaffIdentity" (
  "id" uuid NOT NULL,
  "phoneHash" character varying(64) NOT NULL,
  "name" character varying(100) DEFAULT 'Staff member'::character varying NOT NULL,
  "role" text DEFAULT 'REVIEWER'::text NOT NULL,
  "accessVersion" integer DEFAULT 1 NOT NULL,
  "revokedAt" timestamp(3) without time zone,
  "certificationUntil" timestamp(3) without time zone,
  "trustedLearningUntil" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text) NOT NULL,
  "lastLoginAt" timestamp(3) without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text) NOT NULL
);

CREATE TABLE "atlas_staff"."StaffOperationsGrant" (
  "id" uuid NOT NULL,
  "identityId" uuid NOT NULL,
  "accessVersion" integer NOT NULL,
  "controlRevision" integer NOT NULL,
  "mode" text NOT NULL,
  "origin" text NOT NULL,
  "deploymentId" text NOT NULL,
  "releaseSha" character varying(40) NOT NULL,
  "configHash" character varying(64) NOT NULL,
  "authorizationEvidenceHash" character varying(64) NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "revokedAt" timestamp(3) without time zone
);

CREATE TABLE "atlas_staff"."StaffRateBucket" (
  "key" character varying(100) NOT NULL,
  "count" integer NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE "atlas_staff"."StaffSession" (
  "tokenHash" character varying(64) NOT NULL,
  "identityId" uuid NOT NULL,
  "browserHash" character varying(64) NOT NULL,
  "challengeId" character varying(43) NOT NULL,
  "controlRevision" integer NOT NULL,
  "accessVersion" integer NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text) NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "revokedAt" timestamp(3) without time zone
);

CREATE OR REPLACE FUNCTION atlas_customer.account_projection(a atlas_customer."CustomerAccount")
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN a.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('id',a.id,'phone',a.phone,'profile',a.profile,'createdAt',a."createdAt") END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.canonical_email(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN length(btrim(value)) BETWEEN 3 AND 254
  AND btrim(value) !~ '[[:cntrl:][:space:]]'
  AND btrim(value) !~ U&'[\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]' AND btrim(value) ~ '^[^@]+@[^@]+\.[^@]+$'
  THEN split_part(btrim(value),'@',1)||'@'||lower(split_part(btrim(value),'@',2)) ELSE NULL END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_call(action text, account_id uuid, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE did uuid; draft atlas_customer."CustomerIntakeDraft"; ord atlas_customer."CommerceOrder";
BEGIN
 IF action='commerce_checkout' THEN
  did:=(d->>'draftId')::uuid;
  SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=did AND "accountId"=account_id;
  IF draft.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF draft.state NOT IN ('REVIEW','ORDERED') THEN RETURN atlas_customer.problem(409,'CARD_REVIEW_REQUIRED'); END IF;
  RETURN atlas_customer.commerce_public_checkout(atlas_customer.commerce_source(did));
 ELSIF action IN ('commerce_order','commerce_label') THEN
  SELECT * INTO ord FROM atlas_customer."CommerceOrder" WHERE id=(d->>'orderId')::uuid AND "accountId"=account_id;
  IF ord.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF action='commerce_label' THEN
   RETURN COALESCE((SELECT jsonb_build_object('mimeType',e.result->>'mimeType','labelBase64',e.result->>'labelBase64','labelSha256',e.result->>'labelSha256','printed',false)
    FROM atlas_customer."CommerceEffect" e WHERE e.id=d->>'effectId' AND e."orderId"=ord.id AND e.kind IN ('FEDEX_LABEL','SHIPSTATION_LABEL','PACKAGE_LABEL') AND e.state='SUCCEEDED' AND e.result->>'labelBase64' IS NOT NULL),atlas_customer.problem(409,'LABEL_NOT_READY'));
  END IF;
  RETURN atlas_customer.commerce_public_order(jsonb_build_object('id',ord.id,'reference',ord.reference,'receipt',ord.receipt,'paidAt',ord."paidAt",'shippingPayment',atlas_customer.commerce_shipping_public_state(ord.id),'effects',
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'state',e.state,'trackingNumber',e.result->>'trackingNumber','carrierName',e.result->>'carrierName','serviceName',e.result->>'serviceName','deliveryStatus',COALESCE(e.tracking->>'description',e.result->>'deliveryStatus'),'artifactState',e.result->>'state'))
   FROM atlas_customer."CommerceEffect" e WHERE e."orderId"=ord.id),'[]'::jsonb)));
 ELSE RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
EXCEPTION WHEN invalid_text_representation THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_canonical(v jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT CASE jsonb_typeof(v)
 WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||atlas_customer.commerce_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(v)),'')||'}'
 WHEN 'array' THEN '['||COALESCE((SELECT string_agg(atlas_customer.commerce_canonical(value),',' ORDER BY ord) FROM jsonb_array_elements(v) WITH ORDINALITY e(value,ord)),'')||']'
 ELSE v::text END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_effect_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW."orderId"<>OLD."orderId" OR NEW.kind<>OLD.kind OR NEW.request<>OLD.request OR NEW."createdAt"<>OLD."createdAt"
 OR (OLD.state='SUCCEEDED' AND (to_jsonb(NEW)-'tracking') IS DISTINCT FROM (to_jsonb(OLD)-'tracking'))
 OR (OLD.fulfillment IS NOT NULL AND NEW.fulfillment IS DISTINCT FROM OLD.fulfillment)
 OR (OLD."dispatchSnapshot" IS NOT NULL AND NEW."dispatchSnapshot" IS DISTINCT FROM OLD."dispatchSnapshot") OR (OLD."claimId" IS NOT NULL AND NEW."claimId" IS DISTINCT FROM OLD."claimId")
 THEN RAISE EXCEPTION 'ATLAS effect identity is immutable'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_fedex_shipping_plan_valid(plan jsonb, n integer, charged_legs text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE leg text; dimension text; request jsonb; shipment jsonb; package jsonb; party jsonb; stamp date; zone text; starts timestamptz; ends timestamptz; stable boolean:=plan->>'version'='atlas-measured-print-return-plan-v2';
BEGIN
 IF NOT COALESCE(plan->>'version' IN ('atlas-measured-shipping-plan-v1','atlas-measured-print-return-plan-v2') AND jsonb_typeof(plan->'cardCount')='number'
  AND (plan->>'cardCount')::numeric=n AND n BETWEEN 1 AND 100
  AND plan->>'packingPresetId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
  AND plan->>'shippingServiceCode' ~ '^[A-Z][A-Z0-9_]{0,79}$'
  AND length(btrim(plan->>'measurementReference')) BETWEEN 1 AND 240 AND plan->>'measurementReference' !~ '[[:cntrl:]]'
  AND plan->>'validFrom' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  AND (CASE WHEN stable THEN NOT plan ? 'validUntil' ELSE plan->>'validUntil' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' END)
  AND charged_legs IN ('INBOUND_ONLY','BOTH_LEGS'),false) THEN RETURN false; END IF;
 starts:=(plan->>'validFrom')::timestamptz;
 IF to_char(starts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>plan->>'validFrom' OR starts>statement_timestamp() THEN RETURN false; END IF;
 IF NOT stable THEN
  ends:=(plan->>'validUntil')::timestamptz;
  IF to_char(ends AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>plan->>'validUntil'
   OR ends<=statement_timestamp() OR ends<=starts OR ends-starts>interval '24 hours' THEN RETURN false; END IF;
 END IF;
 FOREACH leg IN ARRAY (CASE WHEN charged_legs='BOTH_LEGS' THEN ARRAY['INBOUND','RETURN'] ELSE ARRAY['INBOUND'] END) LOOP
  request:=plan->'legs'->leg; shipment:=request->'requestedShipment'; zone:=request->>'shipDateTimeZone';
  IF stable THEN
   IF NOT COALESCE(request->>'labelDatePolicy'='FEDEX_PRINT_RETURN_CREATION_DATE_V1' AND NOT shipment ? 'shipDatestamp'
    AND shipment->'shipmentSpecialServices'->'specialServiceTypes'='["RETURN_SHIPMENT"]'::jsonb
    AND shipment->'shipmentSpecialServices'->'returnShipmentDetail'->>'returnType'='PRINT_RETURN_LABEL',false) THEN RETURN false; END IF;
   shipment:=atlas_customer.commerce_shipping_request(plan,leg,statement_timestamp())->'requestedShipment';
  ELSIF request ? 'labelDatePolicy' THEN RETURN false;
  END IF;
  IF NOT COALESCE(zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+$' AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone)
   AND shipment->>'shipDatestamp' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   AND shipment->>'serviceType'=plan->>'shippingServiceCode' AND length(shipment->>'pickupType')>0 AND length(shipment->>'packagingType')>0
   AND shipment->'totalPackageCount'='1'::jsonb AND (leg='RETURN' OR jsonb_array_length(shipment->'recipients')=1)
   AND jsonb_array_length(shipment->'requestedPackageLineItems')=1
   AND shipment->'shippingChargesPayment'->>'paymentType' IN ('SENDER','RECIPIENT','THIRD_PARTY'),false) THEN RETURN false; END IF;
  stamp:=(shipment->>'shipDatestamp')::date;
  IF to_char(stamp,'YYYY-MM-DD')<>shipment->>'shipDatestamp' OR stamp<(statement_timestamp() AT TIME ZONE zone)::date THEN RETURN false; END IF;
  party:=CASE WHEN leg='INBOUND' THEN shipment->'recipients'->0 ELSE shipment->'shipper' END;
   IF NOT COALESCE(party->'address'->>'countryCode'='US' AND jsonb_array_length(party->'address'->'streetLines')>0
    AND length(party->'address'->>'city')>0 AND length(party->'address'->>'stateOrProvinceCode')>0 AND length(party->'address'->>'postalCode')>0
    AND length(party->'contact'->>'personName')>0 AND length(party->'contact'->>'phoneNumber')>0,false) THEN RETURN false; END IF;
  package:=shipment->'requestedPackageLineItems'->0;
  IF NOT COALESCE(package->'weight'->>'units' IN ('LB','KG') AND jsonb_typeof(package->'weight'->'value')='number' AND (package->'weight'->>'value')::numeric>0
   AND package->'dimensions'->>'units' IN ('IN','CM'),false) THEN RETURN false; END IF;
  FOREACH dimension IN ARRAY ARRAY['length','width','height'] LOOP
   IF NOT COALESCE(jsonb_typeof(package->'dimensions'->dimension)='number' AND (package->'dimensions'->>dimension)::numeric>0
    AND (package->'dimensions'->>dimension)::numeric=trunc((package->'dimensions'->>dimension)::numeric),false) THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_hash(v jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT encode(sha256(convert_to(atlas_customer.commerce_canonical(v),'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN RAISE EXCEPTION 'ATLAS commerce evidence is immutable'; END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_label_ready_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE ord atlas_customer."CommerceOrder"; bytes bytea;
BEGIN
 IF NEW.state<>'SUCCEEDED' OR OLD.state='SUCCEEDED' OR NEW.kind NOT IN ('FEDEX_LABEL','SHIPSTATION_LABEL') OR NEW.request->>'leg' IS DISTINCT FROM 'INBOUND' THEN RETURN NEW; END IF;
 -- The outbox is created in the same commit as a confirmed, hash-checked PDF.
 IF NOT COALESCE(NEW.result->>'mimeType'='application/pdf' AND length(NEW.result->>'labelBase64') BETWEEN 8 AND 5592408
  AND NEW.result->>'labelBase64' ~ '^[A-Za-z0-9+/]+={0,2}$',false) THEN RETURN NEW; END IF;
 bytes:=decode(NEW.result->>'labelBase64','base64');
 IF octet_length(bytes)>4194304 OR substring(bytes FROM 1 FOR 5)<>convert_to('%PDF-','UTF8') OR encode(sha256(bytes),'hex') IS DISTINCT FROM NEW.result->>'labelSha256' THEN RETURN NEW; END IF;
 SELECT * INTO ord FROM atlas_customer."CommerceOrder" WHERE id=NEW."orderId";
 IF NOT atlas_customer.commerce_receipt_email_valid(ord.receipt->'profile'->>'email') THEN RETURN NEW; END IF;
 INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES
  (ord.id||':label-ready-email:v1',ord.id,'EMAIL_LABEL_READY',jsonb_build_object('orderId',ord.id,'reference',ord.reference,'to',ord.receipt->'profile'->>'email','labelEffectId',NEW.id,'labelSha256',NEW.result->>'labelSha256')) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_payment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW."accountId"<>OLD."accountId" OR NEW."draftId"<>OLD."draftId" OR NEW."quoteId"<>OLD."quoteId"
 OR NEW."requestId"<>OLD."requestId" OR NEW.merchant<>OLD.merchant OR NEW."readerId" IS DISTINCT FROM OLD."readerId" OR NEW."createdAt"<>OLD."createdAt"
 OR (OLD."providerId" IS NOT NULL AND NEW."providerId" IS DISTINCT FROM OLD."providerId") OR (OLD.state IN ('PAID','CANCELED') AND NEW.state<>OLD.state)
 THEN RAISE EXCEPTION 'ATLAS payment identity is immutable'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_payment_projection(pid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT to_jsonb(p)||jsonb_build_object('quote',q.snapshot,'order',(SELECT atlas_customer.commerce_call('commerce_order',o."accountId",jsonb_build_object('orderId',o.id)) FROM atlas_customer."CommerceOrder" o WHERE o."paymentId"=p.id))
 FROM atlas_customer."CommercePayment" p JOIN atlas_customer."CommerceQuote" q ON q.id=p."quoteId" WHERE p.id=pid
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_provider_call(action text, b jsonb, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
<<provider_call>>
DECLARE ctl atlas_customer."CommerceControl"; draft atlas_customer."CustomerIntakeDraft"; q atlas_customer."CommerceQuote";
 p atlas_customer."CommercePayment"; ord atlas_customer."CommerceOrder"; ef atlas_customer."CommerceEffect";
 auth jsonb; checked jsonb; source jsonb; quote jsonb; observation jsonb; evidence jsonb; line jsonb; card jsonb; effect jsonb;
 shipping_plan jsonb; shipment_request jsonb; customer_party jsonb; dispatch jsonb; stamp timestamptz;
 did uuid; aid uuid; pid uuid; oid uuid; rid text; n integer; unit integer; shipping integer; taxes integer; total integer; idx integer;
BEGIN
 SELECT * INTO ctl FROM atlas_customer."CommerceControl" WHERE id='active';
 IF ctl.id IS NULL OR NOT ctl.enabled OR ctl.binding IS DISTINCT FROM b THEN RETURN atlas_customer.problem(503,'COMMERCE_NOT_CONFIGURED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>12582912 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF action LIKE 'commerce_shipping_%' OR (action IN ('commerce_callback_payment','commerce_callback_confirm') AND EXISTS(SELECT 1 FROM atlas_customer."CommerceShippingPayment" WHERE id=(d->>'attemptId')::uuid)) OR (action='commerce_provider_event' AND EXISTS(SELECT 1 FROM atlas_customer."CommerceShippingPayment" WHERE id=(d->'event'->>'attemptId')::uuid)) THEN RETURN atlas_customer.commerce_shipping_call(action,b,d); END IF;
 IF action='commerce_pending_effects' THEN
  UPDATE atlas_customer."CommerceEffect" SET state='UNKNOWN',"updatedAt"=clock_timestamp(),result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('code','EFFECT_RECONCILIATION_REQUIRED')
   WHERE state='DISPATCHED' AND kind<>'SMS_RECEIPT' AND "updatedAt"<clock_timestamp()-interval '5 minutes';
  RETURN jsonb_build_object('effects',COALESCE((SELECT jsonb_agg(id) FROM (SELECT id FROM atlas_customer."CommerceEffect" WHERE state='PENDING' AND kind<>'SMS_RECEIPT' AND (kind<>'SHIPSTATION_LABEL' OR request->>'leg'<>'RETURN' OR fulfillment IS NOT NULL) ORDER BY "createdAt",id LIMIT 20) ready),'[]'::jsonb));
 END IF;
 IF action='commerce_trackable_effects' THEN
  WITH ready AS (SELECT id FROM atlas_customer."CommerceEffect" WHERE kind='SHIPSTATION_LABEL' AND state='SUCCEEDED'
   AND COALESCE(tracking->>'statusCode','')<>'DE' AND (tracking->>'pollAfter' IS NULL OR (tracking->>'pollAfter')::timestamptz<=clock_timestamp())
   ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 5), marked AS (
   UPDATE atlas_customer."CommerceEffect" e SET tracking=COALESCE(e.tracking,'{}'::jsonb)||jsonb_build_object('pollAfter',clock_timestamp()+interval '6 hours')
   FROM ready WHERE e.id=ready.id RETURNING e.id)
  SELECT jsonb_build_object('effects',COALESCE(jsonb_agg(id),'[]'::jsonb)) INTO checked FROM marked;
  RETURN checked;
 END IF;
 IF action='commerce_reconcilable_effects' THEN
  -- Poll a known asynchronous job at most five times with durable backoff.
  -- No shipment create request is repeated, even if this worker crashes.
  WITH ready AS (SELECT id FROM atlas_customer."CommerceEffect" WHERE state='UNKNOWN' AND ((kind='FEDEX_LABEL' AND result->>'jobId' IS NOT NULL) OR (kind='SHIPSTATION_LABEL' AND "dispatchSnapshot" IS NOT NULL)) AND "reconcileCount"<5 AND ("reconcileAfter" IS NULL OR "reconcileAfter"<=clock_timestamp())
   ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 5), marked AS (
   UPDATE atlas_customer."CommerceEffect" e SET "reconcileAfter"=clock_timestamp()+make_interval(secs=>60*power(2,e."reconcileCount")::integer),"reconcileCount"=e."reconcileCount"+1
   FROM ready WHERE e.id=ready.id RETURNING e.id)
  SELECT jsonb_build_object('effects',COALESCE(jsonb_agg(id),'[]'::jsonb)) INTO checked FROM marked;
  RETURN checked;
 END IF;
 IF action IN ('commerce_effect','commerce_claim_effect','commerce_finish_effect','commerce_record_tracking') THEN
  SELECT * INTO ef FROM atlas_customer."CommerceEffect" WHERE id=d->>'effectId' FOR UPDATE;
  IF ef.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF action='commerce_effect' THEN RETURN to_jsonb(ef); END IF;
  IF action='commerce_record_tracking' THEN
   IF ef.kind<>'SHIPSTATION_LABEL' OR ef.state<>'SUCCEEDED' OR NOT COALESCE(
    d->'tracking'->>'provider'='SHIPSTATION' AND d->'tracking'->>'providerId'=ef.result->>'providerId'
    AND d->'tracking'->>'trackingNumber'=ef.result->>'trackingNumber'
    AND d->'tracking'->>'statusCode' IN ('UN','AC','IT','DE','EX','AT','NY')
    AND (d->'tracking')-ARRAY['provider','providerId','trackingNumber','statusCode','description','observedAt']='{}'::jsonb,false)
    THEN RETURN atlas_customer.problem(409,'SHIPPING_TRACKING_INVALID'); END IF;
   UPDATE atlas_customer."CommerceEffect" SET tracking=COALESCE(ef.tracking,'{}'::jsonb)||(d->'tracking')||jsonb_build_object('observedAt',clock_timestamp()) WHERE id=ef.id RETURNING * INTO ef;
   RETURN to_jsonb(ef);
  END IF;
  IF action='commerce_claim_effect' THEN
   IF ef.state<>'PENDING' THEN RETURN jsonb_build_object('effect',to_jsonb(ef),'dispatch',false); END IF;
   IF ef.kind='SMS_RECEIPT' THEN RETURN jsonb_build_object('effect',to_jsonb(ef),'dispatch',false,'blockedReason','SMS_NOTIFICATIONS_DISABLED'); END IF;
   IF ef.kind='SHIPSTATION_LABEL' THEN
    IF ef.request->>'leg'='RETURN' AND ef.fulfillment IS NULL THEN RETURN atlas_customer.problem(409,'RETURN_LABEL_NOT_PREPARED'); END IF;
    dispatch:=d->'dispatchSnapshot';
    IF NOT COALESCE(dispatch-ARRAY['shipment','rate','preparedAt','originalRequestHash']='{}'::jsonb
     AND dispatch->>'originalRequestHash'=atlas_customer.commerce_hash(ef.request->'shipment')
     AND dispatch->>'preparedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false) THEN RETURN atlas_customer.problem(409,'SHIPPING_DISPATCH_INVALID'); END IF;
    stamp:=(dispatch->>'preparedAt')::timestamptz;
    shipment_request:=jsonb_set(ef.request->'shipment','{shipment,ship_date}',to_jsonb(to_char(stamp AT TIME ZONE (ef.request->'shipment'->>'shipDateTimeZone'),'YYYY-MM-DD')));
    IF dispatch->'shipment' IS DISTINCT FROM shipment_request OR stamp<clock_timestamp()-interval '15 minutes' OR stamp>clock_timestamp()+interval '1 minute'
     OR NOT atlas_customer.commerce_shipstation_rate_valid(dispatch->'rate',shipment_request)
     OR (dispatch->'rate'->>'expiresAt')::timestamptz<=clock_timestamp()
     OR (dispatch->'rate'->>'expiresAt')::timestamptz>stamp+interval '15 minutes'
     THEN RETURN atlas_customer.problem(409,'SHIPPING_DISPATCH_INVALID'); END IF;
   ELSE dispatch:=NULL;
   END IF;
   UPDATE atlas_customer."CommerceEffect" SET "dispatchSnapshot"=dispatch,state='DISPATCHED',"claimId"=(d->>'claimId')::uuid,"updatedAt"=clock_timestamp() WHERE id=ef.id RETURNING * INTO ef;
   RETURN jsonb_build_object('effect',to_jsonb(ef),'dispatch',true);
  END IF;
  IF ef."claimId" IS DISTINCT FROM (d->>'claimId')::uuid OR COALESCE(d->>'state','') NOT IN ('UNKNOWN','SUCCEEDED','FAILED') THEN RETURN atlas_customer.problem(409,'EFFECT_CLAIM_CONFLICT'); END IF;
  IF ef.state='SUCCEEDED' THEN
   IF ef.result IS DISTINCT FROM d->'result' THEN RETURN atlas_customer.problem(409,'EFFECT_RESULT_CONFLICT'); END IF;
   RETURN to_jsonb(ef);
  END IF;
  IF d->>'state'='SUCCEEDED' AND ef.kind='FEDEX_LABEL' AND (COALESCE(d->'result'->>'trackingNumber','')='' OR COALESCE(d->'result'->>'labelBase64','')='') THEN RETURN atlas_customer.problem(409,'FEDEX_LABEL_MISSING'); END IF;
  IF d->>'state'='SUCCEEDED' AND ef.kind='SHIPSTATION_LABEL' AND NOT COALESCE(
   d->'result'->>'provider'='SHIPSTATION' AND d->'result'->>'providerId' ~ '^se(-[a-z0-9]+)+$'
   AND d->'result'->>'requestHash'=atlas_customer.commerce_hash(ef.request->'shipment')
   AND d->'result'->>'dispatchRequestHash'=atlas_customer.commerce_hash(ef."dispatchSnapshot"->'shipment')
   AND d->'result'->>'carrierId'=ef."dispatchSnapshot"->'shipment'->'shipment'->>'carrier_id'
   AND d->'result'->>'serviceCode'=ef."dispatchSnapshot"->'shipment'->'shipment'->>'service_code'
   AND d->'result'->>'purchasedRateId'=ef."dispatchSnapshot"->'rate'->>'providerId'
   AND d->'result'->>'shipmentId'=ef."dispatchSnapshot"->'rate'->>'shipmentId'
   AND d->'result'->>'carrierName'=ef."dispatchSnapshot"->'rate'->>'carrierName'
   AND d->'result'->>'serviceName'=ef."dispatchSnapshot"->'rate'->>'serviceName'
   AND d->'result'->>'currency'='usd'
   AND d->'result'->>'externalShipmentId'='atlas-'||substr(encode(sha256(convert_to(ef.id,'UTF8')),'hex'),1,44)
   AND length(d->'result'->>'trackingNumber') BETWEEN 1 AND 200 AND d->'result'->>'mimeType'='application/pdf'
   AND length(d->'result'->>'labelBase64') BETWEEN 8 AND 5592408
   AND d->'result'->>'labelBase64' ~ '^[A-Za-z0-9+/]+={0,2}$'
   AND octet_length(decode(d->'result'->>'labelBase64','base64'))<=4194304
   AND substring(decode(d->'result'->>'labelBase64','base64') FROM 1 FOR 5)=convert_to('%PDF-','UTF8')
   AND encode(sha256(decode(d->'result'->>'labelBase64','base64')),'hex')=d->'result'->>'labelSha256'
   AND jsonb_typeof(d->'result'->'purchasedAmountCents')='number' AND (d->'result'->>'purchasedAmountCents')::numeric>=0
   AND (d->'result'->>'purchasedAmountCents')::numeric=trunc((d->'result'->>'purchasedAmountCents')::numeric),false)
   THEN RETURN atlas_customer.problem(409,'SHIPSTATION_LABEL_INVALID'); END IF;
  UPDATE atlas_customer."CommerceEffect" SET state=d->>'state',result=d->'result',"updatedAt"=clock_timestamp() WHERE id=ef.id RETURNING * INTO ef;
  RETURN to_jsonb(ef);
 END IF;
 IF action='commerce_provider_event' THEN
  evidence:=d->'event'; pid:=(evidence->>'attemptId')::uuid;
  IF evidence->>'merchantId' IS DISTINCT FROM ctl.merchant->>'accountId' OR evidence->'livemode' IS DISTINCT FROM ctl.merchant->'livemode'
   OR COALESCE(evidence->>'eventId','')='' OR COALESCE(evidence->>'bodyHash','') !~ '^[a-f0-9]{64}$' THEN RETURN atlas_customer.problem(409,'PAYMENT_MERCHANT_MISMATCH'); END IF;
  IF EXISTS (SELECT 1 FROM atlas_customer."CommerceProviderEvent" WHERE provider=ctl.merchant->>'provider' AND merchant=ctl.merchant->>'accountId' AND "eventId"=evidence->>'eventId' AND "bodyHash"<>evidence->>'bodyHash') THEN RETURN atlas_customer.problem(409,'PROVIDER_EVENT_CONFLICT'); END IF;
  INSERT INTO atlas_customer."CommerceProviderEvent"(provider,merchant,"eventId","bodyHash","paymentId") VALUES (ctl.merchant->>'provider',ctl.merchant->>'accountId',evidence->>'eventId',evidence->>'bodyHash',pid) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('recorded',true);
 END IF;
 IF action IN ('commerce_checkout','commerce_save_quote') THEN did:=COALESCE(d->>'draftId',d->'quote'->>'draftId')::uuid;
 ELSIF action='commerce_reserve_payment' THEN SELECT "draftId" INTO did FROM atlas_customer."CommerceQuote" WHERE id=(d->>'quoteId')::uuid;
 ELSIF action IN ('commerce_record_payment','commerce_payment','commerce_confirm_paid','commerce_callback_payment','commerce_callback_confirm') THEN SELECT "draftId" INTO did FROM atlas_customer."CommercePayment" WHERE id=(d->>'attemptId')::uuid;
 ELSIF action='commerce_order' THEN SELECT "draftId" INTO did FROM atlas_customer."CommerceOrder" WHERE id=(d->>'orderId')::uuid;
 ELSE RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF did IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action NOT IN ('commerce_callback_payment','commerce_callback_confirm') THEN
  auth:=d->'authority';
  checked:=atlas_customer.customer_call('intake_read',auth->'binding',(auth- 'binding')||jsonb_build_object('id',did));
  IF checked ? 'error' THEN RETURN checked; END IF;
 END IF;
 -- Same per-account lock order as intake mutations, then draft row.
 SELECT "accountId" INTO aid FROM atlas_customer."CustomerIntakeDraft" WHERE id=did;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-intake:'||aid::text,0));
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=did FOR UPDATE;
 source:=atlas_customer.commerce_source(did);
 IF action='commerce_checkout' THEN
  IF draft.state NOT IN ('REVIEW','ORDERED') THEN RETURN atlas_customer.problem(409,'CARD_REVIEW_REQUIRED'); END IF;
  RETURN source;
 END IF;
 IF action='commerce_order' THEN RETURN atlas_customer.commerce_call(action,aid,d); END IF;
 IF action='commerce_save_quote' THEN
  quote:=d->'quote'; n:=jsonb_array_length(source->'cards'); unit:=CASE WHEN draft."intakeMethod"='MAIL_IN' THEN 4000 ELSE 5000 END;
  IF NOT atlas_customer.commerce_receipt_email_valid(source->'profile'->>'email') THEN RETURN atlas_customer.problem(409,'PROFILE_EMAIL_REQUIRED'); END IF;
  IF jsonb_typeof(quote) IS DISTINCT FROM 'object' OR NOT quote ?& ARRAY['id','draftId','draftRevision','profileRevision','accountId','profile','phone','channel','location','cards','currency','subtotalCents','shippingCents','taxCents','totalCents','tax','shipping','merchant','terms','expiresAt','createdAt','contentHash']
   OR EXISTS (SELECT 1 FROM unnest(ARRAY['draftRevision','profileRevision','subtotalCents','shippingCents','taxCents','totalCents']) k WHERE jsonb_typeof(quote->k) IS DISTINCT FROM 'number' OR (quote->>k)::numeric<>trunc((quote->>k)::numeric))
   OR draft.state<>'REVIEW' OR draft.revision IS DISTINCT FROM (d->>'expectedRevision')::integer OR (quote->>'draftRevision')::integer<>draft.revision
   OR quote->'profile' IS DISTINCT FROM draft."profileSnapshot" OR quote->>'accountId' IS DISTINCT FROM aid::text OR quote->>'phone' IS DISTINCT FROM source->>'phone'
   OR quote->>'channel' IS DISTINCT FROM source->>'channel' OR quote->'location' IS DISTINCT FROM source->'location' OR quote->'merchant' IS DISTINCT FROM ctl.merchant
   OR (quote->>'profileRevision')::integer<>draft.revision OR quote->>'currency'<>'usd' OR n NOT BETWEEN 1 AND 100 OR jsonb_array_length(quote->'cards')<>n
   THEN RETURN atlas_customer.problem(409,'CHECKOUT_CHANGED'); END IF;
  IF draft."kioskId" IS NOT NULL AND (source->'location'='null'::jsonb OR source->'location'->'schedule'->>'nextCollectionAt' IS NULL) THEN RETURN atlas_customer.problem(409,'KIOSK_NOT_AVAILABLE'); END IF;
  idx:=0;
  FOR card IN SELECT value FROM jsonb_array_elements(source->'cards') LOOP
   line:=quote->'cards'->idx;
   IF line->>'cardId' IS DISTINCT FROM card->>'id' OR line->'revision' IS DISTINCT FROM card->'revision' OR line->'photoPairHash' IS DISTINCT FROM card->'photoPairHash'
    OR line->'identity' IS DISTINCT FROM card->'identity' OR card->'identity'='null'::jsonb OR (line->>'unitCents')::numeric IS DISTINCT FROM unit::numeric
    OR (line->>'commissionCents')::numeric IS DISTINCT FROM (CASE WHEN unit=5000 THEN 500 ELSE 0 END)::numeric
    OR (SELECT count(*) FROM atlas_customer."CustomerIntakeUpload" WHERE "cardId"=(card->>'id')::uuid AND verification IS NOT NULL)<>2 THEN RETURN atlas_customer.problem(409,'CHECKOUT_CHANGED'); END IF;
   idx:=idx+1;
  END LOOP;
  shipping:=(quote->>'shippingCents')::integer; taxes:=(quote->>'taxCents')::integer; total:=(quote->>'totalCents')::integer;
  IF (quote->>'subtotalCents')::integer<>n*unit OR shipping<0 OR taxes<0 OR total<>n*unit+shipping+taxes
   OR quote->'tax'->>'providerId' IS NULL OR quote->'tax'->>'currency' IS DISTINCT FROM 'usd' OR (quote->'tax'->>'taxCents')::numeric IS DISTINCT FROM taxes::numeric OR (quote->'tax'->>'totalCents')::numeric IS DISTINCT FROM total::numeric
   OR quote->>'contentHash' IS DISTINCT FROM atlas_customer.commerce_hash(quote-'contentHash')
   OR (quote->>'expiresAt')::timestamptz<=clock_timestamp() OR (quote->>'expiresAt')::timestamptz>clock_timestamp()+interval '16 minutes'
   THEN RETURN atlas_customer.problem(409,'QUOTE_INVALID'); END IF;
  IF quote->'terms'->>'paymentFlow' IS DISTINCT FROM 'CUSTOMER_PHONE' THEN RETURN atlas_customer.problem(409,'PAYMENT_FLOW_CHANGED'); END IF;
  IF unit=5000 THEN
   IF shipping<>0 OR quote->'shipping'<>'[]'::jsonb OR quote->'shippingPlan' IS DISTINCT FROM 'null'::jsonb OR quote->'terms'->>'clockStart'<>'ATLAS_COLLECTION' OR (quote->'terms'->>'days')::integer IS DISTINCT FROM 7 THEN RETURN atlas_customer.problem(409,'KIOSK_SHIPPING_FORBIDDEN'); END IF;
  ELSIF ctl.terms->>'shippingPayment'='SEPARATE_PAYMENT' THEN
   IF shipping<>0 OR quote->'shipping' IS DISTINCT FROM '[]'::jsonb OR quote->'shippingPlan' IS DISTINCT FROM 'null'::jsonb OR quote ? 'inboundPackage'
    OR quote->'terms'->>'shippingPayment' IS DISTINCT FROM 'SEPARATE_PAYMENT' OR quote->>'shippingStatus' IS DISTINCT FROM 'UNQUOTED_UNPAID'
    OR quote->'terms'->'mailChargedLegs' IS DISTINCT FROM 'null'::jsonb OR quote->'terms'->>'clockStart' IS DISTINCT FROM 'ATLAS_RECEIPT'
    OR ctl.terms->>'mailClockStart' IS DISTINCT FROM 'ATLAS_RECEIPT' OR (quote->'terms'->>'days')::integer IS DISTINCT FROM 14 THEN RETURN atlas_customer.problem(409,'MAIL_SHIPPING_TERMS_NOT_CONFIGURED'); END IF;
  ELSE
   IF quote->'terms' ? 'shippingPayment' OR quote ? 'shippingStatus' THEN RETURN atlas_customer.problem(409,'MAIL_SHIPPING_TERMS_NOT_CONFIGURED'); END IF;
   shipping_plan:=quote->'shippingPlan';
   IF NOT atlas_customer.commerce_shipping_plan_valid(shipping_plan,n,ctl.terms->>'mailChargedLegs')
    OR (SELECT count(*) FROM jsonb_array_elements(source->'shippingPlans') configured WHERE configured=shipping_plan)<>1
    OR (shipping_plan->>'version'='atlas-measured-shipping-plan-v1' AND (quote->>'expiresAt')::timestamptz>(shipping_plan->>'validUntil')::timestamptz) THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   IF shipping_plan->>'version' IN ('atlas-measured-print-return-plan-v2','atlas-measured-shipstation-plan-v1') AND (
    NOT COALESCE(quote->>'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false)
    OR to_char((quote->>'createdAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>quote->>'createdAt'
    OR (quote->>'createdAt')::timestamptz<clock_timestamp()-interval '15 minutes'
    OR (quote->>'createdAt')::timestamptz>clock_timestamp()+interval '1 minute'
    OR (quote->>'expiresAt')::timestamptz>(quote->>'createdAt')::timestamptz+interval '15 minutes'
   ) THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   customer_party:=jsonb_build_object('contact',jsonb_build_object('personName',source->'profile'->>'name','phoneNumber',source->>'phone'),
    'address',jsonb_build_object('streetLines',CASE WHEN COALESCE(source->'profile'->>'address2','')<>'' THEN jsonb_build_array(source->'profile'->>'address1',source->'profile'->>'address2') ELSE jsonb_build_array(source->'profile'->>'address1') END,
    'city',source->'profile'->>'city','stateOrProvinceCode',source->'profile'->>'region','postalCode',source->'profile'->>'postalCode','countryCode',source->'profile'->>'country'));
   FOR line IN SELECT value FROM jsonb_array_elements(quote->'shipping') LOOP
    shipment_request:=atlas_customer.commerce_shipping_request(shipping_plan,line->>'leg',(quote->>'createdAt')::timestamptz);
    IF shipping_plan->>'version'='atlas-measured-shipstation-plan-v1' THEN
     shipment_request:=jsonb_set(shipment_request,ARRAY['shipment',CASE WHEN line->>'leg'='INBOUND' THEN 'ship_from' ELSE 'ship_to' END],atlas_customer.commerce_shipstation_customer(source->'profile',source->>'phone'));
     IF shipping_plan->>'inboundPackaging'='CUSTOMER_MEASURED' THEN
      IF NOT atlas_customer.commerce_shipstation_package_valid(quote->'inboundPackage') THEN RETURN atlas_customer.problem(409,'MEASURED_PACKAGE_REQUIRED'); END IF;
      IF line->>'leg'='INBOUND' THEN shipment_request:=jsonb_set(shipment_request,'{shipment,packages}',jsonb_build_array(quote->'inboundPackage'||jsonb_build_object('package_code','package'))); END IF;
     ELSIF quote ? 'inboundPackage' THEN RETURN atlas_customer.problem(409,'UNEXPECTED_PACKAGE_MEASUREMENTS'); END IF;
     IF line->>'provider' IS DISTINCT FROM 'SHIPSTATION' OR NOT atlas_customer.commerce_shipstation_rate_valid(line->'rate',shipment_request)
      OR line->'rate'->>'providerId' IS DISTINCT FROM line->>'providerId' OR line->'rate'->'amountCents' IS DISTINCT FROM line->'amountCents'
      OR line->'rate'->>'carrierName' IS DISTINCT FROM line->>'carrierName' OR line->'rate'->>'serviceName' IS DISTINCT FROM line->>'serviceName'
      OR line->'rate'->>'expiresAt' IS DISTINCT FROM line->>'expiresAt' OR (line->>'expiresAt')::timestamptz<(quote->>'expiresAt')::timestamptz
      THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
    ELSE
     shipment_request:=CASE WHEN line->>'leg'='INBOUND' THEN jsonb_set(shipment_request,'{requestedShipment,shipper}',customer_party)
      ELSE jsonb_set(shipment_request,'{requestedShipment,recipients}',jsonb_build_array(customer_party)) END;
     IF line ? 'provider' AND line->>'provider'<>'FEDEX' THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
    END IF;
    IF line->'request' IS DISTINCT FROM shipment_request THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   END LOOP;
   IF ctl.terms->>'mailClockStart' IS DISTINCT FROM 'ATLAS_RECEIPT' OR COALESCE(ctl.terms->>'mailChargedLegs','') NOT IN ('INBOUND_ONLY','BOTH_LEGS')
    OR quote->'terms'->>'clockStart' IS DISTINCT FROM ctl.terms->>'mailClockStart' OR quote->'terms'->>'mailChargedLegs' IS DISTINCT FROM ctl.terms->>'mailChargedLegs'
    OR (quote->'terms'->>'days')::integer IS DISTINCT FROM 14 OR jsonb_array_length(quote->'shipping')<>(CASE WHEN ctl.terms->>'mailChargedLegs'='BOTH_LEGS' THEN 2 ELSE 1 END)
    OR shipping<>(SELECT sum((value->>'amountCents')::numeric) FROM jsonb_array_elements(quote->'shipping'))
    OR quote->'shipping'->0->>'leg' IS DISTINCT FROM 'INBOUND' OR (ctl.terms->>'mailChargedLegs'='BOTH_LEGS' AND quote->'shipping'->1->>'leg' IS DISTINCT FROM 'RETURN')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(quote->'shipping') rate WHERE rate->>'providerId' IS NULL OR rate->>'currency' IS DISTINCT FROM 'usd'
      OR (rate->>'amountCents')::numeric<0 OR (rate->>'amountCents')::numeric<>trunc((rate->>'amountCents')::numeric)
      OR rate->>'requestHash' IS DISTINCT FROM atlas_customer.commerce_hash(rate->'request')) THEN RETURN atlas_customer.problem(409,'MAIL_SHIPPING_TERMS_NOT_CONFIGURED'); END IF;
  END IF;
  INSERT INTO atlas_customer."CommerceQuote"(id,"accountId","draftId","draftRevision","contentHash",snapshot,"expiresAt") VALUES
   ((quote->>'id')::uuid,aid,did,draft.revision,quote->>'contentHash',quote,(quote->>'expiresAt')::timestamptz) ON CONFLICT DO NOTHING;
  SELECT * INTO q FROM atlas_customer."CommerceQuote" WHERE id=(quote->>'id')::uuid;
  IF q.snapshot IS DISTINCT FROM quote THEN RETURN atlas_customer.problem(409,'QUOTE_CONFLICT'); END IF;
  RETURN q.snapshot;
 END IF;
 IF action='commerce_reserve_payment' THEN
  SELECT * INTO p FROM atlas_customer."CommercePayment" WHERE "accountId"=aid AND "requestId"=(d->>'requestId')::uuid;
  IF p.id IS NOT NULL THEN
   IF p."quoteId"<>(d->>'quoteId')::uuid THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
   RETURN jsonb_build_object('attempt',atlas_customer.commerce_payment_projection(p.id),'dispatch',false);
  END IF;
  SELECT * INTO p FROM atlas_customer."CommercePayment" WHERE "draftId"=did AND state<>'CANCELED';
  IF p.id IS NOT NULL THEN RETURN jsonb_build_object('attempt',atlas_customer.commerce_payment_projection(p.id),'dispatch',false); END IF;
  SELECT * INTO q FROM atlas_customer."CommerceQuote" WHERE id=(d->>'quoteId')::uuid;
  IF q."accountId"<>aid OR q."expiresAt"<=clock_timestamp() OR q."draftRevision"<>draft.revision OR draft.state<>'REVIEW'
   OR q.snapshot->'profile' IS DISTINCT FROM draft."profileSnapshot" OR q.snapshot->'merchant' IS DISTINCT FROM ctl.merchant OR d->'merchant' IS DISTINCT FROM ctl.merchant
   THEN RETURN atlas_customer.problem(409,'CHECKOUT_CHANGED'); END IF;
  IF q.snapshot->>'channel'='MAIL_IN' AND (COALESCE(q.snapshot->'terms'->>'shippingPayment','')='SEPARATE_PAYMENT') IS DISTINCT FROM (COALESCE(ctl.terms->>'shippingPayment','')='SEPARATE_PAYMENT') THEN RETURN atlas_customer.problem(409,'PAYMENT_FLOW_CHANGED'); END IF;
  -- Existing attempts were returned above: new email requirements cannot rewrite them.
  IF NOT atlas_customer.commerce_receipt_email_valid(q.snapshot->'profile'->>'email') THEN RETURN atlas_customer.problem(409,'PROFILE_EMAIL_REQUIRED'); END IF;
  -- Every current card/photo binding must still match the immutable quote.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(source->'cards') c WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q.snapshot->'cards') l WHERE l->>'cardId'=c->>'id' AND l->'revision'=c->'revision' AND l->'photoPairHash'=c->'photoPairHash' AND l->'identity'=c->'identity'))
   OR jsonb_array_length(source->'cards')<>jsonb_array_length(q.snapshot->'cards') THEN RETURN atlas_customer.problem(409,'CHECKOUT_CHANGED'); END IF;
  IF draft."kioskId" IS NOT NULL THEN
   IF atlas_customer.intake_location(draft."kioskId") IS DISTINCT FROM q.snapshot->'location' THEN RETURN atlas_customer.problem(409,'KIOSK_NOT_AVAILABLE'); END IF;
   IF q.snapshot->'terms'->>'paymentFlow' IS DISTINCT FROM 'CUSTOMER_PHONE' THEN RETURN atlas_customer.problem(409,'PAYMENT_FLOW_CHANGED'); END IF;
   -- New shop purchases use the customer's phone. Existing unresolved terminal
   -- attempts were returned above unchanged; no reader is reserved here.
  END IF;
  INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,"readerId",state) VALUES
   ((d->>'attemptId')::uuid,aid,did,q.id,(d->>'requestId')::uuid,ctl.merchant,rid,'DISPATCHED') RETURNING * INTO p;
  RETURN jsonb_build_object('attempt',atlas_customer.commerce_payment_projection(p.id),'dispatch',true);
 END IF;
 SELECT * INTO p FROM atlas_customer."CommercePayment" WHERE id=(d->>'attemptId')::uuid FOR UPDATE;
 IF p.id IS NULL OR p.merchant IS DISTINCT FROM ctl.merchant THEN RETURN atlas_customer.problem(409,'PAYMENT_MERCHANT_MISMATCH'); END IF;
 SELECT * INTO q FROM atlas_customer."CommerceQuote" WHERE id=p."quoteId";
 IF action IN ('commerce_payment','commerce_callback_payment') THEN RETURN atlas_customer.commerce_payment_projection(p.id); END IF;
 IF action='commerce_record_payment' THEN
  observation:=d->'observation';
  IF COALESCE(observation->>'state','') NOT IN ('UNKNOWN','AWAITING_PAYMENT','PROCESSING','CANCELED') THEN RETURN atlas_customer.problem(400,'INVALID_PAYMENT_STATE'); END IF;
  IF p.state='PAID' THEN RETURN atlas_customer.commerce_payment_projection(p.id); END IF;
  IF p."providerId" IS NOT NULL AND observation->>'providerId' IS NOT NULL AND p."providerId"<>observation->>'providerId' THEN RETURN atlas_customer.problem(409,'PAYMENT_ID_MISMATCH'); END IF;
  IF observation->>'state'='CANCELED' AND (observation->>'source' IS DISTINCT FROM 'PROVIDER_RETRIEVAL' OR observation->>'status' IS DISTINCT FROM 'canceled' OR observation->>'attemptId' IS DISTINCT FROM p.id::text OR observation->>'quoteHash' IS DISTINCT FROM q."contentHash"
   OR observation->>'merchantId' IS DISTINCT FROM p.merchant->>'accountId' OR observation->'livemode' IS DISTINCT FROM p.merchant->'livemode' OR observation->'amountCents' IS DISTINCT FROM q.snapshot->'totalCents') THEN RETURN atlas_customer.problem(409,'PAYMENT_NOT_CONFIRMED'); END IF;
  UPDATE atlas_customer."CommercePayment" SET state=provider_call.observation->>'state',"providerId"=COALESCE("providerId",provider_call.observation->>'providerId'),observation=COALESCE(p.observation,'{}'::jsonb)||provider_call.observation,"updatedAt"=clock_timestamp() WHERE id=p.id;
  RETURN atlas_customer.commerce_payment_projection(p.id);
 END IF;
 IF action IN ('commerce_confirm_paid','commerce_callback_confirm') THEN
  evidence:=d->'evidence';
  IF evidence->>'source' IS DISTINCT FROM 'PROVIDER_RETRIEVAL' OR evidence->>'status' IS DISTINCT FROM 'succeeded'
   OR evidence->>'provider' IS DISTINCT FROM p.merchant->>'provider' OR evidence->>'merchantId' IS DISTINCT FROM p.merchant->>'accountId' OR evidence->'livemode' IS DISTINCT FROM p.merchant->'livemode'
   OR evidence->>'attemptId' IS DISTINCT FROM p.id::text OR evidence->>'quoteHash' IS DISTINCT FROM q."contentHash"
   OR evidence->'amountCents' IS DISTINCT FROM q.snapshot->'totalCents' OR evidence->'receivedCents' IS DISTINCT FROM q.snapshot->'totalCents' OR evidence->>'currency' IS DISTINCT FROM q.snapshot->>'currency'
   OR COALESCE(evidence->>'providerId','')='' OR (p."providerId" IS NOT NULL AND p."providerId"<>evidence->>'providerId')
   OR NOT COALESCE(evidence->'paymentMethodTypes' ? CASE WHEN q.snapshot->>'channel'='KIOSK' AND COALESCE(q.snapshot->'terms'->>'paymentFlow','')<>'CUSTOMER_PHONE' THEN 'card_present' ELSE 'card' END,false) THEN RETURN atlas_customer.problem(409,'PAYMENT_BINDING_MISMATCH'); END IF;
  SELECT * INTO ord FROM atlas_customer."CommerceOrder" WHERE "paymentId"=p.id;
  IF ord.id IS NOT NULL THEN RETURN jsonb_build_object('order',atlas_customer.commerce_call('commerce_order',aid,jsonb_build_object('orderId',ord.id))); END IF;
  oid:=(d->>'receiptId')::uuid;
  UPDATE atlas_customer."CommercePayment" SET state='PAID',"providerId"=evidence->>'providerId',observation=evidence- 'clientSecret',"updatedAt"=clock_timestamp() WHERE id=p.id;
  INSERT INTO atlas_customer."CommerceOrder"(id,"accountId","draftId","quoteId","paymentId",reference,receipt,"paidAt") VALUES
   (oid,aid,did,q.id,p.id,'ATLAS-'||upper(substr(replace(oid::text,'-',''),1,18)),
    (q.snapshot-ARRAY['merchant','phone'])||jsonb_build_object('payment',evidence- 'clientSecret'),clock_timestamp()) RETURNING * INTO ord;
  -- Build effects in SQL from the paid snapshot; browser/private caller cannot
  -- alter destinations, totals, shipping request or effect multiplicity.
  IF q.snapshot->>'channel'<>'KIOSK' OR COALESCE(q.snapshot->'terms'->>'paymentFlow','')<>'CUSTOMER_PHONE'
   OR COALESCE(btrim(q.snapshot->'profile'->>'email'),'')<>'' THEN
   INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES
    (oid||':email:v1',oid,'EMAIL_RECEIPT',jsonb_build_object('orderId',oid,'reference',ord.reference,'to',q.snapshot->'profile'->>'email','currency','usd','totalCents',q.snapshot->'totalCents','quoteHash',q."contentHash",'shippingPayment',q.snapshot->'terms'->>'shippingPayment'));
  END IF;
  INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES
   (oid||':tax:v1',oid,'TAX_TRANSACTION',jsonb_build_object('orderId',oid,'calculationId',q.snapshot->'tax'->>'providerId'));
  FOR line IN SELECT value FROM jsonb_array_elements(q.snapshot->'shipping') LOOP
   IF line->>'provider'='SHIPSTATION' THEN
    INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES (oid||':shipstation:'||(line->>'leg')||':v1',oid,'SHIPSTATION_LABEL',jsonb_build_object('orderId',oid,'shipment',line->'request','leg',line->>'leg','rateId',line->>'providerId','rate',line->'rate'));
   ELSE
   INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES (oid||':fedex:'||(line->>'leg')||':v1',oid,'FEDEX_LABEL',jsonb_build_object('orderId',oid,'shipment',line->'request','leg',line->>'leg','rateId',line->>'providerId'));
   END IF;
  END LOOP;
  IF q.snapshot->>'channel'='KIOSK' AND COALESCE(q.snapshot->'terms'->>'paymentFlow','')<>'CUSTOMER_PHONE' THEN INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES (oid||':package:v1',oid,'PACKAGE_LABEL',jsonb_build_object('orderId',oid,'reference',ord.reference,'cardCount',jsonb_array_length(q.snapshot->'cards'),'locationId',q.snapshot->'location'->>'id')); END IF;
  UPDATE atlas_customer."CustomerIntakeDraft" SET state='ORDERED',"updatedAt"=clock_timestamp() WHERE id=did;
  RETURN jsonb_build_object('order',atlas_customer.commerce_call('commerce_order',aid,jsonb_build_object('orderId',oid)));
 END IF;
 RETURN atlas_customer.problem(404,'NOT_FOUND');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR not_null_violation OR check_violation THEN RETURN atlas_customer.problem(400,'INVALID_COMMERCE_REQUEST');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_cards(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_agg(atlas_customer.commerce_public_fields(value,ARRAY['id','cardId','revision','unitCents'])||jsonb_build_object(
 'identity',atlas_customer.commerce_public_fields(value->'identity',ARRAY['category','title','playerName','year','manufacturer','setName','cardNumber','parallel','insert'])) ORDER BY ord),'[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_checkout(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('version','atlas-commerce-checkout-v1','draftId',v->'draftId','revision',v->'revision','channel',v->'channel',
 'cards',atlas_customer.commerce_public_cards(CASE WHEN v->'activePayment'->>'state'='PAID' THEN v->'activePayment'->'order'->'receipt'->'cards' ELSE v->'cards' END),
 'location',atlas_customer.commerce_public_location(CASE WHEN v->'activePayment'->>'state'='PAID' THEN v->'activePayment'->'order'->'receipt'->'location' ELSE v->'location' END),
 'terms',atlas_customer.commerce_public_fields(v->'terms',ARRAY['shippingPayment']),
 'activePayment',atlas_customer.commerce_public_payment(v->'activePayment'),
 'unitCents',CASE WHEN v->>'channel'='KIOSK' THEN 5000 ELSE 4000 END,'turnaroundDays',CASE WHEN v->>'channel'='KIOSK' THEN 7 ELSE 14 END,
 'shippingOptions',atlas_customer.commerce_public_rows(v->'shippingPlans',ARRAY['packingPresetId','shippingServiceCode','label','packaging','carrierLabel','serviceLabel','inboundPackaging']),'blockers','[]'::jsonb)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_fields(v jsonb, keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(v)='object' THEN v ELSE '{}'::jsonb END)
 WHERE key=ANY(keys) AND jsonb_typeof(value) IN ('string','number','boolean','null')
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_location(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.commerce_public_fields(v,ARRAY['id','name','revision'])||jsonb_build_object(
 'address',atlas_customer.commerce_public_fields(v->'address',ARRAY['line1','city','region','postalCode','country']),
 'schedule',atlas_customer.commerce_public_fields(v->'schedule',ARRAY['timeZone','nextCollectionAt','projectedReturnAt','cutoffAt'])||jsonb_build_object(
 'pickups',atlas_customer.commerce_public_rows(v->'schedule'->'pickups',ARRAY['weekday','time','cutoff']),
 'returns',atlas_customer.commerce_public_rows(v->'schedule'->'returns',ARRAY['weekday','time']),
 'exceptions',atlas_customer.commerce_public_rows(v->'schedule'->'exceptions',ARRAY['date','kind','cancelled','time','cutoff','reason']))) END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_order(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.commerce_public_fields(v,ARRAY['id','reference','paidAt'])||jsonb_build_object('receipt',atlas_customer.commerce_public_quote(v->'receipt'),
 'shippingPayment',CASE WHEN jsonb_typeof(v->'shippingPayment')='object' THEN atlas_customer.commerce_public_fields(v->'shippingPayment',ARRAY['state','labelReadyEmailEnabled'])||jsonb_build_object('activePayment',atlas_customer.commerce_public_fields(v->'shippingPayment'->'activePayment',ARRAY['attemptId','state','channel','paymentFlow']),'receipt',CASE WHEN jsonb_typeof(v->'shippingPayment'->'receipt')='object' THEN atlas_customer.commerce_public_quote(v->'shippingPayment'->'receipt') ELSE NULL END) ELSE NULL END,
 'effects',COALESCE((SELECT jsonb_agg(atlas_customer.commerce_public_fields(value,ARRAY['id','kind','state','trackingNumber','deliveryStatus','artifactState','carrierName','serviceName']) ORDER BY ord)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v->'effects')='array' THEN v->'effects' ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
 WHERE value->>'kind' IN ('EMAIL_RECEIPT','EMAIL_SHIPPING_RECEIPT','EMAIL_LABEL_READY','SMS_RECEIPT','FEDEX_LABEL','SHIPSTATION_LABEL','PACKAGE_LABEL')),'[]'::jsonb)) END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_payment(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.commerce_public_fields(v,ARRAY['state','channel','paymentFlow'])||jsonb_build_object('attemptId',COALESCE(v->'id',v->'attemptId'))
 ||CASE WHEN v->>'state'='PAID' THEN jsonb_build_object('order',atlas_customer.commerce_public_order(v->'order')) ELSE '{}'::jsonb END END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_quote(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT atlas_customer.commerce_public_fields(v,ARRAY['id','orderId','purpose','shippingStatus','draftId','draftRevision','channel','currency','subtotalCents','shippingCents','taxCents','totalCents','createdAt','expiresAt'])||jsonb_build_object(
 'inboundPackage',CASE WHEN v ? 'inboundPackage' THEN jsonb_build_object('weight',atlas_customer.commerce_public_fields(v->'inboundPackage'->'weight',ARRAY['unit','value']),'dimensions',atlas_customer.commerce_public_fields(v->'inboundPackage'->'dimensions',ARRAY['unit','length','width','height'])) ELSE NULL END,'cards',atlas_customer.commerce_public_cards(v->'cards'),'location',atlas_customer.commerce_public_location(v->'location'),
 'terms',atlas_customer.commerce_public_fields(v->'terms',ARRAY['days','clockStart','mailChargedLegs','paymentFlow','shippingPayment']),
 'shipping',atlas_customer.commerce_public_rows(v->'shipping',ARRAY['leg','amountCents','currency','expiresAt','provider','carrierName','serviceName']))
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_rows(v jsonb, keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_agg(atlas_customer.commerce_public_fields(value,keys) ORDER BY ord),'[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_receipt_email_valid(value text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(length(value) BETWEEN 3 AND 254 AND value !~ '[[:cntrl:][:space:]]'
  AND value ~ '^[^@]+@[^@]+\.[^@]+$',false)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_return_ready(oid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM atlas_dealer.order_card WHERE order_id=oid)
 AND NOT EXISTS(SELECT 1 FROM atlas_dealer.order_card c WHERE c.order_id=oid AND (
  (SELECT kind FROM atlas_dealer.custody_event WHERE card_id=c.card_id AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED') ORDER BY sequence DESC LIMIT 1) IS DISTINCT FROM 'ATLAS_RECEIVED'
  OR NOT EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link l JOIN atlas_manual.approval a ON a.card_id=l.manual_card_id WHERE l.card_id=c.card_id)))
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_call(action text, b jsonb, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
<<shipping_call>>
DECLARE ctl atlas_customer."CommerceControl"; ord atlas_customer."CommerceOrder"; q atlas_customer."CommerceShippingQuote"; p atlas_customer."CommerceShippingPayment"; paid atlas_customer."CommerceShippingReceipt";
 source jsonb; quote jsonb; evidence jsonb; observation jsonb; checked jsonb; auth jsonb; shipping_plan jsonb; customer_party jsonb; shipment_request jsonb; line jsonb;
 oid uuid; aid uuid; pid uuid; n integer; shipping integer; taxes integer; total integer;
BEGIN
 SELECT * INTO ctl FROM atlas_customer."CommerceControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR ctl.binding IS DISTINCT FROM b THEN RETURN atlas_customer.problem(503,'COMMERCE_NOT_CONFIGURED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>12582912 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF action='commerce_provider_event' THEN
  evidence:=d->'event';pid:=(evidence->>'attemptId')::uuid;
  SELECT * INTO p FROM atlas_customer."CommerceShippingPayment" WHERE id=pid;
  IF p.id IS NULL OR p.merchant IS DISTINCT FROM ctl.merchant OR evidence->>'merchantId' IS DISTINCT FROM ctl.merchant->>'accountId'
   OR evidence->'livemode' IS DISTINCT FROM ctl.merchant->'livemode' OR COALESCE(evidence->>'eventId','')='' OR COALESCE(evidence->>'bodyHash','') !~ '^[a-f0-9]{64}$' THEN RETURN atlas_customer.problem(409,'PAYMENT_MERCHANT_MISMATCH'); END IF;
  IF EXISTS(SELECT 1 FROM atlas_customer."CommerceShippingProviderEvent" WHERE provider=ctl.merchant->>'provider' AND merchant=ctl.merchant->>'accountId' AND "eventId"=evidence->>'eventId' AND "bodyHash"<>evidence->>'bodyHash') THEN RETURN atlas_customer.problem(409,'PROVIDER_EVENT_CONFLICT'); END IF;
  INSERT INTO atlas_customer."CommerceShippingProviderEvent"(provider,merchant,"eventId","bodyHash","paymentId") VALUES(ctl.merchant->>'provider',ctl.merchant->>'accountId',evidence->>'eventId',evidence->>'bodyHash',pid) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('recorded',true);
 END IF;
 IF action IN ('commerce_callback_payment','commerce_callback_confirm') THEN SELECT "orderId" INTO oid FROM atlas_customer."CommerceShippingPayment" WHERE id=(d->>'attemptId')::uuid;
 ELSE oid:=(d->>'orderId')::uuid; END IF;
 SELECT * INTO ord FROM atlas_customer."CommerceOrder" WHERE id=oid;
 IF ord.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 aid:=ord."accountId";
 IF action NOT IN ('commerce_callback_payment','commerce_callback_confirm') THEN
  auth:=d->'authority';checked:=atlas_customer.customer_call('intake_read',auth->'binding',(auth-'binding')||jsonb_build_object('id',ord."draftId"));
  IF checked ? 'error' THEN RETURN checked; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-intake:'||aid::text,0));
 SELECT * INTO ord FROM atlas_customer."CommerceOrder" WHERE id=oid FOR UPDATE;
 IF ord.receipt->'terms'->>'shippingPayment' IS DISTINCT FROM 'SEPARATE_PAYMENT' OR ord.receipt->>'channel'<>'MAIL_IN'
  OR NOT EXISTS(SELECT 1 FROM atlas_customer."CommercePayment" WHERE id=ord."paymentId" AND state='PAID') THEN RETURN atlas_customer.problem(409,'SHIPPING_PAYMENT_NOT_AVAILABLE'); END IF;
 source:=atlas_customer.commerce_shipping_source(oid);
 IF action='commerce_shipping_checkout' THEN RETURN source; END IF;
 IF action='commerce_shipping_save_quote' THEN
  quote:=d->'quote';n:=jsonb_array_length(source->'cards');
  IF EXISTS(SELECT 1 FROM atlas_customer."CommerceShippingPayment" WHERE "orderId"=oid AND state<>'CANCELED') THEN RETURN atlas_customer.problem(409,'SHIPPING_PAYMENT_ALREADY_STARTED'); END IF;
  IF NOT COALESCE(jsonb_typeof(quote)='object' AND quote->>'purpose'='SHIPPING' AND quote->>'orderId'=oid::text AND quote->>'channel'='MAIL_IN'
   AND quote->>'shippingStatus'='QUOTED_UNPAID' AND quote->>'draftId'=ord."draftId"::text AND quote->>'accountId'=aid::text
   AND quote->'draftRevision'=source->'draftRevision' AND quote->'profileRevision'=source->'profileRevision'
   AND quote->'profile'=source->'profile' AND quote->>'phone'=source->>'phone' AND quote->'location'='null'::jsonb
   AND quote->'cards'=ord.receipt->'cards' AND quote->'merchant'=ctl.merchant
   AND quote->>'currency'='usd' AND quote->'subtotalCents'='0'::jsonb AND quote->'terms'->>'shippingPayment'='SEPARATE_PAYMENT'
   AND quote->'terms'->>'paymentFlow'='CUSTOMER_PHONE' AND quote->>'contentHash'=atlas_customer.commerce_hash(quote-'contentHash'),false)
   THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['subtotalCents','shippingCents','taxCents','totalCents']) k WHERE jsonb_typeof(quote->k) IS DISTINCT FROM 'number' OR (quote->>k)::numeric<>trunc((quote->>k)::numeric)) THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
  shipping:=(quote->>'shippingCents')::integer;taxes:=(quote->>'taxCents')::integer;total:=(quote->>'totalCents')::integer;
  IF shipping<=0 OR taxes<0 OR total<>shipping+taxes OR quote->'tax'->>'providerId' IS NULL OR quote->'tax'->>'currency' IS DISTINCT FROM 'usd'
   OR (quote->'tax'->>'taxCents')::numeric IS DISTINCT FROM taxes::numeric OR (quote->'tax'->>'totalCents')::numeric IS DISTINCT FROM total::numeric
   OR quote->'tax'->>'requestHash' IS DISTINCT FROM atlas_customer.commerce_hash(jsonb_build_object('quoteId',quote->'id','currency','usd','profile',source->'profile','channel','MAIL_IN','location',NULL,'lines','[]'::jsonb,'subtotalCents',0,'shippingCents',shipping))
   OR (quote->>'expiresAt')::timestamptz<=clock_timestamp() OR (quote->>'expiresAt')::timestamptz>clock_timestamp()+interval '16 minutes'
   OR (quote->'tax'->>'expiresAt')::timestamptz<(quote->>'expiresAt')::timestamptz THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
   shipping_plan:=quote->'shippingPlan';
   IF NOT atlas_customer.commerce_shipping_plan_valid(shipping_plan,n,ctl.terms->>'mailChargedLegs')
    OR (SELECT count(*) FROM jsonb_array_elements(source->'shippingPlans') configured WHERE configured=shipping_plan)<>1
    OR (shipping_plan->>'version'='atlas-measured-shipping-plan-v1' AND (quote->>'expiresAt')::timestamptz>(shipping_plan->>'validUntil')::timestamptz) THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   IF shipping_plan->>'version' IN ('atlas-measured-print-return-plan-v2','atlas-measured-shipstation-plan-v1') AND (
    NOT COALESCE(quote->>'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false)
    OR to_char((quote->>'createdAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>quote->>'createdAt'
    OR (quote->>'createdAt')::timestamptz<clock_timestamp()-interval '15 minutes'
    OR (quote->>'createdAt')::timestamptz>clock_timestamp()+interval '1 minute'
    OR (quote->>'expiresAt')::timestamptz>(quote->>'createdAt')::timestamptz+interval '15 minutes'
   ) THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   customer_party:=jsonb_build_object('contact',jsonb_build_object('personName',source->'profile'->>'name','phoneNumber',source->>'phone'),
    'address',jsonb_build_object('streetLines',CASE WHEN COALESCE(source->'profile'->>'address2','')<>'' THEN jsonb_build_array(source->'profile'->>'address1',source->'profile'->>'address2') ELSE jsonb_build_array(source->'profile'->>'address1') END,
    'city',source->'profile'->>'city','stateOrProvinceCode',source->'profile'->>'region','postalCode',source->'profile'->>'postalCode','countryCode',source->'profile'->>'country'));
   FOR line IN SELECT value FROM jsonb_array_elements(quote->'shipping') LOOP
    shipment_request:=atlas_customer.commerce_shipping_request(shipping_plan,line->>'leg',(quote->>'createdAt')::timestamptz);
    IF shipping_plan->>'version'='atlas-measured-shipstation-plan-v1' THEN
     shipment_request:=jsonb_set(shipment_request,ARRAY['shipment',CASE WHEN line->>'leg'='INBOUND' THEN 'ship_from' ELSE 'ship_to' END],atlas_customer.commerce_shipstation_customer(source->'profile',source->>'phone'));
     IF shipping_plan->>'inboundPackaging'='CUSTOMER_MEASURED' THEN
      IF NOT atlas_customer.commerce_shipstation_package_valid(quote->'inboundPackage') THEN RETURN atlas_customer.problem(409,'MEASURED_PACKAGE_REQUIRED'); END IF;
      IF line->>'leg'='INBOUND' THEN shipment_request:=jsonb_set(shipment_request,'{shipment,packages}',jsonb_build_array(quote->'inboundPackage'||jsonb_build_object('package_code','package'))); END IF;
     ELSIF quote ? 'inboundPackage' THEN RETURN atlas_customer.problem(409,'UNEXPECTED_PACKAGE_MEASUREMENTS'); END IF;
     IF line->>'provider' IS DISTINCT FROM 'SHIPSTATION' OR NOT atlas_customer.commerce_shipstation_rate_valid(line->'rate',shipment_request)
      OR line->'rate'->>'providerId' IS DISTINCT FROM line->>'providerId' OR line->'rate'->'amountCents' IS DISTINCT FROM line->'amountCents'
      OR line->'rate'->>'carrierName' IS DISTINCT FROM line->>'carrierName' OR line->'rate'->>'serviceName' IS DISTINCT FROM line->>'serviceName'
      OR line->'rate'->>'expiresAt' IS DISTINCT FROM line->>'expiresAt' OR (line->>'expiresAt')::timestamptz<(quote->>'expiresAt')::timestamptz
      THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
    ELSE
     shipment_request:=CASE WHEN line->>'leg'='INBOUND' THEN jsonb_set(shipment_request,'{requestedShipment,shipper}',customer_party)
      ELSE jsonb_set(shipment_request,'{requestedShipment,recipients}',jsonb_build_array(customer_party)) END;
     IF line ? 'provider' AND line->>'provider'<>'FEDEX' THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
    END IF;
    IF line->'request' IS DISTINCT FROM shipment_request THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   END LOOP;
   IF ctl.terms->>'mailClockStart' IS DISTINCT FROM 'ATLAS_RECEIPT' OR COALESCE(ctl.terms->>'mailChargedLegs','') NOT IN ('INBOUND_ONLY','BOTH_LEGS')
    OR quote->'terms'->>'clockStart' IS DISTINCT FROM ctl.terms->>'mailClockStart' OR quote->'terms'->>'mailChargedLegs' IS DISTINCT FROM ctl.terms->>'mailChargedLegs'
    OR (quote->'terms'->>'days')::integer IS DISTINCT FROM 14 OR jsonb_array_length(quote->'shipping')<>(CASE WHEN ctl.terms->>'mailChargedLegs'='BOTH_LEGS' THEN 2 ELSE 1 END)
    OR shipping<>(SELECT sum((value->>'amountCents')::numeric) FROM jsonb_array_elements(quote->'shipping'))
    OR quote->'shipping'->0->>'leg' IS DISTINCT FROM 'INBOUND' OR (ctl.terms->>'mailChargedLegs'='BOTH_LEGS' AND quote->'shipping'->1->>'leg' IS DISTINCT FROM 'RETURN')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(quote->'shipping') rate WHERE rate->>'providerId' IS NULL OR rate->>'currency' IS DISTINCT FROM 'usd'
      OR (rate->>'amountCents')::numeric<0 OR (rate->>'amountCents')::numeric<>trunc((rate->>'amountCents')::numeric)
      OR rate->>'requestHash' IS DISTINCT FROM atlas_customer.commerce_hash(rate->'request')) THEN RETURN atlas_customer.problem(409,'MAIL_SHIPPING_TERMS_NOT_CONFIGURED'); END IF;

  INSERT INTO atlas_customer."CommerceShippingQuote"(id,"orderId","accountId","contentHash",snapshot,"expiresAt") VALUES((quote->>'id')::uuid,oid,aid,quote->>'contentHash',quote,(quote->>'expiresAt')::timestamptz) ON CONFLICT DO NOTHING;
  SELECT * INTO q FROM atlas_customer."CommerceShippingQuote" WHERE id=(quote->>'id')::uuid;
  IF q.snapshot IS DISTINCT FROM quote THEN RETURN atlas_customer.problem(409,'QUOTE_CONFLICT'); END IF;
  RETURN q.snapshot;
 END IF;
 IF action='commerce_shipping_reserve_payment' THEN
  SELECT * INTO p FROM atlas_customer."CommerceShippingPayment" WHERE "accountId"=aid AND "requestId"=(d->>'requestId')::uuid;
  IF p.id IS NOT NULL THEN
   IF p."orderId"<>oid OR p."quoteId"<>(d->>'quoteId')::uuid THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
   RETURN jsonb_build_object('attempt',atlas_customer.commerce_shipping_payment_projection(p.id),'dispatch',false);
  END IF;
  SELECT * INTO p FROM atlas_customer."CommerceShippingPayment" WHERE "orderId"=oid AND state<>'CANCELED';
  IF p.id IS NOT NULL THEN RETURN jsonb_build_object('attempt',atlas_customer.commerce_shipping_payment_projection(p.id),'dispatch',false); END IF;
  SELECT * INTO q FROM atlas_customer."CommerceShippingQuote" WHERE id=(d->>'quoteId')::uuid;
  IF q.id IS NULL OR q."orderId"<>oid OR q."accountId"<>aid OR q."expiresAt"<=clock_timestamp() OR q.snapshot->'merchant' IS DISTINCT FROM ctl.merchant OR d->'merchant' IS DISTINCT FROM ctl.merchant THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_EXPIRED'); END IF;
  INSERT INTO atlas_customer."CommerceShippingPayment"(id,"orderId","accountId","quoteId","requestId",merchant,state) VALUES((d->>'attemptId')::uuid,oid,aid,q.id,(d->>'requestId')::uuid,ctl.merchant,'DISPATCHED') RETURNING * INTO p;
  RETURN jsonb_build_object('attempt',atlas_customer.commerce_shipping_payment_projection(p.id),'dispatch',true);
 END IF;
 SELECT * INTO p FROM atlas_customer."CommerceShippingPayment" WHERE id=(d->>'attemptId')::uuid AND "orderId"=oid FOR UPDATE;
 IF p.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF p.merchant IS DISTINCT FROM ctl.merchant THEN RETURN atlas_customer.problem(409,'PAYMENT_MERCHANT_MISMATCH'); END IF;
 SELECT * INTO q FROM atlas_customer."CommerceShippingQuote" WHERE id=p."quoteId";
 IF action IN ('commerce_shipping_payment','commerce_callback_payment') THEN RETURN atlas_customer.commerce_shipping_payment_projection(p.id); END IF;
 IF action='commerce_shipping_record_payment' THEN
  observation:=d->'observation';
  IF COALESCE(observation->>'state','') NOT IN ('UNKNOWN','AWAITING_PAYMENT','PROCESSING','CANCELED') THEN RETURN atlas_customer.problem(400,'INVALID_PAYMENT_STATE'); END IF;
  IF p.state IN ('PAID','CANCELED') THEN RETURN atlas_customer.commerce_shipping_payment_projection(p.id); END IF;
  IF p."providerId" IS NOT NULL AND observation->>'providerId' IS NOT NULL AND p."providerId"<>observation->>'providerId' THEN RETURN atlas_customer.problem(409,'PAYMENT_ID_MISMATCH'); END IF;
  IF observation->>'state'='CANCELED' AND NOT COALESCE(observation->>'source'='PROVIDER_RETRIEVAL' AND observation->>'status'='canceled' AND observation->>'attemptId'=p.id::text AND observation->>'quoteHash'=q."contentHash"
   AND observation->>'provider'='STRIPE' AND observation->>'merchantId'=p.merchant->>'accountId' AND observation->'livemode'=p.merchant->'livemode' AND observation->'amountCents'=q.snapshot->'totalCents' AND observation->>'currency'='usd' AND length(observation->>'providerId')>0,false) THEN RETURN atlas_customer.problem(409,'PAYMENT_NOT_CONFIRMED'); END IF;
  UPDATE atlas_customer."CommerceShippingPayment" SET state=shipping_call.observation->>'state',"providerId"=COALESCE("providerId",shipping_call.observation->>'providerId'),observation=COALESCE(p.observation,'{}'::jsonb)||shipping_call.observation,"updatedAt"=clock_timestamp() WHERE id=p.id;
  RETURN atlas_customer.commerce_shipping_payment_projection(p.id);
 END IF;
 IF action IN ('commerce_shipping_confirm_paid','commerce_callback_confirm') THEN
  evidence:=d->'evidence';
  IF NOT COALESCE(evidence->>'source'='PROVIDER_RETRIEVAL' AND evidence->>'status'='succeeded' AND evidence->>'provider'=p.merchant->>'provider'
   AND evidence->>'merchantId'=p.merchant->>'accountId' AND evidence->'livemode'=p.merchant->'livemode' AND evidence->>'attemptId'=p.id::text
   AND evidence->>'quoteHash'=q."contentHash" AND evidence->'amountCents'=q.snapshot->'totalCents' AND evidence->'receivedCents'=q.snapshot->'totalCents'
   AND evidence->>'currency'='usd' AND length(evidence->>'providerId')>0 AND (p."providerId" IS NULL OR p."providerId"=evidence->>'providerId') AND evidence->'paymentMethodTypes' ? 'card',false)
   THEN RETURN atlas_customer.problem(409,'PAYMENT_BINDING_MISMATCH'); END IF;
  SELECT * INTO paid FROM atlas_customer."CommerceShippingReceipt" WHERE "orderId"=oid;
  IF paid.id IS NOT NULL THEN RETURN jsonb_build_object('order',atlas_customer.commerce_call('commerce_order',aid,jsonb_build_object('orderId',oid))); END IF;
  UPDATE atlas_customer."CommerceShippingPayment" SET state='PAID',"providerId"=evidence->>'providerId',observation=evidence-'clientSecret',"updatedAt"=clock_timestamp() WHERE id=p.id;
  INSERT INTO atlas_customer."CommerceShippingReceipt"(id,"orderId","paymentId","quoteId",receipt) VALUES((d->>'receiptId')::uuid,oid,p.id,q.id,(q.snapshot-ARRAY['merchant','phone'])||jsonb_build_object('shippingStatus','PAID','payment',evidence-'clientSecret')) RETURNING * INTO paid;
  INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES
   (oid||':shipping-email:v1',oid,'EMAIL_SHIPPING_RECEIPT',jsonb_build_object('orderId',oid,'reference',ord.reference,'to',q.snapshot->'profile'->>'email','currency','usd','totalCents',q.snapshot->'totalCents','quoteHash',q."contentHash")),
   (oid||':shipping-tax:v1',oid,'TAX_TRANSACTION',jsonb_build_object('orderId',paid.id,'calculationId',q.snapshot->'tax'->>'providerId'));
  FOR line IN SELECT value FROM jsonb_array_elements(q.snapshot->'shipping') LOOP
   INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES(oid||CASE WHEN line->>'provider'='SHIPSTATION' THEN ':shipstation:' ELSE ':fedex:' END||(line->>'leg')||':v1',oid,
    CASE WHEN line->>'provider'='SHIPSTATION' THEN 'SHIPSTATION_LABEL' ELSE 'FEDEX_LABEL' END,
    jsonb_build_object('orderId',oid,'shipment',line->'request','leg',line->>'leg','rateId',line->>'providerId')||CASE WHEN line->>'provider'='SHIPSTATION' THEN jsonb_build_object('rate',line->'rate') ELSE '{}'::jsonb END);
  END LOOP;
  RETURN jsonb_build_object('order',atlas_customer.commerce_call('commerce_order',aid,jsonb_build_object('orderId',oid)));
 END IF;
 RETURN atlas_customer.problem(404,'NOT_FOUND');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR not_null_violation OR check_violation THEN RETURN atlas_customer.problem(400,'INVALID_COMMERCE_REQUEST');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_payment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','providerId','observation','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','providerId','observation','updatedAt'])
 OR (OLD."providerId" IS NOT NULL AND NEW."providerId" IS DISTINCT FROM OLD."providerId")
 OR (OLD.state IN ('PAID','CANCELED') AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'ATLAS shipping payment identity is immutable'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_payment_projection(pid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT to_jsonb(p)||jsonb_build_object('quote',q.snapshot,'order',CASE WHEN p.state='PAID' THEN atlas_customer.commerce_call('commerce_order',p."accountId",jsonb_build_object('orderId',p."orderId")) ELSE NULL END)
 FROM atlas_customer."CommerceShippingPayment" p JOIN atlas_customer."CommerceShippingQuote" q ON q.id=p."quoteId" WHERE p.id=pid
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_plan_valid(plan jsonb, n integer, charged_legs text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE leg text; request jsonb; shipment jsonb; starts timestamptz; package jsonb;
BEGIN
 IF plan->>'version' IS DISTINCT FROM 'atlas-measured-shipstation-plan-v1' THEN RETURN atlas_customer.commerce_fedex_shipping_plan_valid(plan,n,charged_legs); END IF;
 IF NOT COALESCE(plan->>'provider'='SHIPSTATION' AND plan->>'fulfillmentPolicy'='INBOUND_AFTER_PAYMENT_RETURN_WHEN_PREPARED'
  AND plan->>'inboundPackaging' IN ('CUSTOMER_MEASURED','CONFIGURED')
  AND jsonb_typeof(plan->'cardCount')='number' AND (plan->>'cardCount')::numeric=n AND n BETWEEN 1 AND 100
  AND plan->>'packingPresetId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' AND plan->>'shippingServiceCode' ~ '^[A-Z][A-Z0-9_]{0,79}$'
  AND plan->>'carrierId' ~ '^se(-[a-z0-9]+)+$' AND plan->>'serviceCode' ~ '^[a-z0-9]+(_[a-z0-9-]+)*$'
  AND length(btrim(plan->>'measurementReference')) BETWEEN 1 AND 240 AND plan->>'measurementReference' !~ '[[:cntrl:]]'
  AND plan->>'validFrom' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  AND NOT plan ? 'validUntil' AND charged_legs IN ('INBOUND_ONLY','BOTH_LEGS'),false) THEN RETURN false; END IF;
 starts:=(plan->>'validFrom')::timestamptz;
 IF starts>statement_timestamp() OR to_char(starts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>plan->>'validFrom' THEN RETURN false; END IF;
 FOREACH leg IN ARRAY (CASE WHEN charged_legs='BOTH_LEGS' THEN ARRAY['INBOUND','RETURN'] ELSE ARRAY['INBOUND'] END) LOOP
  request:=plan->'legs'->leg; shipment:=request->'shipment';
  IF NOT COALESCE(request-ARRAY['provider','shipDateTimeZone','labelDatePolicy','shipment']='{}'::jsonb
   AND request->>'provider'='SHIPSTATION' AND request->>'labelDatePolicy'='SHIPSTATION_FULFILLMENT_DATE_V1'
   AND request->>'shipDateTimeZone' ~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+$'
   AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=request->>'shipDateTimeZone')
   AND shipment-ARRAY['carrier_id','service_code','ship_from','ship_to','packages','confirmation','insurance_provider']='{}'::jsonb
   AND NOT shipment ? (CASE WHEN leg='INBOUND' THEN 'ship_from' ELSE 'ship_to' END)
   AND shipment->>'carrier_id'=plan->>'carrierId' AND shipment->>'service_code'=plan->>'serviceCode'
   AND shipment->>'insurance_provider'='none' AND shipment->>'confirmation' IN ('none','delivery','signature','adult_signature','direct_signature')
   AND atlas_customer.commerce_shipstation_party_valid(shipment->(CASE WHEN leg='INBOUND' THEN 'ship_to' ELSE 'ship_from' END)),false) THEN RETURN false; END IF;
  IF leg='INBOUND' AND plan->>'inboundPackaging'='CUSTOMER_MEASURED' THEN
   IF shipment ? 'packages' THEN RETURN false; END IF;
  ELSE
   IF NOT COALESCE(jsonb_array_length(shipment->'packages')=1,false) THEN RETURN false; END IF;
   package:=shipment->'packages'->0;
   IF package->>'package_code' IS DISTINCT FROM 'package' OR NOT atlas_customer.commerce_shipstation_package_valid(package-'package_code') THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_public_state(oid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN o.receipt->'terms'->>'shippingPayment' IS DISTINCT FROM 'SEPARATE_PAYMENT' THEN NULL ELSE
 jsonb_build_object('state',CASE WHEN p.state='PAID' THEN 'PAID' WHEN p.state='DISPATCHED' THEN 'PROCESSING' ELSE COALESCE(p.state,'UNQUOTED_UNPAID') END,
 'labelReadyEmailEnabled',true,
 'activePayment',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('attemptId',p.id,'state',p.state,'channel','MAIL_IN','paymentFlow','CUSTOMER_PHONE') ELSE NULL END,
 'receipt',CASE WHEN r.id IS NOT NULL THEN atlas_customer.commerce_public_quote(r.receipt) ELSE NULL END) END
 FROM atlas_customer."CommerceOrder" o LEFT JOIN atlas_customer."CommerceShippingPayment" p ON p."orderId"=o.id AND p.state<>'CANCELED'
 LEFT JOIN atlas_customer."CommerceShippingReceipt" r ON r."orderId"=o.id WHERE o.id=oid
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_request(plan jsonb, leg text, quoted_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN plan->>'version'='atlas-measured-shipstation-plan-v1'
  THEN jsonb_set(plan->'legs'->leg,'{shipment,ship_date}',to_jsonb(to_char(quoted_at AT TIME ZONE (plan->'legs'->leg->>'shipDateTimeZone'),'YYYY-MM-DD')))
 WHEN plan->>'version'='atlas-measured-print-return-plan-v2'
  THEN jsonb_set(plan->'legs'->leg,'{requestedShipment,shipDatestamp}',to_jsonb(to_char(quoted_at AT TIME ZONE (plan->'legs'->leg->>'shipDateTimeZone'),'YYYY-MM-DD')))
 ELSE plan->'legs'->leg END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_source(oid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT q.snapshot||jsonb_build_object('revision',q."draftRevision",'cards',(SELECT jsonb_agg((line-'cardId')||jsonb_build_object('id',line->'cardId') ORDER BY ord) FROM jsonb_array_elements(q.snapshot->'cards') WITH ORDINALITY e(line,ord)),
 'shippingPlans',COALESCE((SELECT jsonb_agg(plan) FROM atlas_customer."CommerceControl" c CROSS JOIN LATERAL jsonb_array_elements(c."shippingPlans") plan WHERE c.id='active' AND atlas_customer.commerce_shipping_plan_valid(plan,jsonb_array_length(q.snapshot->'cards'),c.terms->>'mailChargedLegs')),'[]'::jsonb),
 'activePayment',(SELECT atlas_customer.commerce_shipping_payment_projection(id) FROM atlas_customer."CommerceShippingPayment" WHERE "orderId"=o.id AND state<>'CANCELED'),
 'order',atlas_customer.commerce_call('commerce_order',o."accountId",jsonb_build_object('orderId',o.id)))
 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommerceQuote" q ON q.id=o."quoteId" WHERE o.id=oid
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipstation_customer(profile jsonb, phone text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('name',profile->>'name','phone',phone,'address_line1',profile->>'address1','city_locality',profile->>'city',
 'state_province',profile->>'region','postal_code',profile->>'postalCode','country_code',profile->>'country','address_residential_indicator','unknown')
 ||CASE WHEN COALESCE(profile->>'address2','')<>'' THEN jsonb_build_object('address_line2',profile->>'address2') ELSE '{}'::jsonb END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipstation_package_valid(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE k text; pounds numeric; sizes numeric[];
BEGIN
 IF NOT COALESCE(jsonb_typeof(p)='object' AND p-ARRAY['weight','dimensions']='{}'::jsonb
  AND (p->'weight')-ARRAY['unit','value']='{}'::jsonb AND p->'weight'->>'unit' IN ('pound','ounce','gram','kilogram')
  AND jsonb_typeof(p->'weight'->'value')='number' AND (p->'weight'->>'value')::numeric>0
  AND (p->'dimensions')-ARRAY['unit','length','width','height']='{}'::jsonb AND p->'dimensions'->>'unit' IN ('inch','centimeter'),false) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['length','width','height'] LOOP
  IF NOT COALESCE(jsonb_typeof(p->'dimensions'->k)='number' AND (p->'dimensions'->>k)::numeric>0,false) THEN RETURN false; END IF;
 END LOOP;
 pounds:=(p->'weight'->>'value')::numeric*CASE p->'weight'->>'unit' WHEN 'pound' THEN 1 WHEN 'ounce' THEN 1::numeric/16 WHEN 'gram' THEN 1::numeric/453.59237 ELSE 1000::numeric/453.59237 END;
 SELECT array_agg(v ORDER BY v DESC) INTO sizes FROM (SELECT (p->'dimensions'->>item.dimension_key)::numeric/CASE WHEN p->'dimensions'->>'unit'='inch' THEN 1 ELSE 2.54 END v FROM unnest(ARRAY['length','width','height']) AS item(dimension_key)) d;
 RETURN pounds<=150 AND sizes[1]<=108 AND sizes[1]+2*(sizes[2]+sizes[3])<=165;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipstation_party_valid(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE k text;
BEGIN
 IF NOT COALESCE(jsonb_typeof(p)='object' AND p-ARRAY['name','phone','address_line1','address_line2','city_locality','state_province','postal_code','country_code','address_residential_indicator']='{}'::jsonb
  AND p->>'country_code'='US' AND p->>'address_residential_indicator' IN ('unknown','yes','no'),false) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['name','phone','address_line1','city_locality','state_province','postal_code'] LOOP
  IF NOT COALESCE(jsonb_typeof(p->k)='string' AND length(btrim(p->>k)) BETWEEN 1 AND 100 AND p->>k !~ '[[:cntrl:]]',false) THEN RETURN false; END IF;
 END LOOP;
 IF p ? 'address_line2' AND NOT COALESCE(jsonb_typeof(p->'address_line2')='string' AND length(btrim(p->>'address_line2')) BETWEEN 1 AND 100 AND p->>'address_line2' !~ '[[:cntrl:]]',false) THEN RETURN false; END IF;
 RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipstation_rate_valid(rate jsonb, shipment jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 RETURN COALESCE(rate->>'provider'='SHIPSTATION' AND rate->>'providerId' ~ '^se(-[a-z0-9]+)+$'
  AND rate->>'shipmentId' ~ '^se(-[a-z0-9]+)+$' AND rate->>'carrierId'=shipment->'shipment'->>'carrier_id'
  AND rate->>'serviceCode'=shipment->'shipment'->>'service_code' AND rate->>'currency'='usd'
  AND jsonb_typeof(rate->'amountCents')='number' AND (rate->>'amountCents')::numeric>=0
  AND (rate->>'amountCents')::numeric=trunc((rate->>'amountCents')::numeric)
  AND (rate->>'amountCents')::numeric<=9007199254740991
  AND rate->>'requestHash'=atlas_customer.commerce_hash(shipment)
  AND length(btrim(rate->>'carrierName')) BETWEEN 1 AND 100 AND rate->>'carrierName' !~ '[[:cntrl:]]'
  AND length(btrim(rate->>'serviceName')) BETWEEN 1 AND 100 AND rate->>'serviceName' !~ '[[:cntrl:]]'
  AND rate->>'expiresAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_source(did uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT jsonb_build_object('draftId',d.id,'revision',d.revision,'accountId',d."accountId",'profile',d."profileSnapshot",'profileRevision',d.revision,'phone',a.phone,'emailVerified',atlas_customer.email_verified(a.id,d."profileSnapshot"->>'email'),
 'channel',CASE WHEN d."intakeMethod"='MAIL_IN' THEN 'MAIL_IN' ELSE 'KIOSK' END,'location',CASE WHEN d."kioskId" IS NOT NULL THEN atlas_customer.intake_location(d."kioskId") ELSE NULL END,
 'terms',(SELECT terms FROM atlas_customer."CommerceControl" WHERE id='active'),
 'activePayment',(SELECT atlas_customer.commerce_payment_projection(p.id) FROM atlas_customer."CommercePayment" p WHERE p."draftId"=d.id AND p.state<>'CANCELED'),
 'shippingPlans',COALESCE((SELECT jsonb_agg(plan) FROM atlas_customer."CommerceControl" ctl CROSS JOIN LATERAL jsonb_array_elements(ctl."shippingPlans") plan
 WHERE ctl.id='active' AND atlas_customer.commerce_shipping_plan_valid(plan,(SELECT count(*)::integer FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),ctl.terms->>'mailChargedLegs')),'[]'::jsonb),
 'cards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'identity',c.identity,'photoPairHash',atlas_customer.commerce_hash(
 (SELECT jsonb_agg(jsonb_build_object('side',u.side,'plan',u.plan,'verification',u.verification) ORDER BY u.side) FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=c.id))) ORDER BY c."createdAt",c.id)
 FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),'[]'::jsonb))
 FROM atlas_customer."CustomerIntakeDraft" d JOIN atlas_customer."CustomerAccount" a ON a.id=d."accountId" WHERE d.id=did
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_verified_email_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE email text;
BEGIN
 IF TG_TABLE_NAME='CommerceQuote' THEN email:=NEW.snapshot->'profile'->>'email';
 ELSE SELECT snapshot->'profile'->>'email' INTO email FROM atlas_customer."CommerceQuote" WHERE id=NEW."quoteId"; END IF;
 IF NOT atlas_customer.email_verified(NEW."accountId",email) THEN RAISE EXCEPTION 'ATLAS verified receipt email required'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.control_revision_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'CUSTOMER_CONTROL_REVISION_REQUIRED'; END IF;
  NEW."updatedAt":=clock_timestamp();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.current_account(sh text, bh text, rev integer)
 RETURNS atlas_customer."CustomerAccount"
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT a.* FROM atlas_customer."CustomerSession" s
 JOIN atlas_customer."CustomerBrowser" b ON b."tokenHash"=s."browserHash"
 JOIN atlas_customer."CustomerAccount" a ON a.id=s."accountId"
 WHERE s."tokenHash"=sh AND s."browserHash"=bh AND s."revokedAt" IS NULL AND a."revokedAt" IS NULL
   AND s."accessVersion"=a."accessVersion" AND s."controlRevision"=rev AND b."controlRevision"=rev
   AND s."createdAt"<=clock_timestamp() AND s."expiresAt">clock_timestamp() AND b."expiresAt">clock_timestamp()
 FOR SHARE OF a,s,b
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.customer_call(action text, b jsonb, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE ctl atlas_customer."CustomerControl"; a atlas_customer."CustomerAccount"; v atlas_customer."CustomerEmailVerification";
 draft atlas_customer."CustomerIntakeDraft"; same_browser boolean;
BEGIN
 IF action NOT IN ('email_status','email_confirm') THEN RETURN atlas_customer.customer_call_before_email_verification(action,b,d); END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash') IS DISTINCT FROM
  (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>4096 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',d->>'browserHash',ctl.revision);
 IF action='email_status' THEN
  IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  IF d-ARRAY['draftId','sessionHash','browserHash']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  RETURN atlas_customer.email_verification_status(a.id,(d->>'draftId')::uuid);
 END IF;
 IF d-ARRAY['tokenHash','mode','clientHash','sessionHash','browserHash']<>'{}'::jsonb OR COALESCE(d->>'tokenHash','') !~ '^[a-f0-9]{64}$'
  OR COALESCE(d->>'clientHash','') !~ '^[a-f0-9]{64}$' OR COALESCE(d->>'mode','') NOT IN ('AUTO','CONFIRM')
  OR NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerBrowser" WHERE "tokenHash"=d->>'browserHash' AND "expiresAt">clock_timestamp() AND "controlRevision"=ctl.revision)
  THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF NOT atlas_customer.take_rate('email-confirm-client:'||(d->>'clientHash'),30) THEN RETURN atlas_customer.problem(429,'EMAIL_VERIFICATION_WAIT'); END IF;
 SELECT * INTO v FROM atlas_customer."CustomerEmailVerification" WHERE "tokenHash"=d->>'tokenHash' FOR UPDATE;
 same_browser:=v.id IS NOT NULL AND a.id IS NOT NULL AND a.id=v."accountId" AND d->>'browserHash'=v."browserHash";
 -- A scanner's bearer token alone can never take the automatic path.
 IF d->>'mode'='AUTO' AND NOT COALESCE(same_browser,false) THEN RETURN jsonb_build_object('verified',false,'requiresConfirmation',true); END IF;
 IF v.id IS NULL OR v.state='SUPERSEDED' OR (v.state<>'VERIFIED' AND v."expiresAt"<=clock_timestamp())
  OR NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=v."accountId" AND "revokedAt" IS NULL) THEN
  RETURN atlas_customer.problem(400,'EMAIL_LINK_INVALID'); END IF;
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=v."draftId";
 IF atlas_customer.canonical_email(draft."profileSnapshot"->>'email') IS DISTINCT FROM v.email THEN RETURN atlas_customer.problem(409,'EMAIL_LINK_CHANGED'); END IF;
 IF v.state<>'VERIFIED' THEN
  INSERT INTO atlas_customer."CustomerVerifiedEmail"("accountId",email) VALUES(v."accountId",v.email) ON CONFLICT DO NOTHING;
  UPDATE atlas_customer."CustomerEmailVerification" SET state='VERIFIED',"consumedAt"=clock_timestamp() WHERE id=v.id;
 END IF;
 -- Idempotent consumed-token replay adds no proof and returns no account data.
 RETURN jsonb_build_object('verified',true)||CASE WHEN same_browser THEN jsonb_build_object('resumeDraftId',v."draftId") ELSE '{}'::jsonb END;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.customer_call_before_email_verification(action text, b jsonb, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE ctl atlas_customer."CustomerControl"; a atlas_customer."CustomerAccount"; p jsonb; saved jsonb;
BEGIN
 IF action<>'profile' THEN RETURN atlas_customer.customer_call_before_shop_profile(action,b,d); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-access-v1',0));
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR jsonb_typeof(b) IS DISTINCT FROM 'object' OR
  (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash') IS DISTINCT FROM
  (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>65536
  OR d-ARRAY['profile','sessionHash','browserHash']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',d->>'browserHash',ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 p:=d->'profile';
 IF atlas_customer.valid_contact_profile(p) THEN
  SELECT profile INTO saved FROM atlas_customer."CustomerAccount" WHERE id=a.id FOR UPDATE;
  saved:=COALESCE(saved,'{}'::jsonb)||p;
  -- Explicitly clearing email removes it. An omitted email preserves it.
  IF p ? 'email' AND p->>'email'='' THEN saved:=saved-'email'; END IF;
 ELSIF atlas_customer.valid_profile(p) THEN saved:=p;
 ELSE RETURN atlas_customer.problem(400,'CONTACT_DETAILS_REQUIRED'); END IF;
 UPDATE atlas_customer."CustomerAccount" SET profile=saved WHERE id=a.id RETURNING * INTO a;
 RETURN jsonb_build_object('customer',atlas_customer.account_projection(a));
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.customer_call_before_progress(action text, binding jsonb, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE ctl atlas_customer."CustomerControl"; account atlas_customer."CustomerAccount";
BEGIN
 IF action NOT IN ('intake_list','intake_create','intake_read','intake_card','intake_correct','intake_review','intake_upload','commerce_checkout','commerce_order','commerce_label','dealer_locations','dealer_orders','dealer_memberships','dealer_enter','dealer_read','dealer_logout','dealer_tracking','dealer_deposit','dealer_handoff_issue','dealer_handoff_read','dealer_handoff_confirm') THEN
  RETURN atlas_customer.customer_call_v1(action,binding,d);
 END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR jsonb_typeof(binding) IS DISTINCT FROM 'object' OR
  (binding->>'mode',binding->>'origin',binding->>'deploymentId',binding->>'releaseSha',binding->>'configHash')
  IS DISTINCT FROM (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN
  RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>65536 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF action IN ('dealer_handoff_read','dealer_handoff_confirm') THEN
  RETURN atlas_dealer.handoff_dealer_call(action,ctl.revision,d-'sessionHash'); END IF;
 IF action IN ('dealer_locations','dealer_read','dealer_logout') THEN
  RETURN atlas_dealer.with_shop_receipts(atlas_dealer.customer_call(action,NULL,ctl.revision,d- 'sessionHash')); END IF;
 SELECT * INTO account FROM atlas_customer.current_account(d->>'sessionHash',d->>'browserHash',ctl.revision);
 IF account.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF action='dealer_handoff_issue' THEN RETURN atlas_dealer.issue_handoff(account.id,d-ARRAY['sessionHash','browserHash']); END IF;
 IF action IN ('dealer_orders','dealer_memberships','dealer_enter','dealer_tracking','dealer_deposit') THEN
  RETURN atlas_dealer.with_shop_receipts(atlas_dealer.customer_call(action,account.id,ctl.revision,d- 'sessionHash')); END IF;
 IF action IN ('commerce_checkout','commerce_order','commerce_label') THEN
  RETURN atlas_customer.commerce_call(action,account.id,d-ARRAY['sessionHash','browserHash']); END IF;
 RETURN atlas_customer.intake_call(action,account.id,d-ARRAY['sessionHash','browserHash']);
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.customer_call_before_shop_profile(action text, b jsonb, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE ctl atlas_customer."CustomerControl"; a atlas_customer."CustomerAccount";
BEGIN
 IF action NOT IN ('progress_preferences','progress_preferences_save') THEN RETURN atlas_customer.customer_call_before_progress(action,b,d); END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash') IS DISTINCT FROM
 (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>4096 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',d->>'browserHash',ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 RETURN atlas_customer.progress_preference_call(action,a.id,d-ARRAY['sessionHash','browserHash']);
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.customer_call_v1(action text, binding jsonb, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE ctl atlas_customer."CustomerControl"; b atlas_customer."CustomerBrowser"; c atlas_customer."CustomerChallenge";
 prior atlas_customer."CustomerChallenge"; a atlas_customer."CustomerAccount"; 
 t timestamptz:=clock_timestamp(); result jsonb; payload jsonb; input_hash text; card jsonb; sid uuid; cursor_row record;
 rows_json jsonb:='[]'::jsonb; next_cursor uuid; row_item record; count_rows integer:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-access-v1',0));
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 t:=clock_timestamp();
 IF ctl.enabled IS DISTINCT FROM true OR jsonb_typeof(binding)<>'object' OR
   (binding->>'mode',binding->>'origin',binding->>'deploymentId',binding->>'releaseSha',binding->>'configHash')
   IS DISTINCT FROM (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN
   RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>65536 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF action='bootstrap' THEN
   SELECT * INTO b FROM atlas_customer."CustomerBrowser" WHERE "tokenHash"=d->>'browserHash' AND "expiresAt">t AND "controlRevision"=ctl.revision;
   IF b."tokenHash" IS NULL THEN
     IF NOT atlas_customer.take_rate('browser-global',180) OR NOT atlas_customer.take_rate('browser-client:'||(d->>'clientHash'),30) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
     INSERT INTO atlas_customer."CustomerBrowser"("tokenHash","controlRevision","createdAt","expiresAt") VALUES (d->>'newBrowserHash',ctl.revision,t,t+interval '7 days') RETURNING * INTO b;
   END IF;
   SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',b."tokenHash",ctl.revision);
   RETURN jsonb_build_object('browserHash',b."tokenHash",'customer',atlas_customer.account_projection(a));
 END IF;
 SELECT * INTO b FROM atlas_customer."CustomerBrowser" WHERE "tokenHash"=d->>'browserHash' AND "expiresAt">t AND "controlRevision"=ctl.revision;
 IF b."tokenHash" IS NULL THEN RETURN atlas_customer.problem(403,'SIGN_IN_SESSION_EXPIRED'); END IF;
 IF action='send_claim' THEN
   IF (d->>'phone') !~ '^\+[1-9][0-9]{7,14}$' OR (d->>'phoneHash') !~ '^[a-f0-9]{64}$' THEN RETURN atlas_customer.problem(400,'USE_INTERNATIONAL_PHONE'); END IF;
   SELECT * INTO c FROM atlas_customer."CustomerChallenge" WHERE "browserHash"=b."tokenHash" AND "requestId"=(d->>'requestId')::uuid;
   IF c.id IS NOT NULL THEN
     IF c.phone IS DISTINCT FROM d->>'phone' THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
     IF c.state<>'PENDING' OR c."expiresAt"<=t OR c."controlRevision"<>ctl.revision THEN RETURN atlas_customer.problem(409,'SIGN_IN_RESTART_REQUIRED'); END IF;
     RETURN jsonb_build_object('existing',true,'challengeId',c.id,'expiresAt',c."expiresAt");
   END IF;
   IF NOT atlas_customer.take_rate('send-global',60) OR NOT atlas_customer.take_rate('send-client:'||(d->>'clientHash'),12) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
   SELECT * INTO prior FROM atlas_customer."CustomerChallenge" WHERE phone=d->>'phone' AND state IN ('SENDING','PENDING','CHECKING','UNKNOWN') ORDER BY "createdAt" DESC,id DESC LIMIT 1;
   IF prior.id IS NOT NULL THEN
     IF prior.state IN ('SENDING','CHECKING','UNKNOWN') AND prior."quarantineUntil">t THEN RETURN atlas_customer.problem(409,'SIGN_IN_RESTART_REQUIRED'); END IF;
     IF prior."createdAt"+interval '1 minute'>t THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
   END IF;
   IF NOT atlas_customer.take_rate('send-phone:'||(d->>'phoneHash'),4) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
   UPDATE atlas_customer."CustomerChallenge" SET state='SUPERSEDED' WHERE phone=d->>'phone' AND state IN ('SENDING','PENDING','CHECKING','UNKNOWN');
   INSERT INTO atlas_customer."CustomerChallenge"(id,"browserHash","requestId","phoneHash",phone,"controlRevision","accountSid","serviceSid",state,"sendClaimId","createdAt","expiresAt","quarantineUntil")
     VALUES (d->>'challengeId',b."tokenHash",(d->>'requestId')::uuid,d->>'phoneHash',d->>'phone',ctl.revision,d->>'accountSid',d->>'serviceSid','SENDING',(d->>'claimId')::uuid,t,t+interval '5 minutes',t+interval '11 minutes') RETURNING * INTO c;
   RETURN jsonb_build_object('existing',false,'challengeId',c.id,'expiresAt',c."expiresAt");
 ELSIF action IN ('send_finish','check_claim','check_finish') THEN
   SELECT * INTO c FROM atlas_customer."CustomerChallenge" WHERE id=d->>'challengeId' AND "browserHash"=b."tokenHash" FOR UPDATE;
   IF c.id IS NULL OR c."controlRevision"<>ctl.revision OR c."expiresAt"<=t THEN RETURN atlas_customer.problem(400,'CODE_NOT_ACCEPTED'); END IF;
   IF action='check_claim' THEN
     IF NOT atlas_customer.take_rate('check-global',180) OR NOT atlas_customer.take_rate('check-client:'||(d->>'clientHash'),30) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
     IF c.state='CONSUMED' THEN
       SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',b."tokenHash",ctl.revision);
       IF a.id IS NULL OR c."replayUntil"<=t OR c."replayHash" IS DISTINCT FROM d->>'replayHash'
         OR NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerSession" s WHERE s."tokenHash"=d->>'sessionHash' AND s."challengeId"=c.id) THEN RETURN atlas_customer.problem(400,'CODE_NOT_ACCEPTED'); END IF;
       RETURN jsonb_build_object('existing',true,'customer',atlas_customer.account_projection(a));
     END IF;
     IF c.state<>'PENDING' OR c.attempts>=5 THEN RETURN atlas_customer.problem(400,'CODE_NOT_ACCEPTED'); END IF;
     IF NOT atlas_customer.take_rate('check-phone:'||c."phoneHash",20) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
     UPDATE atlas_customer."CustomerChallenge" SET state='CHECKING',"checkClaimId"=(d->>'claimId')::uuid,attempts=attempts+1 WHERE id=c.id;
     RETURN jsonb_build_object('existing',false,'verificationSid',c."verificationSid");
   END IF;
   IF (action='send_finish' AND (c.state<>'SENDING' OR c."sendClaimId" IS DISTINCT FROM (d->>'claimId')::uuid))
     OR (action='check_finish' AND (c.state<>'CHECKING' OR c."checkClaimId" IS DISTINCT FROM (d->>'claimId')::uuid)) THEN RETURN atlas_customer.problem(409,'SIGN_IN_RESTART_REQUIRED'); END IF;
   result:=d->'result';
   IF jsonb_typeof(result) IS DISTINCT FROM 'object' OR (result->>'accountSid',result->>'serviceSid',result->>'phone',result->>'channel') IS DISTINCT FROM (c."accountSid",c."serviceSid",c.phone,'sms')
     OR (result->>'verificationSid') IS NULL OR (result->>'verificationSid') !~ '^VE[0-9a-fA-F]{32}$'
     OR (action='check_finish' AND c."verificationSid" IS DISTINCT FROM result->>'verificationSid')
     OR COALESCE(result->>'status','') NOT IN ('pending','approved') OR (action='send_finish' AND result->>'status'<>'pending') THEN
     UPDATE atlas_customer."CustomerChallenge" SET state='UNKNOWN' WHERE id=c.id;
     RETURN atlas_customer.problem(503,'SIGN_IN_RESTART_REQUIRED');
   END IF;
   IF result->>'status'='pending' THEN
     UPDATE atlas_customer."CustomerChallenge" SET state='PENDING',"verificationSid"=result->>'verificationSid',"checkClaimId"=NULL WHERE id=c.id;
     IF action='check_finish' THEN RETURN atlas_customer.problem(400,'CODE_NOT_ACCEPTED'); END IF;
     RETURN jsonb_build_object('challengeId',c.id,'expiresAt',c."expiresAt");
   END IF;
   SELECT * INTO a FROM atlas_customer."CustomerAccount" WHERE phone=c.phone FOR UPDATE;
   IF a."revokedAt" IS NOT NULL THEN UPDATE atlas_customer."CustomerChallenge" SET state='UNKNOWN' WHERE id=c.id; RETURN atlas_customer.problem(403,'SIGN_IN_NOT_AVAILABLE'); END IF;
   INSERT INTO atlas_customer."CustomerAccount"("phoneHash",phone,"lastLoginAt") VALUES (c."phoneHash",c.phone,t)
     ON CONFLICT (phone) DO UPDATE SET "lastLoginAt"=EXCLUDED."lastLoginAt","phoneHash"=EXCLUDED."phoneHash" RETURNING * INTO a;
   INSERT INTO atlas_customer."CustomerSession"("tokenHash","accountId","browserHash","challengeId","controlRevision","accessVersion","createdAt","expiresAt")
     VALUES (d->>'sessionHash',a.id,b."tokenHash",c.id,ctl.revision,a."accessVersion",t,least(t+interval '12 hours',b."expiresAt"));
   UPDATE atlas_customer."CustomerChallenge" SET state='CONSUMED',"consumedAt"=t,"replayHash"=d->>'replayHash',"replayUntil"=least(c."expiresAt",t+interval '1 minute') WHERE id=c.id;
   RETURN jsonb_build_object('customer',atlas_customer.account_projection(a));
 END IF;
 IF action='logout' THEN
   PERFORM 1 FROM atlas_customer."CustomerSession" WHERE "tokenHash"=d->>'sessionHash' AND "browserHash"=b."tokenHash" AND "controlRevision"=ctl.revision;
   IF NOT FOUND THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
   UPDATE atlas_customer."CustomerSession" SET "revokedAt"=t WHERE "tokenHash"=d->>'sessionHash' AND "browserHash"=b."tokenHash" AND "revokedAt" IS NULL;
   RETURN jsonb_build_object('signedOut',true);
 END IF;
 SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',b."tokenHash",ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF action='profile' THEN
   IF NOT atlas_customer.valid_profile(d->'profile') THEN RETURN atlas_customer.problem(400,'RETURN_DETAILS_REQUIRED'); END IF;
   UPDATE atlas_customer."CustomerAccount" SET profile=d->'profile' WHERE id=a.id RETURNING * INTO a;
   RETURN jsonb_build_object('customer',atlas_customer.account_projection(a));
 END IF;
 RETURN atlas_customer.problem(404,'NOT_FOUND');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.customer_private_call(action text, b jsonb, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
BEGIN
 IF action<>'email' THEN RETURN atlas_customer.customer_private_call_before_email_verification(action,b,d); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d-ARRAY['name','input']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 RETURN atlas_customer.email_verification_private(d->>'name',b,d->'input');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.customer_private_call_before_email_verification(action text, b jsonb, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE svc atlas_customer."CustomerServiceControl"; ctl atlas_customer."CustomerControl";
BEGIN
 IF action<>'progress' THEN RETURN atlas_customer.customer_private_call_before_progress(action,b,d); END IF;
 SELECT * INTO svc FROM atlas_customer."CustomerServiceControl" WHERE id='active' FOR SHARE;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF svc.enabled IS DISTINCT FROM true OR svc.binding IS DISTINCT FROM b OR ctl.enabled IS DISTINCT FROM true
 OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash') IS DISTINCT FROM
 (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_SERVICE_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d-ARRAY['name','input']<>'{}'::jsonb OR octet_length(d::text)>4096 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF d->>'name'<>'finish' AND NOT COALESCE((SELECT enabled FROM atlas_customer."ProgressNotificationControl" WHERE id='active'),false) THEN RETURN atlas_customer.problem(503,'PROGRESS_NOT_ENABLED'); END IF;
 RETURN atlas_customer.progress_provider_call(d->>'name',d->'input');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.customer_private_call_before_progress(action text, b jsonb, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE svc atlas_customer."CustomerServiceControl"; ctl atlas_customer."CustomerControl"; auth jsonb; name text;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>12582912 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 name:=d->>'name';
 IF action='intake' AND name IN ('response','fail') THEN RETURN atlas_customer.intake_worker_call(name,d->'input'); END IF;
 SELECT * INTO svc FROM atlas_customer."CustomerServiceControl" WHERE id='active' FOR SHARE;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF svc.enabled IS DISTINCT FROM true OR svc.binding IS DISTINCT FROM b OR ctl.enabled IS DISTINCT FROM true
  OR jsonb_typeof(b) IS DISTINCT FROM 'object'
  OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash')
   IS DISTINCT FROM (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN
  RETURN atlas_customer.problem(503,'CUSTOMER_SERVICE_NOT_ENABLED'); END IF;
 IF action='capacity' THEN
  IF d IS DISTINCT FROM '{"input":{}}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  RETURN atlas_customer.weekly_capacity_snapshot();
 ELSIF action='directory' THEN RETURN atlas_customer.customer_call('dealer_locations',b,d->'input');
 ELSIF action='customer' THEN
  IF COALESCE(name,'') NOT IN ('intake_upload','commerce_checkout') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  auth:=d->'authority'; IF auth->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN atlas_customer.customer_call(name,b,(d->'input')||jsonb_build_object('sessionHash',auth->>'sessionHash','browserHash',auth->>'browserHash'));
 ELSIF action='intake' THEN
  IF COALESCE(name,'') NOT IN ('verify','claim','prepared','dispatch','finish') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF name<>'verify' AND NOT svc."identificationEnabled" THEN RETURN atlas_customer.problem(503,'IDENTIFICATION_NOT_CONFIGURED'); END IF;
  IF name='verify' AND d->'input'->'authority'->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN atlas_customer.intake_worker_call(name,d->'input');
 ELSIF action='commerce' THEN
  IF COALESCE(name,'') NOT IN ('commerce_checkout','commerce_save_quote','commerce_reserve_payment','commerce_record_payment','commerce_payment','commerce_confirm_paid',
   'commerce_shipping_checkout','commerce_shipping_save_quote','commerce_shipping_reserve_payment','commerce_shipping_record_payment','commerce_shipping_payment','commerce_shipping_confirm_paid',
   'commerce_order','commerce_record_tracking','commerce_trackable_effects','commerce_reconcilable_effects','commerce_pending_effects','commerce_effect','commerce_claim_effect','commerce_finish_effect','commerce_provider_event','commerce_callback_payment','commerce_callback_confirm') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF name NOT IN ('commerce_record_tracking','commerce_trackable_effects','commerce_reconcilable_effects','commerce_pending_effects','commerce_effect','commerce_claim_effect','commerce_finish_effect','commerce_provider_event','commerce_callback_payment','commerce_callback_confirm')
   AND d->'input'->'authority'->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN atlas_customer.commerce_provider_call(name,d->'providerBinding',d->'input');
 END IF;
 RETURN atlas_customer.problem(404,'NOT_FOUND');
EXCEPTION
 WHEN SQLSTATE 'PWC01' THEN RETURN atlas_customer.problem(503,'WEEKLY_CAPACITY_NOT_CONFIGURED');
 WHEN SQLSTATE 'PWC02' THEN RETURN atlas_customer.problem(409,'WEEKLY_CAPACITY_FULL');
 WHEN SQLSTATE 'PWC03' THEN RETURN atlas_customer.problem(409,'WEEKLY_CAPACITY_INVALID_QUOTE');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.email_verification_private(action text, b jsonb, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE ctl atlas_customer."CustomerControl"; svc atlas_customer."CustomerServiceControl"; a atlas_customer."CustomerAccount";
 draft atlas_customer."CustomerIntakeDraft"; v atlas_customer."CustomerEmailVerification"; auth jsonb; address text; t timestamptz; result jsonb;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>4096 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 -- Retain the outcome for an already committed claim during a serving fence.
 IF action='finish' THEN
  IF d-ARRAY['claimId','tokenHash','result']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  SELECT * INTO v FROM atlas_customer."CustomerEmailVerification" WHERE id=(d->>'claimId')::uuid AND "tokenHash"=d->>'tokenHash' FOR UPDATE;
  IF v.id IS NULL THEN RETURN atlas_customer.problem(409,'EMAIL_VERIFICATION_CONFLICT'); END IF;
  IF v.state='SENDING' THEN
   result:=d->'result';
   IF jsonb_typeof(result)='object' AND result-ARRAY['provider','providerId','deliveryStatus']='{}'::jsonb
    AND result->>'provider'='SENDGRID' AND result->>'deliveryStatus'='ACCEPTED' AND length(result->>'providerId') BETWEEN 1 AND 200 THEN
    UPDATE atlas_customer."CustomerEmailVerification" SET state='SENT',"providerId"=result->>'providerId' WHERE id=v.id;
   ELSE UPDATE atlas_customer."CustomerEmailVerification" SET state='UNKNOWN' WHERE id=v.id; END IF;
  END IF;
  RETURN atlas_customer.email_verification_status(v."accountId",v."draftId");
 END IF;
 IF action<>'claim' OR d-ARRAY['authority','draftId','requestId','claimId','tokenHash']<>'{}'::jsonb
  OR COALESCE(d->>'tokenHash','') !~ '^[a-f0-9]{64}$' THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 SELECT * INTO svc FROM atlas_customer."CustomerServiceControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR svc.enabled IS DISTINCT FROM true OR svc.binding IS DISTINCT FROM b
  OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash') IS DISTINCT FROM
  (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_SERVICE_NOT_ENABLED'); END IF;
 auth:=d->'authority';
 IF auth->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 SELECT * INTO a FROM atlas_customer.current_account(auth->>'sessionHash',auth->>'browserHash',ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-intake:'||a.id::text,0));
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=(d->>'draftId')::uuid AND "accountId"=a.id FOR UPDATE;
 IF draft.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF draft.state<>'REVIEW' THEN RETURN atlas_customer.problem(409,'INTAKE_REVIEW_NOT_READY'); END IF;
 address:=atlas_customer.canonical_email(draft."profileSnapshot"->>'email');
 IF address IS NULL THEN RETURN atlas_customer.problem(400,'CONTACT_DETAILS_REQUIRED'); END IF;
 result:=atlas_customer.email_verification_status(a.id,draft.id);
 IF NOT (result->>'required')::boolean THEN RETURN jsonb_build_object('dispatch',false,'status',result); END IF;
 SELECT * INTO v FROM atlas_customer."CustomerEmailVerification" WHERE "accountId"=a.id AND "requestId"=(d->>'requestId')::uuid;
 IF v.id IS NOT NULL THEN
  IF v."draftId"<>draft.id OR v.email<>address THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
  RETURN jsonb_build_object('dispatch',false,'status',result);
 END IF;
 IF EXISTS(SELECT 1 FROM atlas_customer."CustomerEmailVerification" WHERE "accountId"=a.id AND "createdAt">clock_timestamp()-interval '1 minute') THEN
  RETURN atlas_customer.problem(429,'EMAIL_VERIFICATION_WAIT'); END IF;
 IF NOT atlas_customer.take_rate('email-send-account:'||a.id::text,4)
  OR NOT atlas_customer.take_rate('email-send-address:'||encode(sha256(convert_to(address,'UTF8')),'hex'),6)
  OR NOT atlas_customer.take_rate('email-send-global',60) THEN RETURN atlas_customer.problem(429,'EMAIL_VERIFICATION_WAIT'); END IF;
 UPDATE atlas_customer."CustomerEmailVerification" SET state='SUPERSEDED' WHERE "accountId"=a.id AND "draftId"=draft.id AND state IN ('SENDING','SENT','UNKNOWN');
 t:=clock_timestamp();
 INSERT INTO atlas_customer."CustomerEmailVerification"(id,"accountId","draftId","requestId","browserHash",email,"deliveryEmail","tokenHash","createdAt","expiresAt",state)
 VALUES((d->>'claimId')::uuid,a.id,draft.id,(d->>'requestId')::uuid,auth->>'browserHash',address,draft."profileSnapshot"->>'email',d->>'tokenHash',t,t+interval '30 minutes','SENDING');
 RETURN jsonb_build_object('dispatch',true,'to',draft."profileSnapshot"->>'email');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.email_verification_status(aid uuid, did uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE draft atlas_customer."CustomerIntakeDraft"; v atlas_customer."CustomerEmailVerification"; verified boolean; required boolean;
BEGIN
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=did AND "accountId"=aid;
 IF draft.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 verified:=atlas_customer.email_verified(aid,draft."profileSnapshot"->>'email');
 required:=NOT verified AND NOT EXISTS(SELECT 1 FROM atlas_customer."CommercePayment" WHERE "draftId"=did AND state<>'CANCELED');
 SELECT * INTO v FROM atlas_customer."CustomerEmailVerification" WHERE "accountId"=aid AND "draftId"=did
  AND email=atlas_customer.canonical_email(draft."profileSnapshot"->>'email') ORDER BY "createdAt" DESC,id DESC LIMIT 1;
 RETURN jsonb_build_object('draftId',did,'verified',verified,'required',required,
  'email',atlas_customer.canonical_email(draft."profileSnapshot"->>'email'),'state',CASE WHEN verified THEN 'VERIFIED'
    WHEN v.id IS NULL THEN 'UNSENT' WHEN v."expiresAt"<=clock_timestamp() THEN 'EXPIRED' ELSE v.state END,
  'expiresAt',v."expiresAt",'canResendAt',v."createdAt"+interval '1 minute');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.email_verified(aid uuid, email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM atlas_customer."CustomerVerifiedEmail" e
  WHERE e."accountId"=$1 AND e.email=atlas_customer.canonical_email($2))
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.enqueue_progress(cid uuid, kind text, event_key text, occurred timestamp with time zone, src jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE a atlas_customer."CustomerAccount"; p atlas_customer."ProgressPreference"; reference text; card_title text; channel_name text; dest text;
BEGIN
 SELECT customer.* INTO a FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id
 JOIN atlas_customer."CustomerAccount" customer ON customer.id=o."accountId" WHERE c.card_id=cid AND customer."revokedAt" IS NULL;
 IF a.id IS NULL THEN RETURN; END IF;
 IF NOT atlas_customer.email_verified(a.id,a.profile->>'email') THEN RETURN; END IF;
 SELECT o.reference,c.paid_line->'identity'->>'title' INTO reference,card_title FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id WHERE c.card_id=cid;
 SELECT * INTO p FROM atlas_customer."ProgressPreference" WHERE "accountId"=a.id FOR SHARE;
 IF p."accountId" IS NULL THEN RETURN; END IF;
 -- Keep saved SMS preferences as evidence; this release enqueues email only.
 FOREACH channel_name IN ARRAY ARRAY['EMAIL'] LOOP
  IF (channel_name='EMAIL' AND NOT p.email) OR (channel_name='SMS' AND NOT p.sms) THEN CONTINUE; END IF;
  dest:=CASE channel_name WHEN 'EMAIL' THEN a.profile->>'email' ELSE a.phone END;
  IF dest IS NULL THEN CONTINUE; END IF;
  INSERT INTO atlas_customer."ProgressNotification"(id,"accountId","cardId","eventKind",source,"occurredAt",channel,"preferenceRevision",destination,request)
  VALUES(event_key||':'||cid::text||':'||channel_name,a.id,cid,kind,src,occurred,channel_name,p.revision,dest,
   jsonb_build_object('cardId',cid,'reference',reference,'title',COALESCE(card_title,''),'eventKind',kind,'occurredAt',occurred,'to',dest)) ON CONFLICT DO NOTHING;
 END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.immutable_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN RAISE EXCEPTION 'CUSTOMER_RECORD_IMMUTABLE'; END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_call(action text, account_id uuid, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE draft atlas_customer."CustomerIntakeDraft"; c atlas_customer."CustomerIntakeCard"; payload jsonb; p jsonb; side_name text; ih text; location jsonb; uid uuid; did uuid; cards integer;
BEGIN
 IF account_id IS NULL OR NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=account_id AND "revokedAt" IS NULL) THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>65536 THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
 -- Serialize this customer's cart mutations; no global intake lock.
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-intake:'||account_id::text,0));
 IF action='intake_list' THEN
   RETURN jsonb_build_object('drafts',COALESCE((SELECT jsonb_agg(atlas_customer.intake_draft_projection(q.id) ORDER BY q."createdAt" DESC) FROM (SELECT id,"createdAt" FROM atlas_customer."CustomerIntakeDraft" WHERE "accountId"=account_id AND state<>'ORDERED' ORDER BY "createdAt" DESC LIMIT 20) q),'[]'::jsonb));
 ELSIF action='intake_create' THEN
   IF COALESCE(d->>'intakeMethod','') NOT IN ('MAIL_IN','DEALER_DROP_OFF') OR (d->>'requestId') IS NULL
     OR ((d->>'intakeMethod'='MAIL_IN') IS DISTINCT FROM (d->>'kioskId' IS NULL)) THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
   ih:=encode(sha256(convert_to((d-ARRAY['sessionHash','browserHash'])::text,'UTF8')),'hex');
   SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE "accountId"=account_id AND "requestId"=(d->>'requestId')::uuid;
   IF draft.id IS NOT NULL THEN
     IF draft."inputHash"<>ih THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
     RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(draft.id));
   END IF;
   IF d->>'intakeMethod'='DEALER_DROP_OFF' THEN
     location:=atlas_customer.intake_location((d->>'kioskId')::uuid);
     IF location IS NULL THEN RETURN atlas_customer.problem(409,'KIOSK_NOT_AVAILABLE'); END IF;
   END IF;
   IF NOT atlas_customer.take_rate('intake-create:'||account_id,20) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
   INSERT INTO atlas_customer."CustomerIntakeDraft"("accountId","requestId","inputHash","intakeMethod","kioskId","locationSnapshot") VALUES
    (account_id,(d->>'requestId')::uuid,ih,d->>'intakeMethod',(d->>'kioskId')::uuid,location) RETURNING * INTO draft;
   RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(draft.id));
 END IF;
 did:=(d->>'id')::uuid;
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=did AND "accountId"=account_id FOR UPDATE;
 IF draft.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='intake_read' THEN RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did)); END IF;
 IF action='intake_upload' THEN
   SELECT u.id INTO uid FROM atlas_customer."CustomerIntakeUpload" u JOIN atlas_customer."CustomerIntakeCard" cc ON cc.id=u."cardId"
    WHERE cc."draftId"=did AND cc.id=(d->>'cardId')::uuid AND u.id=(d->>'uploadId')::uuid;
   IF uid IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   RETURN jsonb_build_object('upload',atlas_customer.intake_upload_projection(uid));
 END IF;
 IF draft.state='ORDERED' OR NOT atlas_customer.intake_editable(did) THEN RETURN atlas_customer.problem(409,'INTAKE_ALREADY_ORDERED'); END IF;
 IF action='intake_card' THEN
   payload:=d->'card'; ih:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
   IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR (payload-ARRAY['requestId','cardId','pairId','front','back'])<>'{}'::jsonb
     OR NOT payload ?& ARRAY['requestId','cardId','pairId','front','back'] THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
   SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE "draftId"=did AND "requestId"=(payload->>'requestId')::uuid;
   IF c.id IS NOT NULL THEN
     IF c."inputHash"<>ih THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
     RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did));
   END IF;
   SELECT count(*) INTO cards FROM atlas_customer."CustomerIntakeCard" WHERE "draftId"=did;
   IF cards>=100 THEN RETURN atlas_customer.problem(409,'INTAKE_CARD_LIMIT'); END IF;
   IF payload->'front'->>'sha256'=payload->'back'->>'sha256' OR payload->'front'->>'uploadId'=payload->'back'->>'uploadId' THEN RETURN atlas_customer.problem(400,'DISTINCT_CARD_SIDES_REQUIRED'); END IF;
   FOREACH side_name IN ARRAY ARRAY['front','back'] LOOP
     p:=payload->side_name;
     IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['uploadId','sha256','byteCount','fileName'] OR (p-ARRAY['uploadId','sha256','byteCount','fileName'])<>'{}'::jsonb
       OR COALESCE(p->>'sha256','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p->'byteCount') IS DISTINCT FROM 'number' OR (p->>'byteCount')::numeric<>trunc((p->>'byteCount')::numeric)
       OR (p->>'byteCount')::numeric NOT BETWEEN 1 AND 67108864 OR jsonb_typeof(p->'fileName') IS DISTINCT FROM 'string' OR length(p->>'fileName')>240 OR (p->>'fileName') ~ '[[:cntrl:]]' THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
   END LOOP;
   INSERT INTO atlas_customer."CustomerIntakeCard"(id,"draftId","requestId","pairId","inputHash") VALUES ((payload->>'cardId')::uuid,did,(payload->>'requestId')::uuid,(payload->>'pairId')::uuid,ih);
   FOREACH side_name IN ARRAY ARRAY['front','back'] LOOP
     p:=payload->side_name; uid:=(p->>'uploadId')::uuid;
     INSERT INTO atlas_customer."CustomerIntakeUpload"(id,"cardId",side,"fileName",plan) VALUES (uid,(payload->>'cardId')::uuid,upper(side_name),p->>'fileName',
      jsonb_build_object('schemaVersion',1,'uploadId',uid,'binding',jsonb_build_object('cardId',payload->>'cardId','pairId',payload->>'pairId','side',upper(side_name),'version',1),
       'object',jsonb_build_object('key','atlas-customer/originals/'||account_id::text||'/'||(payload->>'cardId')||'/'||uid::text,'versionId',NULL),
       'expected',jsonb_build_object('sha256',p->>'sha256','byteCount',(p->>'byteCount')::integer)));
   END LOOP;
 ELSIF action='intake_correct' THEN
   SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE id=(d->>'cardId')::uuid AND "draftId"=did FOR UPDATE;
   IF c.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   IF NOT atlas_customer.intake_identity_valid(d->'identity') THEN RETURN atlas_customer.problem(400,'INVALID_CARD_DETAILS'); END IF;
   IF c.revision IS DISTINCT FROM (d->>'expectedRevision')::integer THEN
     IF c.identity=d->'identity' AND c."identitySource"='CUSTOMER_CORRECTION' THEN RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did)); END IF;
     RETURN atlas_customer.problem(409,'INTAKE_REVISION_CHANGED');
   END IF;
   UPDATE atlas_customer."CustomerIntakeCard" SET identity=d->'identity',"identitySource"='CUSTOMER_CORRECTION',revision=revision+1 WHERE id=c.id;
 ELSIF action='intake_review' THEN
   IF draft.revision IS DISTINCT FROM (d->>'expectedRevision')::integer THEN RETURN atlas_customer.problem(409,'INTAKE_REVISION_CHANGED'); END IF;
   IF NOT atlas_customer.valid_intake_profile(d->'profile',draft."intakeMethod") THEN RETURN atlas_customer.problem(400,CASE WHEN draft."intakeMethod"='DEALER_DROP_OFF' THEN 'CONTACT_DETAILS_REQUIRED' ELSE 'RETURN_DETAILS_REQUIRED' END); END IF;
   IF NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeCard" WHERE "draftId"=did) OR EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeCard" cc WHERE cc."draftId"=did AND (cc.identity IS NULL OR EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=cc.id AND u.verification IS NULL))) THEN RETURN atlas_customer.problem(409,'INTAKE_REVIEW_NOT_READY'); END IF;
   IF draft.state='REVIEW' AND draft."profileSnapshot"=d->'profile' THEN RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did)); END IF;
   UPDATE atlas_customer."CustomerIntakeDraft" SET state='REVIEW',"profileSnapshot"=d->'profile',revision=revision+1,"updatedAt"=clock_timestamp() WHERE id=did;
   RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did));
 ELSE RETURN atlas_customer.problem(404,'NOT_FOUND');
 END IF;
 UPDATE atlas_customer."CustomerIntakeDraft" SET state='DRAFT',revision=revision+1,"updatedAt"=clock_timestamp() WHERE id=did;
 RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR unique_violation OR not_null_violation THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_draft_projection(did uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'intakeMethod',d."intakeMethod",'channel',CASE WHEN d."intakeMethod"='MAIL_IN' THEN 'MAIL_IN' ELSE 'KIOSK' END,
 'kioskId',d."kioskId",'locationSnapshot',atlas_customer.intake_public_location(d."locationSnapshot"),'state',d.state,'profileSnapshot',d."profileSnapshot",'createdAt',d."createdAt",'cards',COALESCE((
 SELECT jsonb_agg(jsonb_build_object('id',c.id,'pairId',c."pairId",'revision',c.revision,'identityState',c."identityState",'identity',c.identity,'identitySource',c."identitySource",
 'warnings',COALESCE(c."identityResult"->'warnings','[]'::jsonb),'uploads',(SELECT jsonb_object_agg(u.side,jsonb_build_object('id',u.id,'state',CASE WHEN u.verification IS NULL THEN 'PENDING' ELSE 'VERIFIED' END)) FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=c.id)) ORDER BY c."createdAt",c.id)
 FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),'[]'::jsonb)) FROM atlas_customer."CustomerIntakeDraft" d WHERE d.id=did
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_editable(did uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT NOT EXISTS (SELECT 1 FROM atlas_customer."CommercePayment" WHERE "draftId"=did AND state<>'CANCELED')
 AND NOT EXISTS (SELECT 1 FROM atlas_customer."CommerceOrder" WHERE "draftId"=did)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_identity_valid(v jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_typeof(v)='object' AND v ?& ARRAY['category','title','playerName','year','manufacturer','setName','cardNumber','parallel','insert']
 AND (v-ARRAY['category','title','playerName','year','manufacturer','setName','cardNumber','parallel','insert'])='{}'::jsonb
 AND v->>'category' IN ('SPORTS','POKEMON') AND length(v->>'title') BETWEEN 1 AND 180
 AND NOT EXISTS (SELECT 1 FROM jsonb_each(v) e WHERE jsonb_typeof(e.value)<>'string' OR length(v->>e.key)>180
 OR v->>e.key<>btrim(v->>e.key) OR (v->>e.key) ~ '[[:cntrl:]]'),false)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_location(kid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('id',id,'dealerId',dealer_id,'revision',revision,'name',name,'address',address,
 'terminalId',terminal_id,'terminalLocationId',terminal_location_id,'packagePrinterId',package_printer_id,
 'schedule',schedule||jsonb_build_object('nextCollectionAt',atlas_dealer.projection(schedule,clock_timestamp())->'nextCollection','projectedReturnAt',atlas_dealer.projection(schedule,clock_timestamp())->'projectedReturn','cutoffAt',atlas_dealer.next_cutoff(schedule,clock_timestamp())), 'timeZone',schedule->>'timeZone','position',jsonb_build_object('lat',latitude,'lng',longitude))
 FROM atlas_dealer.location WHERE id=kid AND enabled AND authorized_until>clock_timestamp() AND atlas_dealer.projection(schedule,clock_timestamp())->>'projectedReturn' IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_public_fields(v jsonb, keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(v)='object' THEN v ELSE '{}'::jsonb END)
 WHERE key=ANY(keys) AND jsonb_typeof(value) IN ('string','number','boolean','null')
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_public_location(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.intake_public_fields(v,ARRAY['id','name','revision'])||jsonb_build_object(
 'address',atlas_customer.intake_public_fields(v->'address',ARRAY['line1','city','region','postalCode','country']),
 'schedule',atlas_customer.intake_public_fields(v->'schedule',ARRAY['timeZone','nextCollectionAt','projectedReturnAt','cutoffAt'])||jsonb_build_object(
 'pickups',atlas_customer.intake_public_rows(v->'schedule'->'pickups',ARRAY['weekday','time','cutoff']),
 'returns',atlas_customer.intake_public_rows(v->'schedule'->'returns',ARRAY['weekday','time']),
 'exceptions',atlas_customer.intake_public_rows(v->'schedule'->'exceptions',ARRAY['date','kind','cancelled','time','cutoff','reason']))) END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_public_rows(v jsonb, keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_agg(atlas_customer.intake_public_fields(value,keys) ORDER BY ord),'[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_upload_projection(uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT jsonb_build_object('accountId',d."accountId",'draftId',d.id,'cardId',c.id,'pairId',c."pairId",'side',u.side,'plan',u.plan,'verification',u.verification,'prepared',u.prepared)
 FROM atlas_customer."CustomerIntakeUpload" u JOIN atlas_customer."CustomerIntakeCard" c ON c.id=u."cardId" JOIN atlas_customer."CustomerIntakeDraft" d ON d.id=c."draftId" WHERE u.id=uid
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_worker_call(action text, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE job atlas_customer."CustomerIntakeIdentification"; u atlas_customer."CustomerIntakeUpload"; c atlas_customer."CustomerIntakeCard"; draft atlas_customer."CustomerIntakeDraft";
 e atlas_customer."CustomerIntakeEffect"; auth jsonb; verified jsonb; pair_hash text; jid uuid; current_upload jsonb; candidate record;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>1048576 THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
 IF action='verify' THEN
   auth:=d->'authority';
   current_upload:=atlas_customer.customer_call('intake_upload',auth->'binding',(auth- 'binding')||jsonb_build_object('id',d->>'id','cardId',d->>'cardId','uploadId',d->>'uploadId'));
   IF current_upload ? 'error' THEN RETURN current_upload; END IF;
   SELECT * INTO u FROM atlas_customer."CustomerIntakeUpload" WHERE id=(d->>'uploadId')::uuid FOR UPDATE;
   SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE id=u."cardId" FOR UPDATE;
   verified:=d->'verification';
   IF jsonb_typeof(verified) IS DISTINCT FROM 'object' OR (verified->'object'->>'key') IS DISTINCT FROM (u.plan->'object'->>'key')
     OR verified->>'sha256' IS DISTINCT FROM u.plan->'expected'->>'sha256' OR verified->'byteCount' IS DISTINCT FROM u.plan->'expected'->'byteCount'
     OR verified->>'contentType' IS DISTINCT FROM 'application/octet-stream' THEN RETURN atlas_customer.problem(409,'INTAKE_UPLOAD_CONFLICT'); END IF;
   IF u.verification IS NOT NULL AND u.verification<>verified THEN RETURN atlas_customer.problem(409,'INTAKE_UPLOAD_CONFLICT'); END IF;
   UPDATE atlas_customer."CustomerIntakeUpload" SET verification=verified WHERE id=u.id AND verification IS NULL;
   IF NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeUpload" WHERE "cardId"=c.id AND verification IS NULL) THEN
     SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_object('plan',plan,'verification',verification) ORDER BY side)::text,'UTF8')),'hex') INTO pair_hash FROM atlas_customer."CustomerIntakeUpload" WHERE "cardId"=c.id;
     INSERT INTO atlas_customer."CustomerIntakeIdentification"("cardId","sourceHash") VALUES (c.id,pair_hash) ON CONFLICT ("cardId") DO NOTHING;
     UPDATE atlas_customer."CustomerIntakeCard" SET "identityState"='QUEUED' WHERE id=c.id AND "identityState"='UPLOADING';
   END IF;
   RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(c."draftId"));
 ELSIF action='claim' THEN
   -- All worker transitions lock draft, card, then job, matching customer
   -- verification/checkout. SKIP LOCKED prevents one busy draft blocking others.
   FOR candidate IN SELECT j.id AS job_id,cc.id AS card_id,dd.id AS draft_id FROM atlas_customer."CustomerIntakeIdentification" j
    JOIN atlas_customer."CustomerIntakeCard" cc ON cc.id=j."cardId" JOIN atlas_customer."CustomerIntakeDraft" dd ON dd.id=cc."draftId"
    WHERE j.state='RUNNING' AND j."leaseUntil"<clock_timestamp() AND EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" ef WHERE ef."attemptId"=j.id AND ef.response IS NULL) LIMIT 100 LOOP
     PERFORM 1 FROM atlas_customer."CustomerIntakeDraft" WHERE id=candidate.draft_id FOR UPDATE SKIP LOCKED;
     IF NOT FOUND THEN CONTINUE; END IF;
     PERFORM 1 FROM atlas_customer."CustomerIntakeCard" WHERE id=candidate.card_id FOR UPDATE;
     SELECT * INTO job FROM atlas_customer."CustomerIntakeIdentification" WHERE id=candidate.job_id FOR UPDATE;
     IF job.state='RUNNING' AND job."leaseUntil"<clock_timestamp() AND EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" ef WHERE ef."attemptId"=job.id AND ef.response IS NULL) THEN
       UPDATE atlas_customer."CustomerIntakeIdentification" SET state='UNKNOWN',code='IDENTIFICATION_OUTCOME_UNKNOWN' WHERE id=job.id;
       UPDATE atlas_customer."CustomerIntakeCard" SET "identityState"='UNKNOWN' WHERE id=candidate.card_id;
     END IF;
   END LOOP;
   job:=NULL;
   SELECT dd.* INTO draft FROM atlas_customer."CustomerIntakeIdentification" j JOIN atlas_customer."CustomerIntakeCard" cc ON cc.id=j."cardId"
     JOIN atlas_customer."CustomerIntakeDraft" dd ON dd.id=cc."draftId" JOIN atlas_customer."CustomerAccount" a ON a.id=dd."accountId"
    WHERE a."revokedAt" IS NULL AND dd.state<>'ORDERED' AND (j.state='QUEUED' OR (j.state='RUNNING' AND j."leaseUntil"<clock_timestamp()
     AND NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" ef WHERE ef."attemptId"=j.id AND ef.response IS NULL))) ORDER BY j."createdAt" FOR UPDATE OF dd SKIP LOCKED LIMIT 1;
   IF draft.id IS NULL THEN RETURN jsonb_build_object('job',NULL); END IF;
   SELECT cc.* INTO c FROM atlas_customer."CustomerIntakeCard" cc JOIN atlas_customer."CustomerIntakeIdentification" j ON j."cardId"=cc.id
    WHERE cc."draftId"=draft.id AND (j.state='QUEUED' OR (j.state='RUNNING' AND j."leaseUntil"<clock_timestamp()
     AND NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" ef WHERE ef."attemptId"=j.id AND ef.response IS NULL))) ORDER BY j."createdAt" FOR UPDATE OF cc LIMIT 1;
   SELECT * INTO job FROM atlas_customer."CustomerIntakeIdentification" WHERE "cardId"=c.id FOR UPDATE;
   IF job.id IS NULL THEN RETURN jsonb_build_object('job',NULL); END IF;
   UPDATE atlas_customer."CustomerIntakeIdentification" SET state='RUNNING',"leaseId"=gen_random_uuid(),"leaseUntil"=clock_timestamp()+interval '10 minutes' WHERE id=job.id RETURNING * INTO job;
   UPDATE atlas_customer."CustomerIntakeCard" SET "identityState"='PROCESSING' WHERE id=job."cardId" RETURNING * INTO c;
   SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=c."draftId";
   RETURN jsonb_build_object('job',jsonb_build_object('attemptId',job.id,'leaseId',job."leaseId",'accountId',draft."accountId",'cardId',c.id,'sourceHash',job."sourceHash",
    'uploads',(SELECT jsonb_object_agg(side,atlas_customer.intake_upload_projection(id)) FROM atlas_customer."CustomerIntakeUpload" WHERE "cardId"=c.id)));
 END IF;
 SELECT * INTO job FROM atlas_customer."CustomerIntakeIdentification" WHERE id=(d->>'attemptId')::uuid;
 SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE id=job."cardId";
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=c."draftId" FOR UPDATE;
 SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE id=job."cardId" FOR UPDATE;
 SELECT * INTO job FROM atlas_customer."CustomerIntakeIdentification" WHERE id=(d->>'attemptId')::uuid FOR UPDATE;
 IF job.id IS NULL OR job.state<>'RUNNING' OR job."leaseId" IS DISTINCT FROM (d->>'leaseId')::uuid OR job."leaseUntil"<=clock_timestamp() THEN RETURN atlas_customer.problem(409,'INTAKE_LEASE_EXPIRED'); END IF;
 IF action='prepared' THEN
   SELECT * INTO u FROM atlas_customer."CustomerIntakeUpload" WHERE id=(d->>'uploadId')::uuid AND "cardId"=c.id FOR UPDATE;
   IF u.id IS NULL OR u.verification IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   IF u.prepared IS NOT NULL AND u.prepared<>d->'photo' THEN RETURN atlas_customer.problem(409,'INTAKE_UPLOAD_CONFLICT'); END IF;
   UPDATE atlas_customer."CustomerIntakeUpload" SET prepared=d->'photo' WHERE id=u.id AND prepared IS NULL;
 ELSIF action IN ('dispatch','response') THEN
   IF COALESCE(d->>'stage','') NOT IN ('OCR_FRONT','OCR_BACK','MODEL') OR COALESCE(d->>'requestHash','') !~ '^[a-f0-9]{64}$' THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
   SELECT * INTO e FROM atlas_customer."CustomerIntakeEffect" WHERE "attemptId"=job.id AND stage=d->>'stage' FOR UPDATE;
   IF action='dispatch' THEN
     IF e."attemptId" IS NOT NULL THEN
       IF e."requestHash"<>d->>'requestHash' THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
       RETURN jsonb_build_object('dispatch',false,'response',e.response);
     END IF;
     IF NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerAccount" a WHERE a.id=draft."accountId" AND a."revokedAt" IS NULL)
       OR draft.state<>'DRAFT' OR NOT atlas_customer.intake_editable(draft.id) THEN RETURN atlas_customer.problem(409,'INTAKE_IDENTIFICATION_NO_LONGER_REQUIRED'); END IF;
     INSERT INTO atlas_customer."CustomerIntakeEffect"("attemptId",stage,"requestHash") VALUES (job.id,d->>'stage',d->>'requestHash');
     RETURN jsonb_build_object('dispatch',true);
   END IF;
   IF e."attemptId" IS NULL OR e."requestHash" IS DISTINCT FROM d->>'requestHash' OR length(d->>'response') NOT BETWEEN 1 AND 349528
     OR encode(sha256(decode(d->>'response','base64')),'hex') IS DISTINCT FROM d->>'responseHash' OR (e.response IS NOT NULL AND e.response IS DISTINCT FROM d->>'response') THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
   UPDATE atlas_customer."CustomerIntakeEffect" SET response=d->>'response',"responseHash"=d->>'responseHash',"respondedAt"=clock_timestamp() WHERE "attemptId"=job.id AND stage=d->>'stage' AND response IS NULL;
 ELSIF action='finish' THEN
   IF jsonb_typeof(d->'result') IS DISTINCT FROM 'object' OR NOT (d->'result') ?& ARRAY['identity','suggestions','warnings','provenance']
     OR d->'result'->'provenance'->'subject'->>'id' IS DISTINCT FROM c.id::text OR d->'result'->'provenance'->'subject'->>'revision' IS DISTINCT FROM job."sourceHash"
     OR d->'result'->'provenance'->>'engine_version' IS DISTINCT FROM 'card-identification-v2' OR jsonb_typeof(d->'result'->'warnings') IS DISTINCT FROM 'array'
     OR jsonb_typeof(d->'result'->'suggestions') IS DISTINCT FROM 'object' THEN RETURN atlas_customer.problem(409,'IDENTIFICATION_SOURCE_CHANGED'); END IF;
   IF EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" WHERE "attemptId"=job.id AND response IS NULL) OR NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" WHERE "attemptId"=job.id AND stage='MODEL' AND response IS NOT NULL) THEN RETURN atlas_customer.problem(409,'IDENTIFICATION_OUTCOME_UNKNOWN'); END IF;
   IF d->'result'->'identity'<>'null'::jsonb AND NOT atlas_customer.intake_identity_valid(d->'result'->'identity') THEN RETURN atlas_customer.problem(400,'INVALID_CARD_DETAILS'); END IF;
   UPDATE atlas_customer."CustomerIntakeIdentification" SET state='READY',result=d->'result',"leaseUntil"=NULL WHERE id=job.id;
   UPDATE atlas_customer."CustomerIntakeCard" SET "identityState"=CASE WHEN COALESCE(identity,d->'result'->'identity') IS NULL OR COALESCE(identity,d->'result'->'identity')='null'::jsonb THEN 'ATTENTION' ELSE 'READY' END,
    identity=CASE WHEN "identitySource"='CUSTOMER_CORRECTION' THEN identity ELSE NULLIF(d->'result'->'identity','null'::jsonb) END,
    "identitySource"=CASE WHEN "identitySource"='CUSTOMER_CORRECTION' THEN "identitySource" ELSE 'MACHINE_PROPOSAL' END,"identityResult"=d->'result',revision=revision+1 WHERE id=c.id AND draft.state='DRAFT' AND atlas_customer.intake_editable(draft.id);
   -- An already reviewed cart contains customer-confirmed details; never change
   -- its financial snapshot from a late machine proposal.
   IF draft.state='DRAFT' AND atlas_customer.intake_editable(draft.id) THEN UPDATE atlas_customer."CustomerIntakeDraft" SET revision=revision+1,"updatedAt"=clock_timestamp() WHERE id=draft.id; END IF;
 ELSIF action='fail' THEN
   pair_hash:=CASE WHEN EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeEffect" WHERE "attemptId"=job.id AND response IS NULL) THEN 'UNKNOWN' ELSE 'ATTENTION' END;
   UPDATE atlas_customer."CustomerIntakeIdentification" SET state=pair_hash,code=left(d->>'code',90),"leaseUntil"=NULL WHERE id=job.id;
   UPDATE atlas_customer."CustomerIntakeCard" SET "identityState"=pair_hash WHERE id=c.id;
 ELSE RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.problem(s integer, c text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('error',jsonb_build_object('status',s,'code',c))
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_custody_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF NEW.kind<>'DEPOSIT_DECLARED' THEN PERFORM atlas_customer.enqueue_progress(NEW.card_id,NEW.kind,'custody:'||NEW.id,NEW.occurred_at,jsonb_build_object('type','CUSTODY','id',NEW.id)); END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_grading_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 PERFORM atlas_customer.enqueue_progress(NEW.card_id,'GRADING_STARTED','grading:'||NEW.manual_card_id,NEW.linked_at,
  jsonb_build_object('type','GRADING','cardId',NEW.manual_card_id));
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_handoff_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE cid uuid;
BEGIN
 FOREACH cid IN ARRAY NEW.card_ids LOOP
  PERFORM atlas_customer.enqueue_progress(cid,'DEALER_RECEIVED','handoff:'||NEW.id,NEW.received_at,jsonb_build_object('type','HANDOFF','id',NEW.id));
 END LOOP;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_notification_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','claimId','result','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','claimId','result','updatedAt'])
 OR NOT ((OLD.state='PENDING' AND NEW.state IN ('DISPATCHED','SUPPRESSED'))
  OR (OLD.state='DISPATCHED' AND NEW.state IN ('ACCEPTED','UNKNOWN') AND NEW."claimId"=OLD."claimId")
  OR (OLD.state='UNKNOWN' AND NEW.state='ACCEPTED' AND NEW."claimId"=OLD."claimId")) THEN
  RAISE EXCEPTION 'Progress notification evidence is immutable';
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_preference_call(action text, aid uuid, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE p atlas_customer."ProgressPreference"; previous atlas_customer."ProgressPreferenceEvent"; expected integer; rid uuid;
BEGIN
 IF action='progress_preferences' THEN
  IF d<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  RETURN atlas_customer.progress_preferences(aid);
 END IF;
 IF action<>'progress_preferences_save' OR d-ARRAY['requestId','expectedRevision','email','sms']<>'{}'::jsonb
 OR NOT d ?& ARRAY['requestId','expectedRevision','email','sms'] OR jsonb_typeof(d->'email')<>'boolean' OR jsonb_typeof(d->'sms')<>'boolean'
 OR COALESCE(d->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,8})$' OR COALESCE(d->>'requestId','') !~ '^[a-f0-9-]{36}$' THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 expected:=(d->>'expectedRevision')::integer;rid:=(d->>'requestId')::uuid;
 -- The account lock serializes the absent preference row too.
 PERFORM 1 FROM atlas_customer."CustomerAccount" WHERE id=aid FOR UPDATE;
 SELECT * INTO previous FROM atlas_customer."ProgressPreferenceEvent" WHERE "accountId"=aid AND "requestId"=rid;
 IF previous."accountId" IS NOT NULL THEN
  IF previous.revision<>expected+1 OR previous.email<>(d->>'email')::boolean OR previous.sms<>(d->>'sms')::boolean THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
  RETURN atlas_customer.progress_preferences(aid);
 END IF;
 SELECT * INTO p FROM atlas_customer."ProgressPreference" WHERE "accountId"=aid;
 IF COALESCE(p.revision,0)<>expected THEN RETURN atlas_customer.problem(409,'PREFERENCES_CHANGED'); END IF;
 IF (d->>'email')::boolean AND NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=aid AND COALESCE(profile->>'email','') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RETURN atlas_customer.problem(409,'PROFILE_EMAIL_REQUIRED'); END IF;
 INSERT INTO atlas_customer."ProgressPreference"("accountId",revision,email,sms) VALUES(aid,expected+1,(d->>'email')::boolean,(d->>'sms')::boolean)
 ON CONFLICT("accountId") DO UPDATE SET revision=EXCLUDED.revision,email=EXCLUDED.email,sms=EXCLUDED.sms,"updatedAt"=clock_timestamp();
 INSERT INTO atlas_customer."ProgressPreferenceEvent"("accountId",revision,"requestId",email,sms) VALUES(aid,expected+1,rid,(d->>'email')::boolean,(d->>'sms')::boolean);
 RETURN atlas_customer.progress_preferences(aid);
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_preferences(aid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('revision',COALESCE(p.revision,0),'email',COALESCE(p.email,false),'sms',COALESCE(p.sms,false),
 'deliveryChannels',jsonb_build_array('EMAIL'),'deliveryEnabled',COALESCE((SELECT enabled FROM atlas_customer."ProgressNotificationControl" WHERE id='active'),false))
 FROM (SELECT aid id) a LEFT JOIN atlas_customer."ProgressPreference" p ON p."accountId"=a.id
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_provider_call(action text, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE e atlas_customer."ProgressNotification"; p atlas_customer."ProgressPreference"; a atlas_customer."CustomerAccount";
BEGIN
 IF action='pending' THEN
  IF d<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  UPDATE atlas_customer."ProgressNotification" SET state='UNKNOWN',result=jsonb_build_object('code','PROGRESS_OUTCOME_UNKNOWN'),"updatedAt"=clock_timestamp()
   WHERE state='DISPATCHED' AND channel='EMAIL' AND "updatedAt"<clock_timestamp()-interval '2 minutes';
  RETURN jsonb_build_object('ids',COALESCE((SELECT jsonb_agg(id) FROM (SELECT id FROM atlas_customer."ProgressNotification" WHERE state='PENDING' AND channel='EMAIL' ORDER BY "createdAt",id LIMIT 20) pending),'[]'::jsonb));
 END IF;
 IF action NOT IN ('claim','finish') OR COALESCE(d->>'id','')='' OR COALESCE(d->>'claimId','') !~ '^[a-f0-9-]{36}$' THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO e FROM atlas_customer."ProgressNotification" WHERE id=d->>'id' FOR UPDATE;
 IF e.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='claim' THEN
  IF d-ARRAY['id','claimId']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  IF e.state<>'PENDING' THEN RETURN jsonb_build_object('dispatch',false); END IF;
  IF e.channel='SMS' THEN RETURN jsonb_build_object('dispatch',false,'blockedReason','SMS_NOTIFICATIONS_DISABLED'); END IF;
  SELECT * INTO a FROM atlas_customer."CustomerAccount" WHERE id=e."accountId" FOR SHARE;
  SELECT * INTO p FROM atlas_customer."ProgressPreference" WHERE "accountId"=e."accountId" FOR SHARE;
  IF a."revokedAt" IS NOT NULL OR p.revision IS DISTINCT FROM e."preferenceRevision"
   OR NOT (CASE e.channel WHEN 'EMAIL' THEN p.email ELSE p.sms END)
   OR e.destination IS DISTINCT FROM (CASE e.channel WHEN 'EMAIL' THEN a.profile->>'email' ELSE a.phone END)
   OR NOT atlas_customer.email_verified(a.id,e.destination)
   OR NOT atlas_customer.progress_source_current(e) THEN
   UPDATE atlas_customer."ProgressNotification" SET state='SUPPRESSED',"updatedAt"=clock_timestamp() WHERE id=e.id;
   RETURN jsonb_build_object('dispatch',false);
  END IF;
  UPDATE atlas_customer."ProgressNotification" SET state='DISPATCHED',"claimId"=(d->>'claimId')::uuid,"updatedAt"=clock_timestamp() WHERE id=e.id;
  RETURN jsonb_build_object('dispatch',true,'effect',jsonb_build_object('id',e.id,'kind',e.channel||'_PROGRESS','request',e.request));
 END IF;
 IF d-ARRAY['id','claimId','state','result']<>'{}'::jsonb OR e."claimId" IS DISTINCT FROM (d->>'claimId')::uuid OR COALESCE(d->>'state','') NOT IN ('ACCEPTED','UNKNOWN')
  OR jsonb_typeof(d->'result') IS DISTINCT FROM 'object' OR octet_length((d->'result')::text)>1024 THEN RETURN atlas_customer.problem(409,'PROGRESS_CLAIM_CONFLICT'); END IF;
 IF e.state='ACCEPTED' THEN
  IF e.result IS DISTINCT FROM d->'result' OR d->>'state'<>'ACCEPTED' THEN RETURN atlas_customer.problem(409,'PROGRESS_RESULT_CONFLICT'); END IF;
  RETURN jsonb_build_object('state',e.state);
 END IF;
 IF e.state='UNKNOWN' AND d->>'state'='UNKNOWN' THEN RETURN jsonb_build_object('state',e.state); END IF;
 IF e.state NOT IN ('DISPATCHED','UNKNOWN') THEN RETURN atlas_customer.problem(409,'PROGRESS_CLAIM_CONFLICT'); END IF;
 IF d->>'state'='ACCEPTED' AND (COALESCE(d->'result'->>'provider','') NOT IN ('SENDGRID','TWILIO') OR length(COALESCE(d->'result'->>'providerId','')) NOT BETWEEN 1 AND 200
 OR COALESCE(d->'result'->>'deliveryStatus','') NOT IN ('ACCEPTED','QUEUED','SENDING','SENT','DELIVERED','UNDELIVERED','FAILED')) THEN RETURN atlas_customer.problem(409,'PROGRESS_RESULT_INVALID'); END IF;
 UPDATE atlas_customer."ProgressNotification" SET state=d->>'state',result=d->'result',"updatedAt"=clock_timestamp() WHERE id=e.id;
 RETURN jsonb_build_object('state',d->>'state');
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_publication_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE cid uuid;
BEGIN
 IF NEW.state='PUBLISHED' AND OLD.state<>'PUBLISHED' AND NEW.mode='PRODUCTION' THEN
  SELECT card_id INTO cid FROM atlas_dealer.manual_card_link WHERE manual_card_id=NEW.card_id;
  IF cid IS NOT NULL THEN PERFORM atlas_customer.enqueue_progress(cid,'REPORT_PUBLISHED','report:'||NEW.action_id,NEW.published_at,
   jsonb_build_object('type','PUBLICATION','cardId',NEW.card_id,'actionId',NEW.action_id,'version',NEW.version)); END IF;
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_source_current(e atlas_customer."ProgressNotification")
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE e.source->>'type'
 WHEN 'CUSTODY' THEN EXISTS(SELECT 1 FROM atlas_dealer.custody_event c WHERE c.id::text=e.source->>'id' AND c.card_id=e."cardId" AND c.kind=e."eventKind"
   AND NOT EXISTS(SELECT 1 FROM atlas_dealer.custody_event newer WHERE newer.card_id=c.card_id AND newer.sequence>c.sequence))
 WHEN 'HANDOFF' THEN EXISTS(SELECT 1 FROM atlas_dealer.handoff_receipt r WHERE r.id::text=e.source->>'id' AND e."cardId"=ANY(r.card_ids))
 WHEN 'GRADING' THEN EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link l WHERE l.card_id=e."cardId" AND l.manual_card_id::text=e.source->>'cardId'
  AND NOT EXISTS(SELECT 1 FROM atlas_manual.approval a WHERE a.card_id=l.manual_card_id)
  AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=l.manual_card_id))
 WHEN 'PUBLICATION' THEN EXISTS(SELECT 1 FROM atlas_manual.publication p JOIN atlas_dealer.manual_card_link l ON l.manual_card_id=p.card_id
  WHERE l.card_id=e."cardId" AND p.card_id::text=e.source->>'cardId' AND p.action_id::text=e.source->>'actionId' AND p.state='PUBLISHED' AND p.mode='PRODUCTION'
  AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)
  AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication newer WHERE newer.card_id=p.card_id AND newer.state='PUBLISHED' AND newer.version>p.version))
 ELSE false END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.take_rate(k text, lim integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE n integer; t timestamptz:=clock_timestamp();
BEGIN
 INSERT INTO atlas_customer."CustomerRateBucket"(key,count,"expiresAt") VALUES (k,1,t+interval '15 minutes')
 ON CONFLICT (key) DO UPDATE SET count=CASE WHEN "CustomerRateBucket"."expiresAt"<=t THEN 1 ELSE least("CustomerRateBucket".count+1,lim+1) END,
 "expiresAt"=CASE WHEN "CustomerRateBucket"."expiresAt"<=t THEN t+interval '15 minutes' ELSE "CustomerRateBucket"."expiresAt" END
 RETURNING count INTO n;
 RETURN n<=lim;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.valid_contact_profile(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_typeof(p)='object' AND p ? 'name'
  AND p-ARRAY['name','email']='{}'::jsonb
  AND jsonb_typeof(p->'name')='string' AND length(p->>'name') BETWEEN 1 AND 120
  AND (p->>'name')=btrim(p->>'name') AND (p->>'name') !~ '[[:cntrl:]]'
  AND (NOT p ? 'email' OR (jsonb_typeof(p->'email')='string'
   AND length(p->>'email')<=254 AND (p->>'email')=btrim(p->>'email')
   AND ((p->>'email')='' OR ((p->>'email') !~ '[[:cntrl:][:space:]]'
    AND (p->>'email') ~ '^[^@]+@[^@]+\.[^@]+$')))),false)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.valid_intake_profile(p jsonb, method text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(atlas_customer.canonical_email(p->>'email') IS NOT NULL AND
  CASE method WHEN 'DEALER_DROP_OFF' THEN atlas_customer.valid_shop_profile(p)
  WHEN 'MAIL_IN' THEN atlas_customer.valid_profile(p) ELSE false END,false)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.valid_profile(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT atlas_customer.valid_profile_legacy(p-'email') AND (NOT p ? 'email' OR
  (jsonb_typeof(p->'email')='string' AND length(p->>'email') BETWEEN 3 AND 254
   AND (p->>'email')=btrim(p->>'email') AND (p->>'email') !~ '[[:cntrl:][:space:]]'
   AND (p->>'email') ~ '^[^@]+@[^@]+\.[^@]+$'))
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.valid_profile_legacy(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT COALESCE(jsonb_typeof(p)='object' AND
    p ?& ARRAY['name','address1','address2','city','region','postalCode','country'] AND
    (p-ARRAY['name','address1','address2','city','region','postalCode','country'])='{}'::jsonb AND
    NOT EXISTS (SELECT 1 FROM jsonb_each(p) e WHERE jsonb_typeof(e.value)<>'string'
      OR length(p->>e.key)>CASE e.key WHEN 'name' THEN 120 WHEN 'address1' THEN 200 WHEN 'address2' THEN 200 WHEN 'postalCode' THEN 30 WHEN 'country' THEN 2 ELSE 100 END OR (p->>e.key) ~ '[[:cntrl:]]'
      OR (p->>e.key)<>btrim(p->>e.key)
      OR (e.key NOT IN ('address2','region') AND length(p->>e.key)=0)) AND
    (p->>'country') ~ '^[A-Z]{2}$', false)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.valid_shop_profile(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT atlas_customer.valid_contact_profile(p) OR atlas_customer.valid_profile(p)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.weekly_capacity_materialize_shared_week(instant timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE starts timestamptz; ends timestamptz; quota integer;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'WEEKLY_CAPACITY_UNSUPPORTED_ISOLATION' USING ERRCODE='25000';
 END IF;
 SELECT w."weekStartsAt",w."resetsAt" INTO starts,ends FROM atlas_customer.weekly_capacity_week(instant) w;
 quota:=atlas_customer.weekly_capacity_shared_quota(starts);
 IF quota IS NOT NULL THEN
  INSERT INTO atlas_customer."WeeklyCapacitySharedWeek"("weekStartsAt","resetsAt","quotaCards")
   VALUES(starts,ends,quota) ON CONFLICT DO NOTHING;
 END IF;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.weekly_capacity_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE q atlas_customer."CommerceQuote"; channel_name text; starts timestamptz; ends timestamptz; quota integer; used bigint; count_cards integer; r atlas_customer."WeeklyCapacityReservation";
BEGIN
 IF TG_OP='INSERT' THEN
  -- A row lock serializes writers, but an older REPEATABLE READ snapshot could
  -- still miss a committed reservation. Admission requires fresh statements.
  IF current_setting('transaction_isolation')<>'read committed' THEN
   RAISE EXCEPTION 'WEEKLY_CAPACITY_UNSUPPORTED_ISOLATION' USING ERRCODE='25000';
  END IF;
  SELECT * INTO q FROM atlas_customer."CommerceQuote" WHERE id=NEW."quoteId";
  channel_name:=CASE q.snapshot->>'channel' WHEN 'MAIL_IN' THEN 'MAIL_IN' WHEN 'KIOSK' THEN 'DEALER_DROP_OFF' WHEN 'DEALER_DROP_OFF' THEN 'DEALER_DROP_OFF' ELSE NULL END;
  count_cards:=jsonb_array_length(q.snapshot->'cards');
  IF channel_name IS NULL OR count_cards IS NULL OR count_cards<1 THEN RAISE EXCEPTION 'WEEKLY_CAPACITY_INVALID_QUOTE' USING ERRCODE='PWC03'; END IF;
  SELECT w."weekStartsAt",w."resetsAt" INTO starts,ends FROM atlas_customer.weekly_capacity_week(statement_timestamp()) w;
  -- First admission materializes the authorized recurring allowance, if any.
  -- The concrete week then remains the immutable shared admission authority.
  PERFORM atlas_customer.weekly_capacity_materialize_shared_week(statement_timestamp());
  -- BOTH routes take this same row lock BEFORE inspecting or changing capacity.
  SELECT w."quotaCards" INTO quota FROM atlas_customer."WeeklyCapacitySharedWeek" w WHERE w."weekStartsAt"=starts FOR UPDATE;
  IF quota IS NULL THEN RAISE EXCEPTION 'WEEKLY_CAPACITY_NOT_CONFIGURED' USING ERRCODE='PWC01'; END IF;
  SELECT COALESCE(sum("cardCount"),0) INTO used FROM atlas_customer."WeeklyCapacityReservation"
   WHERE "weekStartsAt"=starts AND state<>'RELEASED';
  IF used+count_cards>quota THEN RAISE EXCEPTION 'WEEKLY_CAPACITY_FULL' USING ERRCODE='PWC02'; END IF;
  -- Retain the original per-route foreign key/history, without using it as a second allowance.
  INSERT INTO atlas_customer."WeeklyCapacityWeek"(channel,"weekStartsAt","resetsAt","quotaCards")
   VALUES(channel_name,starts,ends,quota) ON CONFLICT DO NOTHING;
  INSERT INTO atlas_customer."WeeklyCapacityReservation"("paymentId",channel,"weekStartsAt","cardCount")
   VALUES(NEW.id,channel_name,starts,count_cards);
 ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state IN ('PAID','CANCELED') THEN
  SELECT * INTO r FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=NEW.id;
  IF r."paymentId" IS NULL THEN RETURN NEW; END IF;
  -- Historical rows without a shared week remain resolvable. Always keep lock order.
  PERFORM 1 FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=r."weekStartsAt" FOR UPDATE;
  PERFORM 1 FROM atlas_customer."WeeklyCapacityWeek" WHERE channel=r.channel AND "weekStartsAt"=r."weekStartsAt" FOR UPDATE;
  UPDATE atlas_customer."WeeklyCapacityReservation" SET state=CASE WHEN NEW.state='PAID' THEN 'CONSUMED' ELSE 'RELEASED' END,"updatedAt"=clock_timestamp()
   WHERE "paymentId"=NEW.id AND state='HELD';
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.weekly_capacity_reservation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='DELETE' OR NEW."paymentId"<>OLD."paymentId" OR NEW.channel<>OLD.channel OR NEW."weekStartsAt"<>OLD."weekStartsAt"
 OR NEW."cardCount"<>OLD."cardCount" OR NEW."createdAt"<>OLD."createdAt"
 OR (OLD.state IN ('CONSUMED','RELEASED') AND NEW.state<>OLD.state) THEN RAISE EXCEPTION 'Weekly capacity evidence is immutable'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.weekly_capacity_shared_policy_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE starts timestamptz; current_starts timestamptz; used bigint;
BEGIN
 SELECT w."weekStartsAt" INTO starts FROM atlas_customer.weekly_capacity_week(NEW."effectiveWeekStartsAt") w;
 SELECT w."weekStartsAt" INTO current_starts FROM atlas_customer.weekly_capacity_week(statement_timestamp()) w;
 IF starts IS DISTINCT FROM NEW."effectiveWeekStartsAt" OR starts<current_starts THEN
  RAISE EXCEPTION 'INVALID_RECURRING_CAPACITY_START';
 END IF;
 IF NEW."quotaCards" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=starts) THEN
  SELECT COALESCE(sum("cardCount"),0) INTO used FROM atlas_customer."WeeklyCapacityReservation"
   WHERE "weekStartsAt"=starts AND state<>'RELEASED';
  IF used>NEW."quotaCards" THEN RAISE EXCEPTION 'SHARED_CAPACITY_BELOW_EXISTING_RESERVATIONS'; END IF;
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.weekly_capacity_shared_quota(starts timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE quota integer;
BEGIN
 -- An explicit or already materialized week always wins, including a zero quota.
 SELECT "quotaCards" INTO quota FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=starts;
 IF FOUND THEN RETURN quota; END IF;
 -- The newest effective policy continues indefinitely. A NULL successor means
 -- unconfigured; it must not fall through to an older non-NULL policy.
 SELECT "quotaCards" INTO quota FROM atlas_customer."WeeklyCapacitySharedPolicy"
 WHERE "effectiveWeekStartsAt"<=starts ORDER BY "effectiveWeekStartsAt" DESC LIMIT 1;
 RETURN quota;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.weekly_capacity_shared_week_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE starts timestamptz; ends timestamptz; used bigint;
BEGIN
 SELECT w."weekStartsAt",w."resetsAt" INTO starts,ends FROM atlas_customer.weekly_capacity_week(NEW."weekStartsAt") w;
 IF starts IS DISTINCT FROM NEW."weekStartsAt" OR ends IS DISTINCT FROM NEW."resetsAt" THEN
  RAISE EXCEPTION 'INVALID_SHARED_CAPACITY_WEEK';
 END IF;
 SELECT COALESCE(sum("cardCount"),0) INTO used FROM atlas_customer."WeeklyCapacityReservation"
 WHERE "weekStartsAt"=starts AND state<>'RELEASED';
 IF used>NEW."quotaCards" THEN RAISE EXCEPTION 'SHARED_CAPACITY_BELOW_EXISTING_RESERVATIONS'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.weekly_capacity_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
DECLARE instant timestamptz:=statement_timestamp(); starts timestamptz; ends timestamptz; quota integer; held bigint; accepted bigint; pools jsonb;
BEGIN
 SELECT w."weekStartsAt",w."resetsAt" INTO starts,ends FROM atlas_customer.weekly_capacity_week(instant) w;
 -- Anonymous/public reads remain read-only, including before first admission.
 quota:=atlas_customer.weekly_capacity_shared_quota(starts);
 -- One SQL statement supplies both total and route breakdown at the same snapshot.
 SELECT COALESCE(sum(a.held),0),COALESCE(sum(a.accepted),0),jsonb_agg(jsonb_build_object('channel',c.channel,
  'heldCards',CASE WHEN quota IS NULL THEN NULL ELSE COALESCE(a.held,0) END,
  'acceptedCards',CASE WHEN quota IS NULL THEN NULL ELSE COALESCE(a.accepted,0) END) ORDER BY c.channel) INTO held,accepted,pools
 FROM (VALUES('MAIL_IN'),('DEALER_DROP_OFF')) c(channel)
 LEFT JOIN LATERAL (SELECT sum("cardCount") FILTER(WHERE state='HELD') held,sum("cardCount") FILTER(WHERE state='CONSUMED') accepted
  FROM atlas_customer."WeeklyCapacityReservation" r WHERE r.channel=c.channel AND r."weekStartsAt"=starts) a ON true;
 RETURN jsonb_build_object('version','atlas-weekly-capacity-v2','scope','SHARED','unit','CARDS','timeZone','America/Los_Angeles','resetLocalTime','00:01',
  'asOf',to_char(instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'weekStartsAt',to_char(starts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'resetsAt',to_char(ends AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'total',jsonb_build_object('state',CASE WHEN quota IS NULL THEN 'NOT_CONFIGURED' WHEN quota-held-accepted>0 THEN 'AVAILABLE' ELSE 'FULL' END,
   'quotaCards',quota,'heldCards',CASE WHEN quota IS NULL THEN NULL ELSE held END,
   'acceptedCards',CASE WHEN quota IS NULL THEN NULL ELSE accepted END,
   'remainingCards',CASE WHEN quota IS NULL THEN NULL ELSE quota-held-accepted END),'pools',pools);
END $function$;

CREATE OR REPLACE FUNCTION atlas_customer.weekly_capacity_week(instant timestamp with time zone)
 RETURNS TABLE("weekStartsAt" timestamp with time zone, "resetsAt" timestamp with time zone)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT start_local AT TIME ZONE 'America/Los_Angeles', (start_local+interval '7 days') AT TIME ZONE 'America/Los_Angeles'
 FROM (SELECT date_trunc('week',(instant AT TIME ZONE 'America/Los_Angeles')-interval '1 minute')+interval '1 minute' start_local) s
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.card_tracking(cid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('cardId',c.card_id,'identity',c.paid_line->'identity','channel',c.channel,
 'originalSchedule',c.location_snapshot->'schedule','originalLocation',c.location_snapshot->>'name',
 'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'occurredAt',e.occurred_at,'recordedAt',e.recorded_at,
   'note',CASE WHEN e.kind IN ('DELAY_REPORTED','DELAY_RESOLVED') THEN e.evidence->>'note' END,
   'expectedReturnAt',CASE WHEN e.kind='DELAY_REPORTED' THEN e.evidence->>'expectedReturnAt' END) ORDER BY e.sequence)
   FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id),'[]'::jsonb),
 'grading',CASE WHEN a.approved_at IS NOT NULL THEN 'HUMAN_APPROVED' WHEN l.manual_card_id IS NOT NULL THEN 'IN_GRADING' ELSE 'NOT_STARTED' END,
 'approvedAt',a.approved_at,'reportUrl',(SELECT '/reports/'||i.public_token||'?v='||p.version FROM atlas_manual.public_report_identity i JOIN atlas_manual.publication p ON p.card_id=i.card_id WHERE i.card_id=l.manual_card_id AND p.action_id=a.action_id AND p.state='PUBLISHED' LIMIT 1),
 'collectedAt',col.occurred_at,
 'turnaroundTarget',CASE WHEN col.occurred_at IS NOT NULL THEN ((col.occurred_at AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone'))+interval '7 days') AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone') END,
 'currentSchedule',CASE WHEN c.channel='KIOSK' THEN loc.schedule END,
 'currentProjection',CASE WHEN c.channel='KIOSK' AND col.occurred_at IS NULL THEN atlas_dealer.projection(loc.schedule,clock_timestamp())
 WHEN c.channel='KIOSK' THEN jsonb_build_object('nextCollection',NULL,'projectedReturn',atlas_dealer.next_slot(loc.schedule,'returns',((col.occurred_at AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone'))+interval '7 days') AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone'),false)) END,
 'scheduleChanged',CASE WHEN c.channel='KIOSK' THEN loc.revision<>(c.location_snapshot->>'revision')::integer ELSE false END)
 FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.location loc ON loc.id=c.location_id
 LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id
 LEFT JOIN LATERAL(SELECT approved_at,action_id FROM atlas_manual.approval WHERE card_id=l.manual_card_id ORDER BY approved_at DESC LIMIT 1) a ON true
 LEFT JOIN LATERAL(SELECT occurred_at FROM atlas_dealer.custody_event WHERE card_id=c.card_id AND kind='COLLECTED' ORDER BY sequence LIMIT 1) col ON true
 WHERE c.card_id=cid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.card_tracking_with_handoff(cid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT atlas_dealer.card_tracking(cid) || CASE WHEN r.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('dealerReceivedAt',r.received_at,
 'events',(SELECT jsonb_agg(e ORDER BY (e->>'occurredAt')::timestamptz,e->>'id') FROM jsonb_array_elements(
   COALESCE(atlas_dealer.card_tracking(cid)->'events','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',r.id,'kind','DEALER_RECEIVED','occurredAt',r.received_at,'recordedAt',r.received_at))) e)) END
 FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.handoff h ON h.order_id=c.order_id
 LEFT JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id AND cid=ANY(r.card_ids) WHERE c.card_id=cid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.customer_call(action text, account_id uuid, control_revision integer, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE m atlas_dealer.membership; s atlas_dealer.session; av integer; latest jsonb; order_row record; cursor_row record; orders jsonb:='[]'::jsonb; next_cursor uuid; row_count integer:=0;
BEGIN
 IF action='dealer_locations' THEN RETURN atlas_dealer.directory(clock_timestamp(),d->>'entry'); END IF;
 IF action='dealer_orders' THEN
  IF account_id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  IF d->>'cursor' IS NOT NULL THEN
   SELECT id,"paidAt" INTO cursor_row FROM atlas_customer."CommerceOrder" WHERE id=(d->>'cursor')::uuid AND "accountId"=account_id;
   IF cursor_row.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  ELSE SELECT NULL::uuid id,NULL::timestamptz AS "paidAt" INTO cursor_row; END IF;
  FOR order_row IN SELECT o.id,o.reference,o."paidAt",count(c.card_id) AS card_count,min(c.channel) AS channel
   FROM atlas_customer."CommerceOrder" o JOIN atlas_dealer.order_card c ON c.order_id=o.id WHERE o."accountId"=account_id
   AND (cursor_row.id IS NULL OR (o."paidAt",o.id)<(cursor_row."paidAt",cursor_row.id)) GROUP BY o.id ORDER BY o."paidAt" DESC,o.id DESC LIMIT 21 LOOP
   row_count:=row_count+1; IF row_count=21 THEN EXIT; END IF;
   orders:=orders||jsonb_build_array(jsonb_build_object('id',order_row.id,'reference',order_row.reference,'paidAt',order_row."paidAt",'cardCount',order_row.card_count,'channel',order_row.channel)); next_cursor:=order_row.id;
  END LOOP;
  RETURN jsonb_build_object('orders',orders,'nextCursor',CASE WHEN row_count=21 THEN next_cursor ELSE NULL END);
 END IF;
 IF action='dealer_tracking' THEN
  latest:=atlas_dealer.customer_tracking(account_id,(d->>'orderId')::uuid);
  RETURN COALESCE(latest,atlas_customer.problem(404,'NOT_FOUND'));
 END IF;
 IF action='dealer_deposit' THEN RETURN atlas_dealer.declare_deposit(account_id,d); END IF;
 IF action='dealer_memberships' THEN
  IF account_id IS NULL OR NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=account_id AND "revokedAt" IS NULL) THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN jsonb_build_object('memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('locationId',l.id,'name',l.name) ORDER BY l.name,l.id)
   FROM atlas_dealer.membership member_row JOIN atlas_dealer.location l ON l.id=member_row.location_id WHERE member_row.account_id=customer_call.account_id AND member_row.revoked_at IS NULL),'[]'::jsonb));
 END IF;
 IF action='dealer_enter' THEN
  SELECT * INTO m FROM atlas_dealer.membership WHERE membership.account_id=customer_call.account_id AND location_id=(d->>'locationId')::uuid AND revoked_at IS NULL FOR SHARE;
  SELECT "accessVersion" INTO av FROM atlas_customer."CustomerAccount" WHERE id=account_id AND "revokedAt" IS NULL FOR SHARE;
  IF m.id IS NULL OR av IS NULL THEN RETURN atlas_customer.problem(403,'DEALER_MEMBERSHIP_REQUIRED'); END IF;
  INSERT INTO atlas_dealer.session(token_hash,browser_hash,membership_id,membership_version,account_version,control_revision,expires_at)
   VALUES(d->>'dealerSessionHash',d->>'browserHash',m.id,m.version,av,control_revision,clock_timestamp()+interval '8 hours');
 ELSE
  SELECT * INTO s FROM atlas_dealer.session WHERE token_hash=d->>'dealerSessionHash' AND browser_hash=d->>'browserHash'
   AND revoked_at IS NULL AND expires_at>clock_timestamp() AND session.control_revision=customer_call.control_revision FOR SHARE;
  SELECT * INTO m FROM atlas_dealer.membership WHERE id=s.membership_id AND version=s.membership_version AND revoked_at IS NULL FOR SHARE;
  IF m.id IS NULL OR NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=m.account_id AND "accessVersion"=s.account_version AND "revokedAt" IS NULL) THEN RETURN atlas_customer.problem(401,'DEALER_SIGN_IN_REQUIRED'); END IF;
  IF action='dealer_logout' THEN UPDATE atlas_dealer.session SET revoked_at=clock_timestamp() WHERE token_hash=s.token_hash; RETURN '{"signedOut":true}'::jsonb; END IF;
  IF action<>'dealer_read' THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
 END IF;
 RETURN jsonb_build_object('location',(SELECT jsonb_build_object('id',id,'name',name,'enabled',enabled,'schedule',schedule) FROM atlas_dealer.location WHERE id=m.location_id),
  'customerCount',(SELECT count(DISTINCT o."accountId") FROM atlas_customer."CommerceOrder" o JOIN atlas_dealer.order_card c ON c.order_id=o.id WHERE c.location_id=m.location_id),
  'orderCount',(SELECT count(DISTINCT order_id) FROM atlas_dealer.order_card WHERE location_id=m.location_id),
  'cardCount',(SELECT count(*) FROM atlas_dealer.order_card WHERE location_id=m.location_id),
  'commission',jsonb_build_object('currency','USD','accruedCents',(SELECT COALESCE(sum(e.amount_cents),0) FROM atlas_dealer.commission_event e JOIN atlas_dealer.order_card c ON c.card_id=e.card_id WHERE c.location_id=m.location_id AND e.kind='ACCRUED'),
   'reversedCents',(SELECT -COALESCE(sum(e.amount_cents),0) FROM atlas_dealer.commission_event e JOIN atlas_dealer.order_card c ON c.card_id=e.card_id WHERE c.location_id=m.location_id AND e.kind='REVERSED'),
   'transferStatus','NO_TRANSFER_RECORDED'),
  'orders',COALESCE((SELECT jsonb_agg(jsonb_build_object('reference',q.reference,'paidAt',q."paidAt",'cardCount',q.n,'cards',q.cards) ORDER BY q."paidAt" DESC)
   FROM(SELECT o.reference,o."paidAt",count(*) n,jsonb_agg(jsonb_build_object('cardId',c.card_id,'grading',CASE WHEN a.approved THEN 'HUMAN_APPROVED' WHEN l.manual_card_id IS NOT NULL THEN 'IN_GRADING' ELSE 'NOT_STARTED' END,
    'custody',e.kind,'occurredAt',e.occurred_at) ORDER BY c.card_id) cards
    FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id
    LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id
    LEFT JOIN LATERAL(SELECT true approved FROM atlas_manual.approval WHERE card_id=l.manual_card_id LIMIT 1) a ON true
    LEFT JOIN LATERAL(SELECT kind,occurred_at FROM atlas_dealer.custody_event WHERE card_id=c.card_id ORDER BY sequence DESC LIMIT 1) e ON true
    WHERE c.location_id=m.location_id GROUP BY o.id ORDER BY o."paidAt" DESC LIMIT 100)q),'[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.customer_tracking(account_id uuid, oid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('orderId',o.id,'reference',o.reference,'cards',COALESCE((SELECT jsonb_agg(atlas_dealer.card_tracking_with_handoff(c.card_id) ORDER BY c.card_id)
 FROM atlas_dealer.order_card c WHERE c.order_id=o.id),'[]'::jsonb),'handoff',(SELECT atlas_dealer.handoff_projection(h.id) FROM atlas_dealer.handoff h WHERE h.order_id=o.id))
 FROM atlas_customer."CommerceOrder" o WHERE o.id=oid AND o."accountId"=account_id
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.declare_deposit(account_id uuid, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE prior atlas_dealer.custody_event;
BEGIN
 SELECT e.* INTO prior FROM atlas_dealer.custody_event e JOIN atlas_dealer.order_card c ON c.card_id=e.card_id JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id
 WHERE o."accountId"=account_id AND o.id=(d->>'orderId')::uuid AND c.card_id=(d->>'cardId')::uuid AND e.request_id=(d->>'requestId')::uuid AND e.customer_id=account_id;
 IF prior.id IS NOT NULL THEN
  IF prior.input_hash<>atlas_customer.commerce_hash(d-ARRAY['sessionHash','browserHash']) THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
  RETURN jsonb_build_object('eventId',prior.id);
 END IF;
 RETURN atlas_customer.problem(409,'STAFF_HANDOFF_REQUIRED');
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.directory(at_time timestamp with time zone, entry text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('locations',COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'address',address,'revision',revision,
 'position',jsonb_build_object('lat',latitude,'lng',longitude),'timeZone',schedule->>'timeZone','schedule',schedule,
 'priceCents',5000,'shippingCents',0,'turnaroundDays',7,'clockStart','ATLAS_COLLECTION','entryUrl','/account/submit?kiosk='||entry_token,'directionsUrl','https://www.google.com/maps/dir/?api=1&destination='||latitude||','||longitude,'mapEmbedUrl','https://maps.google.com/maps?q='||latitude||','||longitude||'&z=14&output=embed')
 ||atlas_dealer.projection(schedule,at_time) ORDER BY name,id),'[]'::jsonb),
 'resolvedLocationId',max(CASE WHEN entry_token=entry THEN id::text END))
 FROM atlas_dealer.location WHERE enabled AND authorized_until>at_time AND atlas_dealer.projection(schedule,at_time)->>'projectedReturn' IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.handoff_dealer_call(action text, control_revision integer, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE s atlas_dealer.session; m atlas_dealer.membership; h atlas_dealer.handoff; r atlas_dealer.handoff_receipt; ids uuid[]; exact_ids uuid[]; ih text; lock_id uuid; now_time timestamptz;
BEGIN
 -- This duplicates no authentication system: it applies the existing dealer session contract.
 SELECT * INTO s FROM atlas_dealer.session WHERE token_hash=d->>'dealerSessionHash' AND browser_hash=d->>'browserHash'
 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND session.control_revision=handoff_dealer_call.control_revision FOR SHARE;
 SELECT * INTO m FROM atlas_dealer.membership WHERE id=s.membership_id AND version=s.membership_version AND revoked_at IS NULL FOR SHARE;
 IF m.id IS NULL THEN RETURN atlas_customer.problem(401,'DEALER_SIGN_IN_REQUIRED'); END IF;
 PERFORM 1 FROM atlas_customer."CustomerAccount" WHERE id=m.account_id AND "accessVersion"=s.account_version AND "revokedAt" IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN atlas_customer.problem(401,'DEALER_SIGN_IN_REQUIRED'); END IF;
 PERFORM 1 FROM atlas_dealer.location WHERE id=m.location_id AND enabled AND authorized_until>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RETURN atlas_customer.problem(403,'DEALER_LOCATION_UNAVAILABLE'); END IF;
 SELECT * INTO h FROM atlas_dealer.handoff WHERE id=(d->>'handoffId')::uuid AND location_id=m.location_id;
 IF h.id IS NULL THEN RETURN atlas_customer.problem(404,'HANDOFF_NOT_FOUND'); END IF;
 -- Serialize different scans and request IDs against the actual immutable paid order.
 SELECT id INTO lock_id FROM atlas_customer."CommerceOrder" WHERE id=h.order_id AND "accountId"=h.account_id FOR UPDATE;
 IF lock_id IS NULL OR NOT EXISTS(SELECT 1 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId"
 WHERE o.id=h.order_id AND p.state='PAID' AND p."providerId" IS NOT NULL AND p."accountId"=h.account_id) THEN RETURN atlas_customer.problem(409,'CONFIRMED_PAYMENT_REQUIRED'); END IF;
 IF action='dealer_handoff_read' THEN RETURN jsonb_build_object('handoff',atlas_dealer.handoff_projection(h.id,true)); END IF;
 IF action<>'dealer_handoff_confirm' THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
 IF jsonb_typeof(d->'cardIds') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'cardIds') NOT BETWEEN 1 AND 100
 OR COALESCE(d->>'confirmedCount','')!~'^[1-9][0-9]{0,2}$' OR (d->>'requestId') IS NULL THEN RETURN atlas_customer.problem(400,'ALL_CARDS_CONFIRMATION_REQUIRED'); END IF;
 SELECT array_agg(v::uuid ORDER BY v::uuid) INTO ids FROM jsonb_array_elements_text(d->'cardIds') v;
 SELECT array_agg(c.card_id ORDER BY c.card_id) INTO exact_ids FROM atlas_dealer.order_card c WHERE c.order_id=h.order_id AND c.location_id=h.location_id AND c.channel='KIOSK';
 IF ids IS DISTINCT FROM h.card_ids OR ids IS DISTINCT FROM exact_ids OR (d->>'confirmedCount')::integer<>cardinality(h.card_ids) THEN RETURN atlas_customer.problem(409,'HANDOFF_CARD_COUNT_MISMATCH'); END IF;
 ih:=atlas_customer.commerce_hash(jsonb_build_object('handoffId',h.id,'cardIds',ids,'confirmedCount',cardinality(ids)));
 SELECT * INTO r FROM atlas_dealer.handoff_receipt WHERE request_id=(d->>'requestId')::uuid;
 IF r.id IS NOT NULL AND (r.handoff_id<>h.id OR r.input_hash<>ih OR r.dealer_account_id<>m.account_id) THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
 SELECT * INTO r FROM atlas_dealer.handoff_receipt WHERE handoff_id=h.id;
 IF r.id IS NOT NULL THEN RETURN jsonb_build_object('handoff',atlas_dealer.handoff_projection(h.id,true)); END IF;
 -- Lock exact cards before checking progress against the existing staff custody writer.
 PERFORM 1 FROM atlas_dealer.order_card WHERE card_id=ANY(ids) ORDER BY card_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM atlas_dealer.custody_event WHERE card_id=ANY(ids) AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED')) THEN RETURN atlas_customer.problem(409,'HANDOFF_ALREADY_ADVANCED'); END IF;
 now_time:=clock_timestamp();
 INSERT INTO atlas_dealer.handoff_receipt(handoff_id,request_id,input_hash,membership_id,membership_version,dealer_account_id,location_id,card_ids,received_at)
 VALUES(h.id,(d->>'requestId')::uuid,ih,m.id,m.version,m.account_id,m.location_id,ids,now_time) RETURNING * INTO r;
 RETURN jsonb_build_object('handoff',atlas_dealer.handoff_projection(h.id,true));
EXCEPTION WHEN invalid_text_representation THEN RETURN atlas_customer.problem(400,'INVALID_HANDOFF');
 WHEN unique_violation THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT');
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.handoff_projection(hid uuid, include_cards boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('id',h.id,'orderId',h.order_id,'reference',o.reference,
  'location',jsonb_build_object('id',h.location_id,'name',l.name),'cardCount',cardinality(h.card_ids),
  'status',CASE WHEN r.id IS NULL THEN 'AWAITING_SHOP_RECEIPT' ELSE 'RECEIVED' END,
  'receipt',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'receivedAt',r.received_at,'cardCount',cardinality(r.card_ids)) END)
  ||CASE WHEN include_cards THEN jsonb_build_object('cards',(SELECT jsonb_agg(jsonb_build_object('cardId',c.card_id,'identity',c.paid_line->'identity') ORDER BY c.card_id)
    FROM atlas_dealer.order_card c WHERE c.order_id=h.order_id AND c.card_id=ANY(h.card_ids))) ELSE '{}'::jsonb END
 FROM atlas_dealer.handoff h JOIN atlas_customer."CommerceOrder" o ON o.id=h.order_id
 JOIN atlas_dealer.location l ON l.id=h.location_id LEFT JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id WHERE h.id=hid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
 BEGIN RAISE EXCEPTION 'ATLAS dealer evidence is immutable'; END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.issue_handoff(aid uuid, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE o atlas_customer."CommerceOrder"; p atlas_customer."CommercePayment"; h atlas_dealer.handoff; ids uuid[]; lid uuid; locations integer; channels text[];
BEGIN
 SELECT * INTO o FROM atlas_customer."CommerceOrder" WHERE id=(d->>'orderId')::uuid AND "accountId"=aid FOR UPDATE;
 IF o.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 SELECT * INTO p FROM atlas_customer."CommercePayment" WHERE id=o."paymentId" FOR SHARE;
 IF p.state IS DISTINCT FROM 'PAID' OR p."providerId" IS NULL OR p."accountId"<>aid THEN RETURN atlas_customer.problem(409,'CONFIRMED_PAYMENT_REQUIRED'); END IF;
 SELECT * INTO h FROM atlas_dealer.handoff WHERE order_id=o.id;
 IF h.id IS NOT NULL THEN RETURN jsonb_build_object('handoff',atlas_dealer.handoff_projection(h.id)); END IF;
 SELECT array_agg(c.card_id ORDER BY c.card_id),count(DISTINCT c.location_id),array_agg(DISTINCT c.channel) INTO ids,locations,channels
 FROM atlas_dealer.order_card c WHERE c.order_id=o.id;
 SELECT c.location_id INTO lid FROM atlas_dealer.order_card c WHERE c.order_id=o.id LIMIT 1;
 IF cardinality(ids) NOT BETWEEN 1 AND 100 OR cardinality(ids) IS NULL OR locations<>1 OR channels IS DISTINCT FROM ARRAY['KIOSK']::text[] THEN RETURN atlas_customer.problem(409,'SHOP_HANDOFF_NOT_AVAILABLE'); END IF;
 IF EXISTS(SELECT 1 FROM atlas_dealer.custody_event WHERE card_id=ANY(ids) AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED')) THEN RETURN atlas_customer.problem(409,'HANDOFF_ALREADY_ADVANCED'); END IF;
 INSERT INTO atlas_dealer.handoff(order_id,account_id,location_id,card_ids) VALUES(o.id,aid,lid,ids) RETURNING * INTO h;
 RETURN jsonb_build_object('handoff',atlas_dealer.handoff_projection(h.id));
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.location_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Location history is retained'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.dealer_id<>OLD.dealer_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Location revision conflict'; END IF;
 IF NOT NEW.address ?& ARRAY['line1','city','region','postalCode','country'] OR NEW.address-ARRAY['line1','city','region','postalCode','country']<>'{}'::jsonb
 OR EXISTS(SELECT 1 FROM jsonb_each(NEW.address) e WHERE jsonb_typeof(e.value)<>'string' OR length(NEW.address->>e.key) NOT BETWEEN 1 AND 180 OR NEW.address->>e.key ~ '[[:cntrl:]]')
 OR NEW.terminal_id IS NOT NULL AND length(NEW.terminal_id) NOT BETWEEN 1 AND 160
 OR NEW.terminal_location_id IS NOT NULL AND length(NEW.terminal_location_id) NOT BETWEEN 1 AND 160
 OR NEW.package_printer_id IS NOT NULL AND length(NEW.package_printer_id) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Incomplete shop configuration'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.manual_link_discard_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 PERFORM i.id FROM atlas_manual_intake.card i WHERE i.id=NEW.manual_card_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x
   ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=NEW.manual_card_id)
   THEN RAISE EXCEPTION 'INTAKE_CARD_DELETED'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.next_cutoff(s jsonb, at_time timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE next_collection timestamptz; day date; p jsonb;
BEGIN
 next_collection:=atlas_dealer.next_slot(s,'pickups',at_time,true);
 IF next_collection IS NULL THEN RETURN NULL; END IF;
 day:=(next_collection AT TIME ZONE (s->>'timeZone'))::date;
 SELECT value INTO p FROM jsonb_array_elements(s->'exceptions') WHERE value->>'date'=day::text AND value->>'kind'='pickups';
 IF p IS NULL THEN SELECT value INTO p FROM jsonb_array_elements(s->'pickups') WHERE (value->>'weekday')::integer=extract(dow FROM day); END IF;
 RETURN (day+(p->>'cutoff')::time) AT TIME ZONE (s->>'timeZone');
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.next_slot(s jsonb, kind text, after_time timestamp with time zone, use_cutoff boolean DEFAULT false)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE day date; p jsonb; local_time timestamp; at_time timestamptz; cutoff timestamptz; i integer;
BEGIN
 IF kind NOT IN ('pickups','returns') OR NOT atlas_dealer.valid_schedule(s) THEN RETURN NULL; END IF;
 FOR i IN 0..63 LOOP
  day:=(after_time AT TIME ZONE (s->>'timeZone'))::date+i;
  SELECT value INTO p FROM jsonb_array_elements(s->'exceptions') WHERE value->>'date'=day::text AND value->>'kind'=kind;
  IF p IS NULL THEN SELECT value INTO p FROM jsonb_array_elements(s->kind) WHERE (value->>'weekday')::integer=extract(dow FROM day); END IF;
  IF p IS NULL OR COALESCE((p->>'cancelled')::boolean,false) THEN CONTINUE; END IF;
  local_time:=day+(p->>'time')::time; at_time:=local_time AT TIME ZONE (s->>'timeZone');
  -- A nonexistent DST wall time is not silently shifted into a fabricated slot.
  IF at_time AT TIME ZONE (s->>'timeZone')<>local_time THEN CONTINUE; END IF;
  cutoff:=(day+COALESCE(p->>'cutoff',p->>'time')::time) AT TIME ZONE (s->>'timeZone');
  IF at_time>=after_time AND (NOT use_cutoff OR cutoff>after_time) THEN RETURN at_time; END IF;
 END LOOP;
 RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_call(action text, session_hash text, browser_hash text, binding jsonb, phones text[], d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor record; oid uuid; cid uuid; row record; cursor_row record; item jsonb; items jsonb:='[]'; n integer:=0; lim integer; last_id uuid; q text; stage text; view_name text; counts jsonb; source jsonb;
 all_count integer:=0;new_count integer:=0;counter_key text;
 groups jsonb:='{"ARRIVAL":0,"RECEIVED":0,"GRADING_REVIEW":0,"FINISHING_PACKING":0,"RETURNING":0,"COMPLETE":0}';
 stages jsonb:='{"WAITING_FOR_ARRIVAL":0,"RECEIVED":0,"GRADING":0,"HUMAN_REVIEW":0,"FINISHING":0,"READY_FOR_RETURN":0,"RETURNING":0,"COMPLETE":0,"ATTENTION":0}';
BEGIN
 SELECT * INTO actor FROM atlas_manual.authenticate(session_hash,browser_hash,binding,phones);
 IF actor.id IS NULL OR actor.role<>'REVIEWER' THEN RETURN atlas_customer.problem(403,'STAFF_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>2048 THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
 IF action='list' THEN
  IF d-ARRAY['q','stage','view','cursor','limit']<>'{}'::jsonb OR jsonb_typeof(d->'q') IS DISTINCT FROM 'string' OR length(d->>'q')>120 OR d->>'q' ~ '[[:cntrl:]]'
  OR COALESCE(d->>'stage','') NOT IN ('','WAITING_FOR_ARRIVAL','RECEIVED','GRADING','HUMAN_REVIEW','FINISHING','READY_FOR_RETURN','RETURNING','COMPLETE','ATTENTION','ARRIVAL','GRADING_REVIEW','FINISHING_PACKING')
  OR COALESCE(d->>'view','') NOT IN ('all','new') OR jsonb_typeof(d->'limit') IS DISTINCT FROM 'number' OR NOT COALESCE(d->>'limit' ~ '^([1-9]|[1-4][0-9]|50)$',false)
  THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
  q:=btrim(d->>'q');stage:=d->>'stage';view_name:=d->>'view';lim:=(d->>'limit')::integer;
  IF d->>'cursor' IS NOT NULL THEN
   IF NOT COALESCE(d->>'cursor' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false) THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
   SELECT id,"paidAt" INTO cursor_row FROM atlas_customer."CommerceOrder" WHERE id=(d->>'cursor')::uuid AND atlas_dealer.order_desk_paid(id);
   IF cursor_row.id IS NULL THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_CURSOR'); END IF;
  ELSE SELECT NULL::uuid id,NULL::timestamptz "paidAt" INTO cursor_row; END IF;
  -- Search is literal, including percent/underscore characters; no caller SQL.
  FOR row IN SELECT o.id,o."paidAt" FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommerceQuote" cq ON cq.id=o."quoteId"
   WHERE atlas_dealer.order_desk_paid(o.id) AND (q='' OR position(lower(q) IN lower(concat_ws(' ',o.reference,o.receipt->'profile'->>'name',o.receipt->'profile'->>'email',cq.snapshot->>'phone')))>0
   OR EXISTS(SELECT 1 FROM atlas_dealer.order_card c WHERE c.order_id=o.id AND position(lower(q) IN lower(concat_ws(' ',c.paid_line->'identity'->>'title',c.paid_line->'identity'->>'playerName',c.paid_line->'identity'->>'setName',c.paid_line->'identity'->>'cardNumber')))>0))
   ORDER BY o."paidAt" DESC,o.id DESC LOOP
   item:=atlas_dealer.order_desk_summary(row.id);all_count:=all_count+1;
   IF item->'acknowledgment'='null'::jsonb THEN new_count:=new_count+1; END IF;
   IF view_name='new' AND item->'acknowledgment'<>'null'::jsonb THEN CONTINUE; END IF;
   counter_key:=item->>'group';groups:=jsonb_set(groups,ARRAY[counter_key],to_jsonb((groups->>counter_key)::integer+1));
   FOR counter_key IN SELECT jsonb_object_keys(item->'stageCounts') LOOP
    stages:=jsonb_set(stages,ARRAY[counter_key],to_jsonb(COALESCE((stages->>counter_key)::integer,0)+1));
   END LOOP;
   IF stage<>'' AND NOT (CASE WHEN stage IN ('ARRIVAL','RECEIVED','GRADING_REVIEW','FINISHING_PACKING','RETURNING','COMPLETE') THEN item->>'group'=stage ELSE item->'stageCounts' ? stage END) THEN CONTINUE; END IF;
   IF cursor_row.id IS NOT NULL AND (row."paidAt",row.id)>=(cursor_row."paidAt",cursor_row.id) THEN CONTINUE; END IF;
   n:=n+1;IF n<=lim THEN
    item:=item||jsonb_build_object('photoCards',COALESCE((SELECT jsonb_agg(jsonb_build_object('cardId',c.card_id,'title',c.paid_line->'identity'->>'title','photos',atlas_dealer.order_desk_photos(c.card_id)) ORDER BY c.card_id)
     FROM (SELECT * FROM atlas_dealer.order_card WHERE order_id=row.id ORDER BY card_id LIMIT 3)c),'[]'::jsonb));
    items:=items||jsonb_build_array(item);last_id:=row.id;
   END IF;
  END LOOP;
  counts:=jsonb_build_object('all',all_count,'new',new_count,'groups',groups,'stages',stages);
  RETURN jsonb_build_object('schemaVersion',1,'orders',items,'counts',counts,'nextCursor',CASE WHEN n>lim THEN last_id ELSE NULL END);
 END IF;
 IF action NOT IN ('detail','photo_source','label') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF NOT COALESCE(d->>'orderId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false) THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
 oid:=(d->>'orderId')::uuid;
 IF NOT atlas_dealer.order_desk_paid(oid) THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='detail' THEN
  IF d-ARRAY['orderId']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
  RETURN jsonb_build_object('schemaVersion',1,'order',atlas_dealer.order_desk_detail(oid,actor.id));
 ELSIF action='label' THEN
  IF d-ARRAY['orderId','leg']<>'{}'::jsonb OR COALESCE(d->>'leg','') NOT IN ('INBOUND','RETURN') THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
  RETURN COALESCE((SELECT jsonb_build_object('orderId',oid,'leg',d->>'leg','mimeType','application/pdf','labelBase64',e.result->>'labelBase64','labelSha256',e.result->>'labelSha256')
   FROM atlas_customer."CommerceEffect" e WHERE e."orderId"=oid AND e.request->>'leg'=d->>'leg' AND atlas_dealer.order_desk_label_valid(e) ORDER BY e."createdAt" DESC,e.id LIMIT 1),atlas_customer.problem(409,'LABEL_NOT_READY'));
 END IF;
 IF d-ARRAY['orderId','cardId','side']<>'{}'::jsonb OR NOT COALESCE(d->>'cardId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)
 OR COALESCE(d->>'side','') NOT IN ('FRONT','BACK') THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
 cid:=(d->>'cardId')::uuid;
 SELECT jsonb_build_object('orderId',oid,'uploadId',u.id,'paidPhotoPairHash',c.paid_line->>'photoPairHash','photoPairHash',atlas_dealer.order_desk_pair_hash(cid),'upload',atlas_customer.intake_upload_projection(u.id)) INTO source
 FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id
 JOIN atlas_customer."CustomerIntakeCard" ic ON ic.id=c.card_id AND ic."draftId"=o."draftId"
 JOIN atlas_customer."CustomerIntakeDraft" draft ON draft.id=ic."draftId" AND draft."accountId"=o."accountId"
 JOIN atlas_customer."CustomerIntakeUpload" u ON u."cardId"=ic.id AND u.side=d->>'side'
 WHERE c.order_id=oid AND c.card_id=cid;
 IF source IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF source->>'photoPairHash' IS NULL OR source->>'photoPairHash' IS DISTINCT FROM source->>'paidPhotoPairHash' THEN RETURN atlas_customer.problem(409,'ORDER_PHOTO_BINDING_CHANGED'); END IF;
 RETURN source;
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_card_state(cid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 WITH facts AS (
 SELECT c.card_id,c.channel,l.manual_card_id,cu.kind custody,a.action_id,a.approved_at,b.state batch_state,b.stage batch_stage,b.code batch_code,
 EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=l.manual_card_id) discarded,
 (SELECT e.kind='DELAY_REPORTED' FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id AND e.kind IN ('DELAY_REPORTED','DELAY_RESOLVED') ORDER BY e.sequence DESC LIMIT 1) delayed
 FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id
 LEFT JOIN atlas_manual.card m ON m.id=l.manual_card_id
 LEFT JOIN LATERAL(SELECT kind FROM atlas_dealer.custody_event WHERE card_id=c.card_id AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED') ORDER BY sequence DESC LIMIT 1) cu ON true
 LEFT JOIN LATERAL(SELECT action_id,approved_at FROM atlas_manual.approval WHERE card_id=l.manual_card_id ORDER BY approved_at DESC,action_id DESC LIMIT 1) a ON true
 LEFT JOIN LATERAL(SELECT state,stage,code FROM atlas_manual_connected.batch_grading WHERE card_id=l.manual_card_id AND source_hash=m.content::jsonb#>>'{source,sourceHash}' ORDER BY created_at DESC,key LIMIT 1) b ON true
 WHERE c.card_id=cid), progress AS (
 SELECT *,CASE WHEN custody IN ('CUSTOMER_DELIVERED','CUSTOMER_COLLECTED') THEN 'COMPLETE'
 WHEN custody IN ('RETURN_DISPATCHED','RETURNED_TO_KIOSK','MAIL_DISPATCHED') THEN 'RETURNING'
 WHEN custody IS DISTINCT FROM 'ATLAS_RECEIVED' THEN 'WAITING_FOR_ARRIVAL'
 WHEN action_id IS NOT NULL THEN 'FINISHING'
 WHEN manual_card_id IS NULL THEN 'RECEIVED'
 WHEN batch_state='REVIEW' THEN 'HUMAN_REVIEW' ELSE 'GRADING' END progress_stage FROM facts)
 SELECT jsonb_build_object('stage',CASE WHEN discarded OR (batch_state='NEEDS_ATTENTION' AND progress_stage NOT IN ('FINISHING','RETURNING','COMPLETE')) THEN 'ATTENTION' ELSE progress_stage END,
 'progressStage',progress_stage,'attention',COALESCE(delayed,false) OR discarded OR COALESCE(batch_state='NEEDS_ATTENTION',false),
 'custody',custody,'manualCardId',manual_card_id,'approvedAt',approved_at,'approvalActionId',action_id,
 'grading',jsonb_build_object('state',CASE WHEN action_id IS NOT NULL THEN 'HUMAN_APPROVED' WHEN manual_card_id IS NULL THEN 'NOT_STARTED' WHEN batch_state='REVIEW' THEN 'HUMAN_REVIEW' ELSE 'IN_GRADING' END,
 'batchState',batch_state,'batchStage',batch_stage,'code',batch_code,'discarded',discarded)) FROM progress
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_detail(oid uuid, actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT atlas_dealer.order_desk_summary(o.id)||jsonb_build_object(
 'customer',jsonb_build_object('name',o.receipt->'profile'->>'name','email',o.receipt->'profile'->>'email','phone',q.snapshot->>'phone',
 'returnAddress',atlas_customer.commerce_public_fields(o.receipt->'profile',ARRAY['name','address1','address2','city','region','postalCode','country'])),
 'payments',jsonb_build_object('grading',jsonb_build_object('state','PAID','paidAt',o."paidAt",'receipt',atlas_customer.commerce_public_quote(o.receipt)),
 'shipping',jsonb_build_object('state',atlas_dealer.order_desk_summary(o.id)->'shippingPayment'->>'state','paidAt',sr."paidAt",'receipt',CASE WHEN sr.id IS NULL THEN NULL ELSE atlas_customer.commerce_public_quote(sr.receipt) END)),
 'shipping',jsonb_build_object('inbound',atlas_dealer.order_desk_shipping(o.id,'INBOUND'),'return',atlas_dealer.order_desk_shipping(o.id,'RETURN')),
 'returnShipping',atlas_dealer.order_desk_shipping(o.id,'RETURN'),
 'cards',COALESCE((SELECT jsonb_agg(atlas_dealer.card_tracking_with_handoff(c.card_id)||atlas_dealer.order_desk_card_state(c.card_id)||jsonb_build_object(
 'orderId',c.order_id,'locationId',c.location_id,'identitySource',ic."identitySource",'photos',atlas_dealer.order_desk_photos(c.card_id),
 'staffEvidence',jsonb_build_object('manualCardId',l.manual_card_id,'provenance','STAFF_GRADING_CAPTURE'),
 'finishing',jsonb_build_object('label','NOT_RECORDED','assembly','NOT_RECORDED','welding','NOT_RECORDED','packing','NOT_RECORDED',
 'nfc',CASE WHEN EXISTS(SELECT 1 FROM atlas_manual_connected.station_arm arm JOIN atlas_manual_connected.station_receipt r USING(intent_id)
 WHERE arm.card_id=l.manual_card_id AND arm.approval_action_id=(atlas_dealer.order_desk_card_state(c.card_id)->>'approvalActionId')::uuid
 AND r.kind='WRITE' AND r.receipt::jsonb->>'readbackVerified'='true' AND r.receipt::jsonb->>'lockVerified'='true') THEN 'VERIFIED' ELSE 'NOT_RECORDED' END),
 'custodyEvents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'requestId',e.request_id,'kind',e.kind,'occurredAt',e.occurred_at,'recordedAt',e.recorded_at,'evidence',e.evidence,'actorId',e.actor_id) ORDER BY e.sequence) FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id),'[]'::jsonb)) ORDER BY c.card_id)
 FROM atlas_dealer.order_card c JOIN atlas_customer."CustomerIntakeCard" ic ON ic.id=c.card_id LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id WHERE c.order_id=o.id),'[]'::jsonb),
 'manualCards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'revision',m.revision) ORDER BY m.updated_at DESC,m.id) FROM
 (SELECT id,revision,updated_at FROM atlas_manual.card c WHERE (owner_id=actor OR actor=ANY(editors))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=c.id)
 AND NOT EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link WHERE manual_card_id=c.id) ORDER BY updated_at DESC,id LIMIT 100)m),'[]'::jsonb),
 'history',COALESCE((SELECT jsonb_agg(e ORDER BY e->>'occurredAt',e->>'id') FROM (
 SELECT jsonb_build_object('id','payment:'||o.id,'kind','GRADING_PAYMENT_CONFIRMED','occurredAt',o."paidAt",'recordedAt',o."paidAt",'cardId',NULL,'actor',NULL,'note',NULL) e
 UNION ALL SELECT jsonb_build_object('id','shipping:'||sr.id,'kind','SHIPPING_PAYMENT_CONFIRMED','occurredAt',sr."paidAt",'recordedAt',sr."paidAt",'cardId',NULL,'actor',NULL,'note',NULL) WHERE sr.id IS NOT NULL
 UNION ALL SELECT jsonb_build_object('id','ack:'||ak.order_id,'kind','ORDER_ACKNOWLEDGED','occurredAt',ak.acknowledged_at,'recordedAt',ak.acknowledged_at,'cardId',NULL,'actor',atlas_dealer.order_inbox_acknowledgment_projection(o.id)->'acknowledgedBy','note',NULL) FROM atlas_dealer.order_inbox_acknowledgment ak WHERE ak.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id',ce.id,'kind',ce.kind,'occurredAt',ce.occurred_at,'recordedAt',ce.recorded_at,'cardId',ce.card_id,'actor',CASE WHEN si.id IS NULL THEN NULL ELSE jsonb_build_object('id',si.id,'name',si.name) END,'note',ce.evidence->>'note')
 FROM atlas_dealer.custody_event ce JOIN atlas_dealer.order_card c ON c.card_id=ce.card_id LEFT JOIN atlas_staff."StaffIdentity" si ON si.id=ce.actor_id WHERE c.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id','link:'||l.card_id,'kind','GRADING_CARD_LINKED','occurredAt',l.linked_at,'recordedAt',l.linked_at,'cardId',l.card_id,'actor',jsonb_build_object('id',si.id,'name',si.name),'note',l.evidence_ref)
 FROM atlas_dealer.manual_card_link l JOIN atlas_dealer.order_card c ON c.card_id=l.card_id JOIN atlas_staff."StaffIdentity" si ON si.id=l.actor_id WHERE c.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id','approval:'||a.action_id,'kind','REPORT_HUMAN_APPROVED','occurredAt',a.approved_at,'recordedAt',a.approved_at,'cardId',l.card_id,'actor',jsonb_build_object('id',si.id,'name',si.name),'note',NULL)
 FROM atlas_dealer.manual_card_link l JOIN atlas_dealer.order_card c ON c.card_id=l.card_id JOIN atlas_manual.approval a ON a.card_id=l.manual_card_id JOIN atlas_staff."StaffIdentity" si ON si.id=a.actor_id WHERE c.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id','handoff:'||r.id,'kind','DEALER_RECEIVED','occurredAt',r.received_at,'recordedAt',r.received_at,'cardId',NULL,'actor',NULL,'note',NULL)
 FROM atlas_dealer.handoff h JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id WHERE h.order_id=o.id
 ) history),'[]'::jsonb))
 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommerceQuote" q ON q.id=o."quoteId" LEFT JOIN atlas_customer."CommerceShippingReceipt" sr ON sr."orderId"=o.id WHERE o.id=oid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_group(stages jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'='WAITING_FOR_ARRIVAL') THEN 'ARRIVAL'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'='RECEIVED') THEN 'RECEIVED'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage' IN ('GRADING','HUMAN_REVIEW')) THEN 'GRADING_REVIEW'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage' IN ('FINISHING','READY_FOR_RETURN')) THEN 'FINISHING_PACKING'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'='RETURNING') THEN 'RETURNING'
 WHEN jsonb_array_length(stages)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'<>'COMPLETE') THEN 'COMPLETE' ELSE 'ARRIVAL' END
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_label_valid(e atlas_customer."CommerceEffect")
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE bytes bytea;
BEGIN
 IF e.kind NOT IN ('FEDEX_LABEL','SHIPSTATION_LABEL') OR e.state<>'SUCCEEDED'
 OR e.request->>'orderId' IS DISTINCT FROM e."orderId"::text OR COALESCE(e.request->>'leg','') NOT IN ('INBOUND','RETURN')
 OR e.id IS DISTINCT FROM (e."orderId"::text||(CASE WHEN e.kind='SHIPSTATION_LABEL' THEN ':shipstation:' ELSE ':fedex:' END)||(e.request->>'leg')||':v1')
 OR e.result->>'provider' IS DISTINCT FROM (CASE WHEN e.kind='SHIPSTATION_LABEL' THEN 'SHIPSTATION' ELSE 'FEDEX' END)
 OR e.result->>'requestHash' IS DISTINCT FROM atlas_customer.commerce_hash(e.request->'shipment')
 OR e.result->>'mimeType' IS DISTINCT FROM 'application/pdf'
 OR NOT COALESCE(length(e.result->>'labelBase64') BETWEEN 8 AND 5592408 AND e.result->>'labelBase64' ~ '^[A-Za-z0-9+/]+={0,2}$',false) THEN RETURN false; END IF;
 bytes:=decode(e.result->>'labelBase64','base64');
 RETURN octet_length(bytes)<=4194304 AND substring(bytes FROM 1 FOR 5)=convert_to('%PDF-','UTF8') AND encode(sha256(bytes),'hex')=e.result->>'labelSha256';
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_paid(oid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId"
 WHERE o.id=oid AND p.state='PAID' AND COALESCE(btrim(p."providerId"),'')<>''
 AND (p."accountId",p."draftId",p."quoteId")=(o."accountId",o."draftId",o."quoteId"))
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_pair_hash(cid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT atlas_customer.commerce_hash(jsonb_agg(jsonb_build_object('side',u.side,'plan',u.plan,'verification',u.verification) ORDER BY u.side))
 FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=cid HAVING count(*)=2 AND count(u.verification)=2
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_photos(cid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_object_agg(s.side,jsonb_build_object('state',CASE WHEN u.id IS NOT NULL AND u.verification IS NOT NULL AND u.prepared IS NOT NULL
 AND atlas_dealer.order_desk_pair_hash(c.card_id)=c.paid_line->>'photoPairHash' THEN 'READY' ELSE 'UNAVAILABLE' END,
 'uploadId',u.id,'provenance','CUSTOMER_SUBMISSION',
 'thumbnailUrl',CASE WHEN u.id IS NOT NULL AND u.verification IS NOT NULL AND u.prepared IS NOT NULL AND atlas_dealer.order_desk_pair_hash(c.card_id)=c.paid_line->>'photoPairHash'
 THEN '/api/staff/manual-connected/order-desk/orders/'||c.order_id||'/cards/'||c.card_id||'/photos/'||s.side||'?size=thumbnail' END,
 'detailUrl',CASE WHEN u.id IS NOT NULL AND u.verification IS NOT NULL AND u.prepared IS NOT NULL AND atlas_dealer.order_desk_pair_hash(c.card_id)=c.paid_line->>'photoPairHash'
 THEN '/api/staff/manual-connected/order-desk/orders/'||c.order_id||'/cards/'||c.card_id||'/photos/'||s.side||'?size=detail' END))
 FROM atlas_dealer.order_card c CROSS JOIN (VALUES('FRONT'),('BACK')) s(side)
 LEFT JOIN atlas_customer."CustomerIntakeUpload" u ON u."cardId"=c.card_id AND u.side=s.side WHERE c.card_id=cid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_shipping(oid uuid, leg text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE((SELECT jsonb_build_object('state',e.state,'artifactState',CASE WHEN atlas_dealer.order_desk_label_valid(e) THEN 'READY' ELSE 'PENDING' END,
 'trackingNumber',CASE WHEN atlas_dealer.order_desk_label_valid(e) THEN e.result->>'trackingNumber' END,
 'carrierName',e.result->>'carrierName','serviceName',e.result->>'serviceName',
 'prepared',e.fulfillment IS NOT NULL,'preparedRequestId',e.fulfillment->>'requestId',
 'canPrepare',leg='RETURN' AND e.kind='SHIPSTATION_LABEL' AND e.state='PENDING' AND e.fulfillment IS NULL AND atlas_customer.commerce_return_ready(oid),
 'labelUrl',CASE WHEN atlas_dealer.order_desk_label_valid(e) THEN CASE WHEN leg='RETURN' THEN '/api/staff/manual-connected/dealer-operations/orders/'||oid||'/return-label'
 ELSE '/api/staff/manual-connected/order-desk/orders/'||oid||'/labels/INBOUND' END END)
 FROM atlas_customer."CommerceEffect" e WHERE e."orderId"=oid AND e.kind IN ('FEDEX_LABEL','SHIPSTATION_LABEL') AND e.request->>'leg'=leg
 AND e.id=oid::text||CASE WHEN e.kind='SHIPSTATION_LABEL' THEN ':shipstation:' ELSE ':fedex:' END||leg||':v1' ORDER BY e."createdAt" DESC,e.id LIMIT 1),
 jsonb_build_object('state','NOT_REQUESTED','artifactState','PENDING','trackingNumber',NULL,'prepared',false,'preparedRequestId',NULL,'canPrepare',false,'labelUrl',NULL))
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_summary(oid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 WITH facts AS (SELECT COALESCE(jsonb_agg(atlas_dealer.order_desk_card_state(card_id) ORDER BY card_id),'[]'::jsonb) states,count(*) n FROM atlas_dealer.order_card WHERE order_id=oid)
 SELECT jsonb_build_object('id',o.id,'reference',o.reference,'paidAt',o."paidAt",'channel',o.receipt->>'channel',
 'customer',jsonb_build_object('name',o.receipt->'profile'->>'name','email',o.receipt->'profile'->>'email','phone',q.snapshot->>'phone'),
 'cardCount',f.n,'stage',CASE WHEN f.n=0 THEN 'ATTENTION' WHEN (SELECT count(DISTINCT e->>'stage') FROM jsonb_array_elements(f.states) e)>1 THEN 'MIXED' ELSE f.states->0->>'stage' END,
 'mixedStages',(SELECT count(DISTINCT e->>'stage') FROM jsonb_array_elements(f.states) e)>1,'group',atlas_dealer.order_desk_group(f.states),
 'attentionCount',(SELECT count(*) FROM jsonb_array_elements(f.states) e WHERE e->>'attention'='true'),
 'stageCounts',COALESCE((SELECT jsonb_object_agg(stage,n) FROM (SELECT e->>'stage' stage,count(*) n FROM jsonb_array_elements(f.states) e GROUP BY e->>'stage') c),'{}'::jsonb),
 'acknowledgment',atlas_dealer.order_inbox_acknowledgment_projection(o.id),
 'gradingPayment',jsonb_build_object('state','PAID','currency',o.receipt->>'currency','totalCents',o.receipt->'totalCents'),
 'shippingPayment',jsonb_build_object('state',CASE WHEN o.receipt->>'channel'='KIOSK' THEN 'NOT_APPLICABLE'
 WHEN o.receipt->'terms'->>'shippingPayment'='SEPARATE_PAYMENT' THEN COALESCE(atlas_customer.commerce_shipping_public_state(o.id)->>'state','UNQUOTED_UNPAID')
 WHEN jsonb_array_length(COALESCE(o.receipt->'shipping','[]'::jsonb))>0 THEN 'INCLUDED_IN_GRADING_PAYMENT' ELSE 'NOT_RECORDED' END))
 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommerceQuote" q ON q.id=o."quoteId" CROSS JOIN facts f WHERE o.id=oid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_inbox_acknowledgment_projection(oid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('requestId',a.request_id,'acknowledgedAt',a.acknowledged_at,
  'acknowledgedBy',jsonb_build_object('id',a.actor_id,'name',i.name))
 FROM atlas_dealer.order_inbox_acknowledgment a
 JOIN atlas_staff."StaffIdentity" i ON i.id=a.actor_id WHERE a.order_id=oid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE line jsonb; loc jsonb; ch text; paid atlas_customer."CommercePayment"; q atlas_customer."CommerceQuote";
BEGIN
 SELECT * INTO paid FROM atlas_customer."CommercePayment" WHERE id=NEW."paymentId";
 SELECT * INTO q FROM atlas_customer."CommerceQuote" WHERE id=NEW."quoteId";
 IF paid.state<>'PAID' OR paid."providerId" IS NULL OR paid."accountId"<>NEW."accountId" THEN RAISE EXCEPTION 'Confirmed payment required'; END IF;
 ch:=q.snapshot->>'channel'; loc:=q.snapshot->'location';
 FOR line IN SELECT value FROM jsonb_array_elements(q.snapshot->'cards') LOOP
  IF NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerIntakeCard" c JOIN atlas_customer."CustomerIntakeDraft" d ON d.id=c."draftId"
    WHERE c.id=(line->>'cardId')::uuid AND d.id=NEW."draftId" AND d."accountId"=NEW."accountId") THEN RAISE EXCEPTION 'Paid card ownership mismatch'; END IF;
  INSERT INTO atlas_dealer.order_card(card_id,order_id,location_id,dealer_id,channel,paid_line,location_snapshot)
   VALUES((line->>'cardId')::uuid,NEW.id,(loc->>'id')::uuid,(loc->>'dealerId')::uuid,ch,line,loc);
  IF ch='KIOSK' AND (line->>'unitCents')::integer=5000 AND (line->>'commissionCents')::integer=500 THEN
   INSERT INTO atlas_dealer.commission_event(card_id,kind,amount_cents,source_ref,source) VALUES((line->>'cardId')::uuid,'ACCRUED',500,'paid:'||NEW."paymentId",
    jsonb_build_object('paymentId',NEW."paymentId",'orderId',NEW.id,'quoteId',q.id,'quoteHash',q."contentHash",'unitCents',5000,'policy','FULL_PRICE_KIOSK_500_CENTS','location',loc));
  END IF;
 END LOOP;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.projection(s jsonb, at_time timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE next_collection timestamptz; target timestamptz;
BEGIN
 next_collection:=atlas_dealer.next_slot(s,'pickups',at_time,true);
 target:=((next_collection AT TIME ZONE (s->>'timeZone'))+interval '7 days') AT TIME ZONE (s->>'timeZone');
 RETURN jsonb_build_object('nextCollection',next_collection,'projectedReturn',atlas_dealer.next_slot(s,'returns',target,false),'turnaroundTarget',target);
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.reverse_commission(card uuid, refund jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE oc atlas_dealer.order_card; paid atlas_customer."CommercePayment"; prior atlas_dealer.commission_event; amount integer; source_ref text; ih text;
BEGIN
 SELECT * INTO oc FROM atlas_dealer.order_card WHERE card_id=card FOR UPDATE;
 SELECT p.* INTO paid FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId" WHERE o.id=oc.order_id;
 amount:=(refund->>'commissionCents')::integer; source_ref:='refund:'||(refund->>'providerEventId');
 IF oc.card_id IS NULL OR paid.state<>'PAID' OR paid."providerId" IS DISTINCT FROM refund->>'paymentProviderId'
 OR COALESCE(refund->>'state','')<>'SUCCEEDED' OR length(COALESCE(refund->>'providerEventId','')) NOT BETWEEN 1 AND 180
 OR length(COALESCE(refund->>'policyReference','')) NOT BETWEEN 1 AND 300 OR COALESCE(refund->>'evidenceHash','') !~ '^[a-f0-9]{64}$'
 OR amount IS NULL OR refund->>'gradingRefundCents' IS NULL OR amount NOT BETWEEN 1 AND 500 OR (refund->>'gradingRefundCents')::integer NOT BETWEEN 1 AND 5000 THEN RETURN atlas_customer.problem(400,'VERIFIED_REFUND_EVIDENCE_REQUIRED'); END IF;
 SELECT * INTO prior FROM atlas_dealer.commission_event WHERE card_id=card AND commission_event.source_ref=reverse_commission.source_ref;
 IF prior.id IS NOT NULL THEN
  IF prior.source<>refund THEN RETURN atlas_customer.problem(409,'REFUND_EVIDENCE_CONFLICT'); END IF;
  RETURN jsonb_build_object('eventId',prior.id);
 END IF;
 IF COALESCE((SELECT sum(amount_cents) FROM atlas_dealer.commission_event WHERE card_id=card),0)<amount THEN RETURN atlas_customer.problem(409,'COMMISSION_REVERSAL_EXCEEDS_ACCRUAL'); END IF;
 INSERT INTO atlas_dealer.commission_event(card_id,kind,amount_cents,source_ref,source) VALUES(card,'REVERSED',-amount,source_ref,refund) RETURNING * INTO prior;
 RETURN jsonb_build_object('eventId',prior.id);
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.save_location_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN INSERT INTO atlas_dealer.location_revision(location_id,revision,snapshot,actor_id) VALUES(NEW.id,NEW.revision,to_jsonb(NEW),NEW.configured_by); RETURN NEW; END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.staff_call(action text, session_hash text, browser_hash text, binding jsonb, phones text[], d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor record; oc atlas_dealer.order_card; prior atlas_dealer.custody_event; latest atlas_dealer.custody_event; ev atlas_dealer.custody_event;
 ctl atlas_staff."StaffControl"; staff_session atlas_staff."StaffSession"; grant_count integer; authority_time timestamptz;
 ef atlas_customer."CommerceEffect"; ord atlas_customer."CommerceOrder"; loc atlas_dealer.location; ih text; k text; at_time timestamptz; lid uuid; m atlas_dealer.manual_card_link; saved uuid;
BEGIN
 SELECT * INTO actor FROM atlas_manual.authenticate(session_hash,browser_hash,binding,phones);
 IF actor.id IS NULL OR actor.role<>'REVIEWER' THEN RETURN atlas_customer.problem(403,'STAFF_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>16384 THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
 IF action IN ('location_configure','membership_configure') THEN
  SELECT * INTO ctl FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO staff_session FROM atlas_staff."StaffSession" WHERE "tokenHash"=session_hash AND "browserHash"=browser_hash FOR SHARE;
  authority_time:=clock_timestamp();
  IF staff_session."createdAt" AT TIME ZONE 'UTC'>authority_time OR (staff_session."createdAt" AT TIME ZONE 'UTC')+interval '5 minutes'<=authority_time THEN RETURN atlas_customer.problem(403,'FRESH_HUMAN_OPERATIONS_REQUIRED'); END IF;
  SELECT count(*) INTO grant_count FROM (SELECT g.id FROM atlas_staff."StaffOperationsGrant" g WHERE g."identityId"=actor.id
   AND g."accessVersion"=actor.access_version AND g."controlRevision"=ctl.revision AND g."revokedAt" IS NULL
   AND (g.mode,g.origin,g."deploymentId",g."releaseSha",g."configHash")=(ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash")
   AND g."createdAt" AT TIME ZONE 'UTC'<=authority_time AND g."expiresAt" AT TIME ZONE 'UTC'>authority_time FOR SHARE) grants;
  IF grant_count<>1 THEN RETURN atlas_customer.problem(403,'FRESH_HUMAN_OPERATIONS_REQUIRED'); END IF;
 END IF;
 IF action='prepare_return_label' THEN
  IF d-ARRAY['orderId','requestId']<>'{}'::jsonb OR NOT COALESCE(d->>'orderId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   AND d->>'requestId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false) THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
  SELECT o.* INTO ord FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId" AND p.state='PAID'
   WHERE o.id=(d->>'orderId')::uuid AND o.receipt->>'channel'='MAIL_IN';
  SELECT * INTO ef FROM atlas_customer."CommerceEffect" WHERE "orderId"=ord.id AND id=ord.id::text||':shipstation:RETURN:v1' AND kind='SHIPSTATION_LABEL' FOR UPDATE;
  IF ef.id IS NULL THEN RETURN atlas_customer.problem(409,'RETURN_LABEL_UNAVAILABLE'); END IF;
  IF ef.fulfillment IS NOT NULL THEN
   IF ef.fulfillment->>'requestId' IS DISTINCT FROM d->>'requestId' OR ef.fulfillment->>'actorId' IS DISTINCT FROM actor.id::text THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
   RETURN jsonb_build_object('orderId',ord.id,'requestId',ef.fulfillment->>'requestId','state',ef.state,'prepared',true);
  END IF;
  -- Same card locks as custody writes, in a stable order. This action neither
  -- claims physical dispatch nor changes the paid shipment/customer charge.
  PERFORM card_id FROM atlas_dealer.order_card WHERE order_id=ord.id ORDER BY card_id FOR UPDATE;
  IF ef.state<>'PENDING' OR NOT atlas_customer.commerce_return_ready(ord.id) THEN RETURN atlas_customer.problem(409,'RETURN_NOT_READY'); END IF;
  UPDATE atlas_customer."CommerceEffect" SET fulfillment=jsonb_build_object('requestId',d->>'requestId','actorId',actor.id,'preparedAt',clock_timestamp()),"updatedAt"=clock_timestamp() WHERE id=ef.id;
  RETURN jsonb_build_object('orderId',ord.id,'requestId',d->>'requestId','state','PENDING','prepared',true);
 END IF;
 IF action='return_label' THEN
  IF (d-ARRAY['orderId'])<>'{}'::jsonb OR NOT COALESCE(d->>'orderId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)
   THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
  RETURN COALESCE((SELECT jsonb_build_object('orderId',o.id,'leg','RETURN','mimeType',e.result->>'mimeType',
    'labelBase64',e.result->>'labelBase64','labelSha256',e.result->>'labelSha256')
   FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId" AND p.state='PAID'
   JOIN atlas_customer."CommerceEffect" e ON e."orderId"=o.id AND e.id=o.id::text||CASE WHEN e.kind='SHIPSTATION_LABEL' THEN ':shipstation:RETURN:v1' ELSE ':fedex:RETURN:v1' END
   WHERE o.id=(d->>'orderId')::uuid AND o.receipt->>'channel'='MAIL_IN' AND e.kind IN ('FEDEX_LABEL','SHIPSTATION_LABEL')
    AND e.request->>'leg'='RETURN' AND e.request->>'orderId'=o.id::text AND e.state='SUCCEEDED'
    AND e.result->>'provider'=CASE WHEN e.kind='SHIPSTATION_LABEL' THEN 'SHIPSTATION' ELSE 'FEDEX' END AND e.result->>'requestHash'=atlas_customer.commerce_hash(e.request->'shipment') AND e.result->>'mimeType'='application/pdf'
    AND length(e.result->>'labelBase64') BETWEEN 8 AND 5592408 AND e.result->>'labelSha256' ~ '^[a-f0-9]{64}$'),
   atlas_customer.problem(409,'LABEL_NOT_READY'));
 END IF;
 IF action='read' THEN
  RETURN jsonb_build_object('locations',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.name,l.id) FROM (SELECT * FROM atlas_dealer.location ORDER BY name,id LIMIT 1000) l),'[]'::jsonb),
   'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'locationId',location_id,'version',version,'revokedAt',revoked_at) ORDER BY location_id,account_id) FROM atlas_dealer.membership),'[]'::jsonb),
   'orders',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'reference',o.reference,'paidAt',o."paidAt",'returnShipping',
    (SELECT jsonb_build_object('state',e.state,'prepared',e.fulfillment IS NOT NULL,'preparedRequestId',e.fulfillment->>'requestId','canPrepare',e.kind='SHIPSTATION_LABEL' AND e.state='PENDING' AND e.fulfillment IS NULL AND atlas_customer.commerce_return_ready(o.id)) FROM atlas_customer."CommerceEffect" e
     WHERE e."orderId"=o.id AND e.id=o.id::text||CASE WHEN e.kind='SHIPSTATION_LABEL' THEN ':shipstation:RETURN:v1' ELSE ':fedex:RETURN:v1' END AND e.kind IN ('FEDEX_LABEL','SHIPSTATION_LABEL') AND e.request->>'leg'='RETURN'
      AND o.receipt->>'channel'='MAIL_IN' AND EXISTS(SELECT 1 FROM atlas_customer."CommercePayment" p WHERE p.id=o."paymentId" AND p.state='PAID')), 'cards',
    (SELECT jsonb_agg(atlas_dealer.card_tracking(c.card_id)||jsonb_build_object('orderId',c.order_id,'locationId',c.location_id,'manualCardId',l.manual_card_id,'custodyEvents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'requestId',e.request_id,'kind',e.kind,'occurredAt',e.occurred_at,'evidence',e.evidence,'actorId',e.actor_id) ORDER BY e.sequence) FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id),'[]'::jsonb)) ORDER BY c.card_id)
     FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id WHERE c.order_id=o.id)) ORDER BY o."paidAt" DESC)
    FROM(SELECT id,reference,"paidAt",receipt,"paymentId" FROM atlas_customer."CommerceOrder" ORDER BY "paidAt" DESC,id LIMIT 100)o),'[]'::jsonb),
   'manualCards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',candidate.id,'revision',candidate.revision) ORDER BY candidate.updated_at DESC)
    FROM(SELECT id,revision,updated_at FROM atlas_manual.card c WHERE (owner_id=actor.id OR actor.id=ANY(editors))
      AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=c.id)
      AND NOT EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link WHERE manual_card_id=c.id) ORDER BY updated_at DESC LIMIT 100)candidate),'[]'::jsonb));
 ELSIF action='location_configure' THEN
  lid:=(d->>'id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-location:'||lid,0));
  SELECT * INTO loc FROM atlas_dealer.location WHERE id=lid FOR UPDATE;
  IF loc.id IS NOT NULL AND loc.revision IS DISTINCT FROM (d->>'expectedRevision')::integer THEN RETURN atlas_customer.problem(409,'LOCATION_REVISION_CHANGED'); END IF;
  IF NOT atlas_dealer.valid_schedule(d->'schedule') THEN RETURN atlas_customer.problem(400,'INVALID_SCHEDULE'); END IF;
  IF loc.id IS NULL THEN
   INSERT INTO atlas_dealer.location(id,dealer_id,name,address,latitude,longitude,schedule,terminal_id,terminal_location_id,package_printer_id,entry_token,authorized_until,configured_by,enabled)
   VALUES(lid,(d->>'dealerId')::uuid,d->>'name',d->'address',(d->'position'->>'lat')::numeric,(d->'position'->>'lng')::numeric,d->'schedule',d->>'terminalId',d->>'terminalLocationId',d->>'packagePrinterId',d->>'entryToken',(d->>'authorizedUntil')::timestamptz,actor.id,(d->>'enabled')::boolean);
  ELSE
   IF loc.dealer_id<>(d->>'dealerId')::uuid THEN RETURN atlas_customer.problem(409,'DEALER_BINDING_IMMUTABLE'); END IF;
   UPDATE atlas_dealer.location SET revision=revision+1,name=d->>'name',address=d->'address',latitude=(d->'position'->>'lat')::numeric,longitude=(d->'position'->>'lng')::numeric,
    schedule=d->'schedule',terminal_id=d->>'terminalId',terminal_location_id=d->>'terminalLocationId',package_printer_id=d->>'packagePrinterId',entry_token=d->>'entryToken',authorized_until=(d->>'authorizedUntil')::timestamptz,configured_by=actor.id,enabled=(d->>'enabled')::boolean WHERE id=lid;
  END IF;
  RETURN jsonb_build_object('location',atlas_customer.intake_location(lid));
 ELSIF action='membership_configure' THEN
  INSERT INTO atlas_dealer.membership(account_id,location_id,granted_by,revoked_at)
   VALUES((d->>'accountId')::uuid,(d->>'locationId')::uuid,actor.id,CASE WHEN (d->>'enabled')::boolean THEN NULL ELSE clock_timestamp() END)
   ON CONFLICT(account_id,location_id) DO UPDATE SET version=atlas_dealer.membership.version+1,granted_by=actor.id,revoked_at=EXCLUDED.revoked_at RETURNING id INTO saved;
  RETURN jsonb_build_object('membershipId',saved);
 END IF;
 SELECT * INTO oc FROM atlas_dealer.order_card WHERE card_id=(d->>'cardId')::uuid FOR UPDATE;
 IF oc.card_id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='bind_manual' THEN
  SELECT * INTO m FROM atlas_dealer.manual_card_link WHERE card_id=oc.card_id;
  IF m.card_id IS NOT NULL THEN
   IF m.manual_card_id IS DISTINCT FROM (d->>'manualCardId')::uuid THEN RETURN atlas_customer.problem(409,'MANUAL_CARD_ALREADY_BOUND'); END IF;
   RETURN jsonb_build_object('cardId',m.card_id,'manualCardId',m.manual_card_id);
  END IF;
  SELECT * INTO ev FROM atlas_dealer.custody_event WHERE card_id=oc.card_id AND kind='ATLAS_RECEIVED';
  IF ev.id IS NULL OR length(COALESCE(d->>'evidenceRef','')) NOT BETWEEN 1 AND 300
    OR NOT EXISTS(SELECT 1 FROM atlas_manual.card WHERE id=(d->>'manualCardId')::uuid AND (owner_id=actor.id OR actor.id=ANY(editors))) THEN RETURN atlas_customer.problem(409,'PHYSICAL_RECEIPT_AND_CARD_ACCESS_REQUIRED'); END IF;
  -- Lock only a real intake identity; legacy non-intake manual cards remain valid.
  -- Separate statement/check observes a discard that committed while waiting.
  PERFORM i.id FROM atlas_manual_intake.card i WHERE i.id=(d->>'manualCardId')::uuid FOR SHARE;
  IF EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x
    ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=(d->>'manualCardId')::uuid)
    THEN RETURN atlas_customer.problem(410,'INTAKE_CARD_DELETED'); END IF;
  INSERT INTO atlas_dealer.manual_card_link(card_id,manual_card_id,received_event_id,actor_id,evidence_ref)
   VALUES(oc.card_id,(d->>'manualCardId')::uuid,ev.id,actor.id,d->>'evidenceRef');
  RETURN jsonb_build_object('cardId',oc.card_id,'manualCardId',d->>'manualCardId');
 ELSIF action<>'custody_record' THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
 ih:=atlas_customer.commerce_hash(d); k:=d->>'kind';
 SELECT * INTO prior FROM atlas_dealer.custody_event WHERE card_id=oc.card_id AND request_id=(d->>'requestId')::uuid;
 IF prior.id IS NOT NULL THEN
  IF prior.input_hash IS DISTINCT FROM ih OR prior.actor_id IS DISTINCT FROM actor.id THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
  RETURN jsonb_build_object('eventId',prior.id);
 END IF;
 at_time:=(d->>'occurredAt')::timestamptz;
 IF at_time IS NULL OR at_time>clock_timestamp() OR at_time<(SELECT "paidAt" FROM atlas_customer."CommerceOrder" WHERE id=oc.order_id)
  OR jsonb_typeof(d->'evidence') IS DISTINCT FROM 'object' OR length(COALESCE(d->'evidence'->>'reference','')) NOT BETWEEN 1 AND 300
  OR (d->'evidence')-ARRAY['reference','note','expectedReturnAt']<>'{}'::jsonb OR length(COALESCE(d->'evidence'->>'note',''))>500 THEN RETURN atlas_customer.problem(400,'ACTUAL_CUSTODY_EVIDENCE_REQUIRED'); END IF;
 SELECT * INTO latest FROM atlas_dealer.custody_event WHERE card_id=oc.card_id AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED') ORDER BY sequence DESC LIMIT 1;
 IF latest.id IS NOT NULL AND at_time<latest.occurred_at THEN RETURN atlas_customer.problem(409,'CUSTODY_EVENT_ORDER'); END IF;
 IF ((k='COLLECTED' AND oc.channel='KIOSK' AND latest.id IS NULL)
  OR (k='ATLAS_RECEIVED' AND (oc.channel='MAIL_IN' AND latest.id IS NULL OR latest.kind='COLLECTED'))
  OR (k IN ('RETURN_DISPATCHED','MAIL_DISPATCHED') AND latest.kind='ATLAS_RECEIVED' AND (k='RETURN_DISPATCHED')=(oc.channel='KIOSK')
   AND EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link l JOIN atlas_manual.approval a ON a.card_id=l.manual_card_id WHERE l.card_id=oc.card_id))
  OR (k='RETURNED_TO_KIOSK' AND latest.kind='RETURN_DISPATCHED') OR (k='CUSTOMER_COLLECTED' AND latest.kind='RETURNED_TO_KIOSK')
  OR (k='CUSTOMER_DELIVERED' AND latest.kind='MAIL_DISPATCHED') OR k IN ('DELAY_REPORTED','DELAY_RESOLVED')) IS NOT TRUE THEN RETURN atlas_customer.problem(409,'CUSTODY_TRANSITION_INVALID'); END IF;
 INSERT INTO atlas_dealer.custody_event(card_id,sequence,request_id,input_hash,kind,actor_id,occurred_at,evidence)
 VALUES(oc.card_id,(SELECT COALESCE(max(sequence),0)+1 FROM atlas_dealer.custody_event WHERE card_id=oc.card_id),(d->>'requestId')::uuid,ih,k,actor.id,at_time,d->'evidence') RETURNING * INTO ev;
 RETURN jsonb_build_object('eventId',ev.id);
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.staff_order_acknowledge(session_hash text, browser_hash text, binding jsonb, phones text[], d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor record; oid uuid; rid uuid; prior atlas_dealer.order_inbox_acknowledgment; outcome text;
BEGIN
 SELECT * INTO actor FROM atlas_manual.authenticate(session_hash,browser_hash,binding,phones);
 IF actor.id IS NULL OR actor.role<>'REVIEWER' THEN RETURN atlas_customer.problem(403,'STAFF_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>256
  OR d-ARRAY['orderId','requestId']<>'{}'::jsonb
  OR jsonb_typeof(d->'orderId') IS DISTINCT FROM 'string' OR jsonb_typeof(d->'requestId') IS DISTINCT FROM 'string'
  OR (d->>'orderId') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  OR (d->>'requestId') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_ACKNOWLEDGMENT'); END IF;
 oid:=(d->>'orderId')::uuid; rid:=(d->>'requestId')::uuid;
 -- Serializing both identities makes concurrent retries and request reuse
 -- deterministic without expanding the runtime role's table privileges.
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-order-ack-request:'||rid,0));
 SELECT * INTO prior FROM atlas_dealer.order_inbox_acknowledgment WHERE request_id=rid;
 IF prior.order_id IS NOT NULL AND (prior.order_id<>oid OR prior.actor_id<>actor.id)
 THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-order-ack:'||oid,0));
 IF NOT EXISTS(SELECT 1 FROM atlas_customer."CommerceOrder" o
  JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId"
  WHERE o.id=oid AND p.state='PAID' AND COALESCE(btrim(p."providerId"),'')<>''
   AND p."accountId"=o."accountId" AND p."draftId"=o."draftId" AND p."quoteId"=o."quoteId")
 THEN RETURN atlas_customer.problem(404,'ORDER_NOT_FOUND'); END IF;
 SELECT * INTO prior FROM atlas_dealer.order_inbox_acknowledgment WHERE order_id=oid;
 IF prior.order_id IS NULL THEN
  INSERT INTO atlas_dealer.order_inbox_acknowledgment(order_id,request_id,actor_id)
  VALUES(oid,rid,actor.id) RETURNING * INTO prior;
 END IF;
 outcome:=CASE WHEN prior.request_id=rid AND prior.actor_id=actor.id THEN 'ACKNOWLEDGED' ELSE 'ALREADY_ACKNOWLEDGED' END;
 RETURN jsonb_build_object('orderId',oid,'requestId',rid,'outcome',outcome,
  'acknowledgment',atlas_dealer.order_inbox_acknowledgment_projection(oid));
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.valid_schedule(s jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE p jsonb; k text;
BEGIN
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT s ?& ARRAY['timeZone','pickups','returns','exceptions']
 OR s-ARRAY['timeZone','pickups','returns','exceptions']<>'{}'::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=s->>'timeZone') THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['pickups','returns','exceptions'] LOOP
  IF jsonb_typeof(s->k) IS DISTINCT FROM 'array' OR jsonb_array_length(s->k)>100 THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_array_length(s->'pickups')=0 OR jsonb_array_length(s->'returns')=0 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['pickups','returns'] LOOP
  FOR p IN SELECT value FROM jsonb_array_elements(s->k) LOOP
   IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR COALESCE(p->>'weekday','') !~ '^[0-6]$'
    OR COALESCE(p->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR p-ARRAY['weekday','time','cutoff']<>'{}'::jsonb THEN RETURN false; END IF;
   IF k='pickups' AND (COALESCE(p->>'cutoff','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR p->>'cutoff'>p->>'time') THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT value->>'weekday') FROM jsonb_array_elements(s->k)) THEN RETURN false; END IF;
 END LOOP;
 FOR p IN SELECT value FROM jsonb_array_elements(s->'exceptions') LOOP
  IF COALESCE(p->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' OR (p->>'date')::date::text<>p->>'date'
   OR COALESCE(p->>'kind','') NOT IN ('pickups','returns') OR jsonb_typeof(p->'cancelled') IS DISTINCT FROM 'boolean'
   OR p-ARRAY['date','kind','cancelled','time','cutoff','reason']<>'{}'::jsonb OR length(COALESCE(p->>'reason','')) NOT BETWEEN 1 AND 240 THEN RETURN false; END IF;
  IF NOT (p->>'cancelled')::boolean AND (COALESCE(p->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   OR p->>'kind'='pickups' AND (COALESCE(p->>'cutoff','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR p->>'cutoff'>p->>'time')) THEN RETURN false; END IF;
 END LOOP;
 RETURN NOT (SELECT count(*)<>count(DISTINCT (value->>'date',value->>'kind')) FROM jsonb_array_elements(s->'exceptions'));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION atlas_dealer.with_shop_receipts(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN NOT p ? 'location' THEN p ELSE p||jsonb_build_object('orders',COALESCE((
 SELECT jsonb_agg(o.value||jsonb_build_object('cards',(SELECT jsonb_agg(c.value||CASE WHEN r.id IS NULL THEN '{}'::jsonb ELSE
 jsonb_build_object('dealerReceivedAt',r.received_at)||CASE WHEN c.value->>'custody' IS NULL OR c.value->>'custody'='DEPOSIT_DECLARED'
 THEN jsonb_build_object('custody','DEALER_RECEIVED','occurredAt',r.received_at) ELSE '{}'::jsonb END END ORDER BY c.n)
 FROM jsonb_array_elements(o.value->'cards') WITH ORDINALITY c(value,n)
 LEFT JOIN atlas_dealer.order_card oc ON oc.card_id=(c.value->>'cardId')::uuid AND oc.location_id=(p->'location'->>'id')::uuid
 LEFT JOIN atlas_dealer.handoff h ON h.order_id=oc.order_id LEFT JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id AND oc.card_id=ANY(r.card_ids))) ORDER BY o.n)
 FROM jsonb_array_elements(p->'orders') WITH ORDINALITY o(value,n)),'[]'::jsonb)) END
$function$;

CREATE OR REPLACE FUNCTION atlas_defect_analysis.append_provider_event(analysis uuid, request_sha text, provider_binding text, event_kind text, event_text text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_defect_analysis'
AS $function$
DECLARE run_row atlas_defect_analysis.run%ROWTYPE; accepted atlas_defect_analysis.provider_event%ROWTYPE;
 prior atlas_defect_analysis.provider_event%ROWTYPE; payload jsonb; received timestamptz; until_time timestamptz;
BEGIN
 IF analysis IS NULL OR request_sha IS NULL OR event_kind IS NULL OR event_text IS NULL
 OR event_kind NOT IN ('ACCEPTED','ACK_ARTIFACT') OR octet_length(event_text)>16384
 THEN RAISE EXCEPTION 'Invalid background event'; END IF;
 SELECT * INTO run_row FROM atlas_defect_analysis.run WHERE id=analysis FOR UPDATE;
 IF NOT FOUND OR run_row.state<>'DISPATCHED' OR run_row.request_hash<>request_sha
 OR run_row.request_evidence::jsonb->>'version' IS DISTINCT FROM 'atlas-astra-defect-analysis-v2'
 THEN RAISE EXCEPTION 'Exact dispatched background analysis required'; END IF;
 payload:=event_text::jsonb;
 IF jsonb_typeof(payload)<>'object' OR (payload->>'responseId' ~ '^resp_[A-Za-z0-9_-]{1,180}$') IS NOT TRUE
 OR (payload->>'responseHash' ~ '^[a-f0-9]{64}$') IS NOT TRUE
 THEN RAISE EXCEPTION 'Invalid background response identity'; END IF;
 IF event_kind='ACCEPTED' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(payload))<>8
   OR NOT(payload ?& ARRAY['responseId','providerRequestId','httpStatus','providerStatus','model','responseHash','receivedAt','pollUntil'])
   OR (payload->>'providerStatus' IN ('queued','in_progress','completed','failed','incomplete','cancelled')) IS NOT TRUE
   OR payload->>'model' IS DISTINCT FROM 'gpt-6-astra'
   OR payload->>'model' IS DISTINCT FROM run_row.request_evidence::jsonb->>'model'
   OR (jsonb_typeof(payload->'httpStatus')='number' AND (payload->>'httpStatus')::int BETWEEN 200 AND 299) IS NOT TRUE
   OR NOT(payload->'providerRequestId'='null'::jsonb OR payload->>'providerRequestId' ~ '^[A-Za-z0-9_-]{1,180}$')
   OR (provider_binding ~ '^[a-f0-9]{64}$') IS NOT TRUE
   OR provider_binding IS DISTINCT FROM run_row.request_evidence::jsonb->>'providerBindingHash'
   THEN RAISE EXCEPTION 'Invalid exact background acceptance'; END IF;
   received:=(payload->>'receivedAt')::timestamptz; until_time:=(payload->>'pollUntil')::timestamptz;
   IF received IS NULL OR until_time IS NULL OR received<run_row.dispatched_at-interval '30 seconds'
   OR received>clock_timestamp()+interval '30 seconds' OR until_time<=received OR until_time>received+interval '30 minutes'
   THEN RAISE EXCEPTION 'Invalid background retrieval window'; END IF;
 ELSE
   SELECT * INTO accepted FROM atlas_defect_analysis.provider_event WHERE analysis_id=analysis AND kind='ACCEPTED';
   IF NOT FOUND OR (SELECT count(*) FROM jsonb_object_keys(payload))<>3
   OR NOT(payload ?& ARRAY['responseId','responseRef','responseHash']) OR jsonb_typeof(payload->'responseRef')<>'object'
   OR payload->>'responseId'<>accepted.response_id OR payload->>'responseHash'<>accepted.evidence::jsonb->>'responseHash'
   THEN RAISE EXCEPTION 'Exact retained background acceptance required'; END IF;
   provider_binding:=accepted.provider_binding_hash;
 END IF;
 INSERT INTO atlas_defect_analysis.provider_event(analysis_id,kind,request_hash,provider_binding_hash,response_id,evidence,evidence_hash)
 VALUES(analysis,event_kind,request_sha,provider_binding,payload->>'responseId',event_text,encode(sha256(convert_to(event_text,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM atlas_defect_analysis.provider_event WHERE analysis_id=analysis AND kind=event_kind;
 IF NOT FOUND OR prior.request_hash<>request_sha OR prior.provider_binding_hash<>provider_binding OR prior.evidence<>event_text
 THEN RAISE EXCEPTION 'Background event conflict'; END IF;
 RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_defect_analysis.append_receipt(analysis uuid, request_sha text, receipt_kind text, receipt_text text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_defect_analysis'
AS $function$
DECLARE prior atlas_defect_analysis.receipt%ROWTYPE; payload jsonb;
BEGIN
 IF analysis IS NULL OR request_sha IS NULL OR receipt_kind IS NULL OR receipt_text IS NULL
    OR receipt_kind NOT IN ('OUTCOME','RESPONSE') OR octet_length(receipt_text)>32768
    OR NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.run WHERE id=analysis AND request_hash=request_sha AND state='DISPATCHED')
 THEN RAISE EXCEPTION 'Exact dispatched defect analysis required'; END IF;
 payload:=receipt_text::jsonb;
 IF jsonb_typeof(payload)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(payload))<>9
    OR NOT (payload ?& ARRAY['state','responseRef','resultRef','responseHash','providerRequestId','responseId','httpStatus','usage','code'])
    OR (payload->>'state' IN ('READY','REFUSED','UNKNOWN')) IS NOT TRUE
    OR receipt_kind='OUTCOME' AND payload->>'state'<>'UNKNOWN'
    OR receipt_kind='RESPONSE' AND (jsonb_typeof(payload->'responseRef')<>'object' OR (payload->>'responseHash' ~ '^[a-f0-9]{64}$') IS NOT TRUE)
    OR payload->>'state'='READY' AND (jsonb_typeof(payload->'resultRef')<>'object' OR jsonb_typeof(payload->'responseRef')<>'object'
       OR payload->'code'<>'null'::jsonb OR payload->>'responseId' IS NULL)
    OR payload->>'state'<>'READY' AND (payload->'resultRef'<>'null'::jsonb OR payload->>'code' IS NULL)
 THEN RAISE EXCEPTION 'Invalid compact defect analysis receipt'; END IF;
 INSERT INTO atlas_defect_analysis.receipt(analysis_id,kind,request_hash,evidence)
 VALUES(analysis,receipt_kind,request_sha,receipt_text) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM atlas_defect_analysis.receipt WHERE analysis_id=analysis AND kind=receipt_kind;
 IF prior.request_hash<>request_sha OR prior.evidence<>receipt_text THEN RAISE EXCEPTION 'Defect analysis receipt conflict'; END IF;
 RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_defect_analysis.background_receipt_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE accepted atlas_defect_analysis.provider_event%ROWTYPE;
BEGIN
 IF NEW.kind='RESPONSE' THEN
  SELECT * INTO accepted FROM atlas_defect_analysis.provider_event WHERE analysis_id=NEW.analysis_id AND kind='ACCEPTED';
  IF FOUND AND (NEW.request_hash<>accepted.request_hash OR NEW.evidence::jsonb->>'responseId' IS DISTINCT FROM accepted.response_id)
  THEN RAISE EXCEPTION 'Terminal response differs from accepted background response'; END IF;
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_defect_analysis.read_background(provider_binding text, analysis uuid, after_time timestamp with time zone, after_id uuid, batch_size integer, read_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_defect_analysis'
AS $function$
DECLARE result jsonb;
BEGIN
 IF (provider_binding ~ '^[a-f0-9]{64}$') IS NOT TRUE OR batch_size IS NULL OR batch_size<1 OR batch_size>11 OR read_at IS NULL
 OR ((after_time IS NULL)<>(after_id IS NULL)) THEN RAISE EXCEPTION 'Invalid bounded background read'; END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY recorded_at,id),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('run',to_jsonb(r),'acceptance',to_jsonb(e)) value,e.recorded_at,r.id
  FROM atlas_defect_analysis.provider_event e JOIN atlas_defect_analysis.run r ON r.id=e.analysis_id
  WHERE e.kind='ACCEPTED' AND e.provider_binding_hash=provider_binding
    AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.receipt WHERE analysis_id=r.id AND kind='RESPONSE')
    AND (analysis IS NULL OR r.id=analysis)
    AND (after_time IS NULL OR (e.recorded_at,r.id)>(after_time,after_id))
    AND (analysis IS NOT NULL OR (
      ((e.evidence::jsonb->>'pollUntil')::timestamptz>read_at OR NOT EXISTS(
        SELECT 1 FROM atlas_defect_analysis.receipt WHERE analysis_id=r.id AND kind='OUTCOME'))))
  ORDER BY e.recorded_at,r.id LIMIT batch_size
 ) found;
 RETURN result;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_defect_analysis.refusal_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE prior atlas_defect_analysis.run%ROWTYPE;
BEGIN
 PERFORM id FROM atlas_manual.card WHERE id=NEW.card_id FOR UPDATE;
 SELECT * INTO prior FROM atlas_defect_analysis.run WHERE card_id=NEW.card_id AND action_id=NEW.action_id FOR UPDATE;
 IF FOUND THEN
  IF prior.state<>'PREPARED' OR prior.id<>NEW.analysis_id OR prior.actor_id<>NEW.actor_id OR prior.base_hash<>NEW.base_hash
  THEN RAISE EXCEPTION 'A dispatched or different defect analysis cannot be retired'; END IF;
 ELSIF NEW.analysis_id<>NEW.action_id THEN RAISE EXCEPTION 'Absent analysis retirement must match its command';
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_defect_analysis.run_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE parent atlas_defect_analysis.run%ROWTYPE; outcome atlas_defect_analysis.receipt%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Defect analysis history is retained'; END IF;
 PERFORM id FROM atlas_manual.card WHERE id=NEW.card_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM atlas_defect_analysis.request_refusal WHERE card_id=NEW.card_id AND action_id=NEW.action_id)
 THEN RAISE EXCEPTION 'Defect analysis request is retired before dispatch'; END IF;
 IF NEW.replaces_analysis_id IS NOT NULL THEN
   SELECT * INTO parent FROM atlas_defect_analysis.run WHERE id=NEW.replaces_analysis_id FOR UPDATE;
   IF NOT FOUND OR parent.card_id<>NEW.card_id OR parent.id=NEW.id OR parent.state<>'DISPATCHED'
     OR NEW.request_evidence::jsonb->>'version' IS DISTINCT FROM 'atlas-astra-defect-analysis-v2'
     OR EXISTS(SELECT 1 FROM atlas_defect_analysis.provider_event WHERE analysis_id=parent.id AND kind='ACCEPTED')
     OR EXISTS(SELECT 1 FROM atlas_defect_analysis.receipt WHERE analysis_id=parent.id AND kind='RESPONSE')
   THEN RAISE EXCEPTION 'Exact unknown analysis replacement required'; END IF;
   SELECT * INTO outcome FROM atlas_defect_analysis.receipt WHERE analysis_id=parent.id AND kind='OUTCOME';
   IF NOT FOUND OR outcome.request_hash<>parent.request_hash
     OR encode(sha256(convert_to(outcome.evidence,'UTF8')),'hex') IS DISTINCT FROM NEW.replaces_outcome_hash
     OR outcome.evidence::jsonb->>'state' IS DISTINCT FROM 'UNKNOWN'
     OR outcome.evidence::jsonb->>'code' IS DISTINCT FROM 'DEFECT_ANALYSIS_OUTCOME_UNKNOWN'
     OR outcome.evidence::jsonb->'responseId' IS DISTINCT FROM 'null'::jsonb
     OR outcome.evidence::jsonb->'responseRef' IS DISTINCT FROM 'null'::jsonb
     OR outcome.evidence::jsonb->'resultRef' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'Exact unknown analysis replacement outcome required'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.state<>'PREPARED' OR NEW.dispatched_at IS NOT NULL THEN RAISE EXCEPTION 'Defect analysis must be prepared first'; END IF;
   RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.card_id,NEW.action_id,NEW.actor_id,NEW.base_hash,NEW.binding,NEW.binding_hash,NEW.request_hash,NEW.request_ref,
        NEW.request_evidence,NEW.evidence_hash,NEW.created_at,NEW.expires_at,NEW.replaces_analysis_id,NEW.replaces_outcome_hash)
    IS DISTINCT FROM ROW(OLD.id,OLD.card_id,OLD.action_id,OLD.actor_id,OLD.base_hash,OLD.binding,OLD.binding_hash,OLD.request_hash,OLD.request_ref,
        OLD.request_evidence,OLD.evidence_hash,OLD.created_at,OLD.expires_at,OLD.replaces_analysis_id,OLD.replaces_outcome_hash)
    OR OLD.state<>'PREPARED' OR NEW.state<>'DISPATCHED' OR NEW.dispatched_at IS NULL OR NEW.dispatched_at>=NEW.expires_at
 THEN RAISE EXCEPTION 'Defect analysis dispatch or immutable evidence conflict'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.append_research_receipt(c uuid, r uuid, s integer, e text, h text, v text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual'
AS $function$
DECLARE prior atlas_manual.research_effect;
BEGIN
 IF e NOT IN ('RESPONSE','FAILURE') OR octet_length(v)>16384 OR h !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid research receipt'; END IF;
 SELECT * INTO prior FROM atlas_manual.research_effect WHERE card_id=c AND request_id=r AND sequence=s AND event='DISPATCH';
 IF prior.request_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'Unadmitted research receipt'; END IF;
 INSERT INTO atlas_manual.research_effect(card_id,request_id,sequence,event,request_hash,evidence,evidence_hash)
 VALUES(c,r,s,e,h,v,encode(sha256(convert_to(v,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM atlas_manual.research_effect WHERE card_id=c AND request_id=r AND sequence=s AND event=e AND request_hash=h AND evidence=v) THEN RAISE EXCEPTION 'Research receipt conflict'; END IF;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.authenticate(session_hash text, browser_hash text, expected jsonb, phones text[])
 RETURNS TABLE(id uuid, name text, role text, certification_until timestamp without time zone, access_version integer, now_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_staff', 'atlas_manual'
AS $function$
DECLARE
  c atlas_staff."StaffControl"%ROWTYPE;
  s atlas_staff."StaffSession"%ROWTYPE;
  b atlas_staff."StaffBrowser"%ROWTYPE;
  i atlas_staff."StaffIdentity"%ROWTYPE;
  observed timestamptz;
BEGIN
  SELECT * INTO c FROM atlas_staff."StaffControl" WHERE "StaffControl".id = 'active' FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "tokenHash" = session_hash FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffBrowser" WHERE "tokenHash" = browser_hash FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE "StaffIdentity".id = s."identityId" FOR SHARE;
  observed := clock_timestamp();
  IF (c.enabled AND c.mode = expected->>'mode' AND c.origin = expected->>'origin'
    AND c."deploymentId" = expected->>'deploymentId' AND c."releaseSha" = expected->>'releaseSha'
    AND c."configHash" = expected->>'configHash'
    AND s."revokedAt" IS NULL AND (s."expiresAt" AT TIME ZONE 'UTC') > observed AND s."browserHash" = browser_hash
    AND s."controlRevision" = c.revision AND b."controlRevision" = c.revision AND (b."expiresAt" AT TIME ZONE 'UTC') > observed
    AND i."revokedAt" IS NULL AND i."accessVersion" = s."accessVersion"
    AND i."phoneHash" = ANY(phones) AND i.role IN ('REVIEWER', 'OBSERVER')) IS NOT TRUE
    THEN RETURN; END IF;
  RETURN QUERY SELECT i.id, i.name::text, i.role::text, i."certificationUntil", i."accessVersion", observed;
END;
$function$;

CREATE OR REPLACE FUNCTION atlas_manual.authenticate_machine(owner_id uuid, admitted_version integer, expected jsonb, phones text[])
 RETURNS TABLE(id uuid, name text, role text, access_version integer, now_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_staff', 'atlas_manual'
AS $function$
DECLARE c atlas_staff."StaffControl"%ROWTYPE; i atlas_staff."StaffIdentity"%ROWTYPE;
BEGIN
  SELECT * INTO c FROM atlas_staff."StaffControl" WHERE "StaffControl".id='active' FOR SHARE;
  IF (c.enabled AND c.mode=expected->>'mode' AND c.origin=expected->>'origin'
    AND c."deploymentId"=expected->>'deploymentId' AND c."releaseSha"=expected->>'releaseSha'
    AND c."configHash"=expected->>'configHash') IS NOT TRUE THEN RETURN; END IF;
  -- Private queue discovery checks deployment authorization before inspecting
  -- persisted jobs. It has no owner principal and cannot pass owner ACL checks.
  IF owner_id IS NULL AND admitted_version IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'ATLAS queue'::text, 'WORKER'::text, NULL::integer, clock_timestamp();
    RETURN;
  END IF;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE "StaffIdentity".id=owner_id FOR SHARE;
  IF (i."revokedAt" IS NULL AND i."accessVersion"=admitted_version
    AND i."phoneHash"=ANY(phones) AND i.role='REVIEWER') IS NOT TRUE THEN RETURN; END IF;
  RETURN QUERY SELECT i.id, i.name::text, i.role::text, i."accessVersion", clock_timestamp();
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.card_revision()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id OR NEW.created_at <> OLD.created_at
    OR NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'ATLAS manual revision conflict'; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION atlas_manual.defect_memory_design(identity jsonb, profile text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  WITH normalized AS (SELECT key, NULLIF(lower(trim(regexp_replace(normalize(value,NFKC),'\s+',' ','g'))),'') AS value
    FROM jsonb_each_text(identity))
  SELECT jsonb_build_object('version','atlas-defect-design-v1','category',profile,
    'year',(SELECT value FROM normalized WHERE key='year'),
    'manufacturer',CASE WHEN profile='SPORTS' THEN (SELECT value FROM normalized WHERE key='manufacturer') END,
    'productSet',(SELECT value FROM normalized WHERE key='productSet'),
    'parallel',(SELECT value FROM normalized WHERE key='parallel'),
    'insert',CASE WHEN profile='SPORTS' THEN (SELECT value FROM normalized WHERE key='insert') END,
    'layoutType',CASE WHEN profile='POKEMON' THEN (SELECT value FROM normalized WHERE key='layoutType') END);
$function$;

CREATE OR REPLACE FUNCTION atlas_manual.defect_memory_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_manual'
AS $function$
DECLARE a atlas_manual.action%ROWTYPE; d jsonb; expected integer;
BEGIN
  PERFORM pg_advisory_xact_lock(719400621);
  SELECT COALESCE(MAX(revision),0)+1 INTO expected FROM atlas_manual.defect_memory_publication;
  SELECT * INTO a FROM atlas_manual.action WHERE card_id=NEW.card_id AND action_id=NEW.action_id;
  d:=NEW.document::jsonb;
  IF (NEW.revision=expected AND a.actor_id=NEW.actor_id AND a.result_revision=NEW.result_revision
    AND a.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS'
    AND a.request::jsonb #>> '{action,reviewed}'='true'
    AND a.result::jsonb #>> '{receipt,actorKind}'='HUMAN'
    AND a.result::jsonb #>> '{card,contentHash}'=NEW.content_hash
    AND a.result::jsonb #>> '{card,draft,source,sourceHash}'=NEW.source_hash
    AND d->>'version'='atlas-reviewed-lessons-v1' AND jsonb_typeof(d->'lessons')='array'
    AND jsonb_array_length(d->'lessons')<=200
    AND (d->'design')-'cardNumber'=atlas_manual.defect_memory_design(a.result::jsonb #> '{card,draft,identity}',a.request::jsonb #>> '{action,base,FRONT,profile}')
    AND NOT EXISTS(SELECT 1 FROM atlas_manual.action newer WHERE newer.card_id=NEW.card_id
      AND newer.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS' AND newer.result_revision>NEW.result_revision)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'lessons') lesson WHERE (
      lesson #>> '{source,cardId}'=NEW.card_id::text AND lesson #>> '{source,actionId}'=NEW.action_id::text
      AND lesson #>> '{source,actorId}'=NEW.actor_id::text AND lesson #>> '{source,contentHash}'=NEW.content_hash
      AND lesson #>> '{source,resultRevision}'=NEW.result_revision::text
      AND lesson #>> '{source,nativeSourceHash}'=NEW.source_hash AND lesson->'design'=d->'design'
      AND lesson->>'side' IN ('FRONT','BACK')
      AND lesson #> '{source,frame}'=a.request::jsonb #> ARRAY['action','base',lesson->>'side','frame']) IS NOT TRUE)) IS NOT TRUE
  THEN RAISE EXCEPTION 'Exact committed human findings confirmation required'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN RAISE EXCEPTION 'ATLAS manual history is immutable'; END;
$function$;

CREATE OR REPLACE FUNCTION atlas_manual.learning_activation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual'
AS $function$
DECLARE expected integer; actual integer; why text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Active learning release cannot be deleted'; END IF;
 SELECT jsonb_array_length(manifest::jsonb->'publications') INTO expected
  FROM atlas_manual.learning_release WHERE id=NEW.active_release_id;
 SELECT count(*) INTO actual FROM atlas_manual.learning_release_member WHERE release_id=NEW.active_release_id;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Incomplete learning release'; END IF;
 why=COALESCE(NULLIF(current_setting('atlas.learning_change_reason',true),''),'Migration baseline');
 IF TG_OP='UPDATE' AND why='Migration baseline' THEN RAISE EXCEPTION 'Learning activation or rollback needs a recorded reason'; END IF;
 INSERT INTO atlas_manual.learning_activation_history(previous_release_id,active_release_id,database_actor,reason)
 VALUES(CASE WHEN TG_OP='UPDATE' THEN OLD.active_release_id ELSE NULL END,NEW.active_release_id,session_user,why);
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.learning_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN RAISE EXCEPTION 'Learning release and withdrawal history is append-only'; END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.learning_job_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Learning history is retained'; END IF;
 IF ROW(NEW.card_id,NEW.action_id,NEW.actor_id,NEW.access_version,NEW.created_at,NEW.design_family)
  IS DISTINCT FROM ROW(OLD.card_id,OLD.action_id,OLD.actor_id,OLD.access_version,OLD.created_at,OLD.design_family)
  OR NEW.attempts<OLD.attempts OR (OLD.feedback IS NOT NULL AND
   ROW(NEW.feedback,NEW.feedback_hash) IS DISTINCT FROM ROW(OLD.feedback,OLD.feedback_hash))
 THEN RAISE EXCEPTION 'Learning confirmation identity and captured feedback are immutable'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.learning_member_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM atlas_manual.learning_release r
  CROSS JOIN LATERAL jsonb_array_elements(r.manifest::jsonb->'publications') e
  JOIN atlas_manual.learning_publication p ON p.revision=(e->>'revision')::bigint
  WHERE r.id=NEW.release_id AND p.revision=NEW.publication_revision AND p.document_hash=e->>'sha256')
 THEN RAISE EXCEPTION 'Learning release membership does not match manifest'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.learning_publication_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_manual'
AS $function$
DECLARE a atlas_manual.action%ROWTYPE; d jsonb; expected integer;
BEGIN
  PERFORM pg_advisory_xact_lock(719400621);
  SELECT COALESCE(MAX(revision),0)+1 INTO expected FROM atlas_manual.learning_publication;
  SELECT * INTO a FROM atlas_manual.action WHERE card_id=NEW.card_id AND action_id=NEW.action_id;
  d:=NEW.document::jsonb;
  IF (NEW.revision=expected AND a.actor_id=NEW.actor_id AND a.result_revision=NEW.result_revision
    AND a.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS'
    AND a.request::jsonb #>> '{action,reviewed}'='true'
    AND a.result::jsonb #>> '{receipt,actorKind}'='HUMAN'
    AND a.result::jsonb #>> '{card,contentHash}'=NEW.content_hash
    AND a.result::jsonb #>> '{card,draft,source,sourceHash}'=NEW.source_hash
    AND d->>'version'='atlas-reviewed-lessons-v1' AND jsonb_typeof(d->'lessons')='array'
    AND jsonb_array_length(d->'lessons')<=200
    AND (d->'design')-'cardNumber'=atlas_manual.defect_memory_design(a.result::jsonb #> '{card,draft,identity}',a.request::jsonb #>> '{action,base,FRONT,profile}')
    AND NOT EXISTS(SELECT 1 FROM atlas_manual.action newer WHERE newer.card_id=NEW.card_id
      AND newer.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS' AND newer.result_revision>NEW.result_revision)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'lessons') lesson WHERE (
      lesson #>> '{source,cardId}'=NEW.card_id::text AND lesson #>> '{source,actionId}'=NEW.action_id::text
      AND lesson #>> '{source,actorId}'=NEW.actor_id::text AND lesson #>> '{source,contentHash}'=NEW.content_hash
      AND lesson #>> '{source,resultRevision}'=NEW.result_revision::text
      AND lesson #>> '{source,nativeSourceHash}'=NEW.source_hash AND lesson->'design'=d->'design'
      AND lesson->>'side' IN ('FRONT','BACK')
      AND lesson #> '{source,frame}'=a.request::jsonb #> ARRAY['action','base',lesson->>'side','frame']) IS NOT TRUE)) IS NOT TRUE
  THEN RAISE EXCEPTION 'Exact committed human findings confirmation required'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.presentation_market_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_manual'
AS $function$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'STARTED' THEN RAISE EXCEPTION 'Market request starts pending'; END IF;
 ELSIF OLD.state<>'STARTED' OR NEW.state='STARTED' OR (to_jsonb(NEW)-ARRAY['state','result','result_hash']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','result','result_hash']) THEN
  RAISE EXCEPTION 'Market request result is immutable';
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.publication_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_manual'
AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'PENDING' THEN RAISE EXCEPTION 'Publication starts pending'; END IF;
  ELSIF OLD.state<>'PENDING' OR NEW.state<>'PUBLISHED'
    OR (to_jsonb(NEW)-ARRAY['state','manifest','manifest_hash','public_hash','published_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','manifest','manifest_hash','public_hash','published_at']) THEN
    RAISE EXCEPTION 'Published report is immutable';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.read_publication(token text, requested_version integer, deployment text, release text, configuration text)
 RETURNS TABLE(card_id uuid, action_id uuid, version integer, mode text, public_hash text, manifest text, manifest_hash text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual', 'atlas_staff'
AS $function$
DECLARE control atlas_staff."PublicReaderControl"%ROWTYPE;
BEGIN
  SELECT * INTO control FROM atlas_staff."PublicReaderControl" WHERE id='active' FOR SHARE;
  IF (control.enabled AND control."deploymentId"=deployment AND control."releaseSha"=release AND control."configHash"=configuration) IS NOT TRUE
    THEN RAISE EXCEPTION 'Public reader binding unavailable'; END IF;
  IF token IS NULL OR token !~ '^ar_[A-Za-z0-9_-]{24}$' OR requested_version<1 THEN RETURN; END IF;
  RETURN QUERY SELECT p.card_id,p.action_id,p.version,p.mode,p.public_hash,p.manifest,p.manifest_hash
    FROM atlas_manual.publication p JOIN atlas_manual.public_report_identity i USING(card_id)
    WHERE i.public_token=token AND p.state='PUBLISHED' AND p.mode=control.mode
      AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card c
        JOIN atlas_manual_intake.discarded_card x ON x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id
        WHERE c.id=p.card_id)
      AND (p.version=requested_version OR (requested_version IS NULL AND p.version=(SELECT MAX(p2.version) FROM atlas_manual.publication p2 WHERE p2.card_id=p.card_id AND p2.state='PUBLISHED')));
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.research_effect_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_manual'
AS $function$
DECLARE parent atlas_manual.presentation_market; prior atlas_manual.research_effect;
BEGIN
 SELECT * INTO parent FROM atlas_manual.presentation_market WHERE card_id=NEW.card_id AND request_id=NEW.request_id FOR UPDATE;
 IF parent.card_id IS NULL THEN RAISE EXCEPTION 'Missing research intent'; END IF;
 IF NEW.event='INIT' THEN
  IF parent.state<>'STARTED' OR EXISTS(SELECT 1 FROM atlas_manual.research_effect WHERE card_id=NEW.card_id AND request_id=NEW.request_id) THEN RAISE EXCEPTION 'Research initialization conflict'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM atlas_manual.research_effect WHERE card_id=NEW.card_id AND request_id=NEW.request_id AND event='INIT') THEN RAISE EXCEPTION 'Research is not initialized'; END IF;
  IF NEW.event='DISPATCH' THEN
   IF parent.state<>'STARTED' OR EXISTS(SELECT 1 FROM atlas_manual.research_effect WHERE card_id=NEW.card_id AND request_id=NEW.request_id AND event='COMPLETE')
     OR NEW.sequence<>(SELECT COALESCE(MAX(sequence),0)+1 FROM atlas_manual.research_effect WHERE card_id=NEW.card_id AND request_id=NEW.request_id) THEN RAISE EXCEPTION 'Research dispatch order conflict'; END IF;
  ELSIF NEW.event IN ('RESPONSE','FAILURE') THEN
   SELECT * INTO prior FROM atlas_manual.research_effect WHERE card_id=NEW.card_id AND request_id=NEW.request_id AND sequence=NEW.sequence AND event='DISPATCH';
   IF prior.request_hash IS DISTINCT FROM NEW.request_hash THEN RAISE EXCEPTION 'Research response binding conflict'; END IF;
  ELSIF NEW.event='COMPLETE' AND (parent.state<>'STARTED' OR EXISTS(SELECT 1 FROM atlas_manual.research_effect d WHERE d.card_id=NEW.card_id AND d.request_id=NEW.request_id AND d.event='DISPATCH' AND NOT EXISTS(SELECT 1 FROM atlas_manual.research_effect r WHERE r.card_id=d.card_id AND r.request_id=d.request_id AND r.sequence=d.sequence AND r.event IN ('RESPONSE','FAILURE')))) THEN
   RAISE EXCEPTION 'Research completion has unsettled dispatch';
  END IF;
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual.schedule_learning_publication()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual'
AS $function$
BEGIN
 IF NEW.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS'
  AND NEW.request::jsonb #>> '{action,reviewed}'='true'
  AND NEW.result::jsonb #>> '{receipt,actorKind}'='HUMAN' THEN
  INSERT INTO atlas_manual.learning_publication_job(card_id,action_id,actor_id,access_version,design_family)
   SELECT NEW.card_id,NEW.action_id,NEW.actor_id,s."accessVersion",
    atlas_manual.defect_memory_design(NEW.result::jsonb #> '{card,draft,identity}',NEW.request::jsonb #>> '{action,base,FRONT,profile}')
   FROM atlas_staff."StaffIdentity" s WHERE s.id=NEW.actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Learning confirmation authority missing'; END IF;
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.append_receipt(attempt uuid, phase text, outcome text, request_sha text, receipt text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
DECLARE prior atlas_manual_connected.effect%ROWTYPE;
BEGIN
 IF outcome NOT IN ('RESPONSE','FAILURE') OR octet_length(receipt)>16384 OR jsonb_typeof(receipt::jsonb)<>'object'
 OR NOT EXISTS(SELECT 1 FROM atlas_manual_connected.effect WHERE attempt_id=attempt AND stage=phase AND event='DISPATCH' AND request_hash=request_sha)
 THEN RAISE EXCEPTION 'Exact dispatched identification effect required'; END IF;
 INSERT INTO atlas_manual_connected.effect(attempt_id,stage,event,request_hash,evidence)
 VALUES(attempt,phase,outcome,request_sha,receipt) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM atlas_manual_connected.effect WHERE attempt_id=attempt AND stage=phase AND event=outcome;
 IF prior.request_hash<>request_sha OR prior.evidence<>receipt THEN RAISE EXCEPTION 'Identification receipt conflict'; END IF;
 RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.claim_early_geometry(engine text, claim uuid)
 RETURNS SETOF atlas_manual_connected.early_geometry
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
 SELECT * FROM atlas_manual_connected.claim_early_geometry(engine,claim,2);
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.claim_early_geometry(engine text, claim uuid, capacity integer)
 RETURNS SETOF atlas_manual_connected.early_geometry
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
DECLARE selected_key text; active_count integer; active_capacity integer;
BEGIN
 IF engine IS NULL OR engine !~ '^[a-f0-9]{64}$' OR claim IS NULL OR capacity IS NULL OR capacity<1 OR capacity>12 THEN RAISE EXCEPTION 'Invalid geometry claim'; END IF;
 PERFORM pg_advisory_xact_lock(721930,43);
 -- Discarded work cannot be claimed again. Retire both unstarted jobs and
 -- expired claims left by a dead worker, regardless of the attempt count.
 -- An unexpired claim still represents CPU work; its owner releases it in
 -- finish_early_geometry, or this reaper releases it only after expiry.
 UPDATE atlas_manual_connected.early_geometry j SET state='FAILED',claim_id=NULL,lease_until=NULL,
 result=NULL,error='INTAKE_CARD_DELETED',updated_at=clock_timestamp()
 WHERE (j.state='QUEUED' OR (j.state='RUNNING' AND j.lease_until<=clock_timestamp()))
 AND EXISTS(SELECT 1 FROM atlas_manual_intake.card c
   JOIN atlas_manual_intake.discarded_card x ON x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id
   WHERE c.id=j.card_id);
 UPDATE atlas_manual_connected.early_geometry SET state='FAILED',claim_id=NULL,lease_until=NULL,error='GEOMETRY_INTERRUPTED',updated_at=clock_timestamp()
 WHERE attempts>=3 AND (state='QUEUED' OR (state='RUNNING' AND lease_until<=clock_timestamp()));
 SELECT count(*)::integer INTO active_count FROM atlas_manual_connected.early_geometry
 WHERE state='RUNNING' AND lease_until>clock_timestamp();
 SELECT concurrency INTO active_capacity FROM atlas_manual_connected.geometry_claim_capacity WHERE singleton;
 IF active_capacity IS NULL THEN RAISE EXCEPTION 'Geometry capacity configuration missing'; END IF;
 -- A rolling deployment cannot combine two independently chosen ceilings.
 -- Existing unexpired work pins its limit until every claim drains or expires.
 IF active_count>0 AND active_capacity<>capacity THEN RETURN; END IF;
 IF active_count>=capacity THEN RETURN; END IF;
 IF active_count=0 AND active_capacity<>capacity THEN
   UPDATE atlas_manual_connected.geometry_claim_capacity SET concurrency=capacity WHERE singleton;
 END IF;
 SELECT j.key INTO selected_key FROM atlas_manual_connected.early_geometry j
 JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=j.actor_id
 JOIN atlas_staff."StaffIdentity" a ON a.id=j.actor_id AND a."accessVersion"=j.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE j.engine_hash=engine AND j.attempts<3 AND (j.state='QUEUED' OR (j.state='RUNNING' AND j.lease_until<=clock_timestamp()))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 ORDER BY j.created_at,j.key LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF selected_key IS NULL THEN RETURN; END IF;
 -- Keep job->intake lock order in claim and finish. The candidate predicate
 -- above is an optimization; this lock and separate fresh check are the fence.
 PERFORM c.id FROM atlas_manual_intake.card c
 JOIN atlas_manual_connected.early_geometry j ON j.card_id=c.id
 WHERE j.key=selected_key FOR SHARE OF c;
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM atlas_manual_connected.early_geometry j
 JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=j.actor_id
 JOIN atlas_staff."StaffIdentity" a ON a.id=j.actor_id AND a."accessVersion"=j.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE j.key=selected_key AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)) THEN RETURN; END IF;
 RETURN QUERY UPDATE atlas_manual_connected.early_geometry SET state='RUNNING',claim_id=claim,
 lease_until=clock_timestamp()+interval '11 minutes',attempts=attempts+1,error=NULL,updated_at=clock_timestamp()
 WHERE key=selected_key RETURNING *;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.dispatch_geometry_model(job text, claim uuid, request_sha text, evidence text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
DECLARE previous atlas_manual_connected.geometry_model_action%ROWTYPE; next_attempt integer:=1; changed integer;
BEGIN
 IF request_sha !~ '^[a-f0-9]{64}$' OR octet_length(evidence)>32768 THEN RAISE EXCEPTION 'Invalid geometry request'; END IF;
 PERFORM 1 FROM atlas_manual_connected.early_geometry j
 JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=j.actor_id
 JOIN atlas_staff."StaffIdentity" a ON a.id=j.actor_id AND a."accessVersion"=j.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE j.key=job AND j.claim_id=claim AND j.state='RUNNING' AND j.lease_until>clock_timestamp()
 AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 FOR UPDATE OF j;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO previous FROM atlas_manual_connected.geometry_model_action WHERE job_key=job ORDER BY attempt DESC LIMIT 1;
 IF FOUND THEN
  IF previous.attempt>=3 OR previous.retry_authorized_at IS NULL OR previous.request_hash<>request_sha
    OR previous.response IS NULL OR COALESCE((previous.response::jsonb->>'httpStatus')::integer,0) NOT IN (429,500,502,503,504) THEN RETURN false; END IF;
  next_attempt:=previous.attempt+1;
 END IF;
 INSERT INTO atlas_manual_connected.geometry_model_action(job_key,attempt,request_hash,request) VALUES(job,next_attempt,request_sha,evidence) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.display_owner_current(owner uuid, version integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM atlas_staff."StaffIdentity" a WHERE a.id=owner
   AND a."accessVersion"=version AND a."revokedAt" IS NULL AND a.role='REVIEWER');
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.display_owner_version(owner uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT a."accessVersion" FROM atlas_staff."StaffIdentity" a WHERE a.id=owner
   AND a."revokedAt" IS NULL AND a.role='REVIEWER';
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.finish_early_geometry(job_key text, claim uuid, outcome text, evidence text, failure text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
DECLARE changed integer; selected atlas_manual_connected.early_geometry%ROWTYPE;
BEGIN
 IF outcome NOT IN ('READY','NEEDS_REVIEW','FAILED','QUEUED') OR ((outcome IN ('READY','NEEDS_REVIEW'))<>(evidence IS NOT NULL))
 THEN RAISE EXCEPTION 'Invalid geometry outcome'; END IF;
 SELECT * INTO selected FROM atlas_manual_connected.early_geometry j WHERE j.key=job_key FOR UPDATE;
 IF NOT FOUND OR selected.state<>'RUNNING' OR selected.claim_id IS DISTINCT FROM claim THEN RETURN false; END IF;
 PERFORM c.id FROM atlas_manual_intake.card c WHERE c.id=selected.card_id FOR SHARE;
 -- Never attach a result to a discarded card. Release only this worker's
 -- matching claim, even if its lease expired while waiting; no successor's
 -- claim can be released because the locked row/claim identity must match.
 IF EXISTS(SELECT 1 FROM atlas_manual_intake.card c
 JOIN atlas_manual_intake.discarded_card x ON x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id
 WHERE c.id=selected.card_id) THEN
   UPDATE atlas_manual_connected.early_geometry j SET state='FAILED',result=NULL,error='INTAKE_CARD_DELETED',
     claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
   WHERE j.key=job_key AND j.state='RUNNING' AND j.claim_id=claim;
   RETURN false;
 END IF;
 -- The old worker has stopped consuming its CPU slot. Release its own lease
 -- even when selection/authorization changed, without publishing its result.
 UPDATE atlas_manual_connected.early_geometry j SET state='FAILED',result=NULL,error='GEOMETRY_WORK_SUPERSEDED',
 claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE j.key=job_key AND j.state='RUNNING' AND j.claim_id=claim AND j.lease_until>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card c JOIN atlas_staff."StaffIdentity" a ON a.id=c.owner_id
 WHERE c.id=j.card_id AND c.owner_id=j.actor_id AND a."accessVersion"=j.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END);
 GET DIAGNOSTICS changed=ROW_COUNT; IF changed=1 THEN RETURN false; END IF;
 UPDATE atlas_manual_connected.early_geometry j SET state=outcome,result=evidence,error=failure,
 claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE j.key=job_key AND j.state='RUNNING' AND j.claim_id=claim AND j.lease_until>clock_timestamp()
 AND EXISTS(SELECT 1 FROM atlas_manual_intake.card c JOIN atlas_staff."StaffIdentity" a ON a.id=c.owner_id
 WHERE c.id=j.card_id AND c.owner_id=j.actor_id AND a."accessVersion"=j.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END);
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.geometry_side_settings(details jsonb, selected_side text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN selected_side IN ('FRONT','BACK') THEN jsonb_build_object(
   'matColor',COALESCE(details->>(CASE selected_side WHEN 'FRONT' THEN 'frontMatColor' ELSE 'backMatColor' END),details->>'matColor','BLACK'),
   'cornerShape',COALESCE(details->>'cornerShape','ROUNDED_3_18_MM')) ELSE NULL END;
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.guard_batch_analysis_successor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE action_hash text; expected_action uuid;
BEGIN
  IF NEW.analysis_action_id=OLD.analysis_action_id AND NEW.analysis_attempt=OLD.analysis_attempt THEN RETURN NEW; END IF;
  IF OLD.state<>'RUNNING' OR OLD.stage<>'ANALYZE' OR OLD.claim_id IS NULL
    OR OLD.lease_until<=clock_timestamp() OR NEW.state<>'QUEUED' OR NEW.stage<>'ANALYZE'
    OR NEW.claim_id IS NOT NULL OR NEW.lease_until IS NOT NULL OR NEW.analysis_reserved
    OR NEW.analysis_attempt<>OLD.analysis_attempt+1 OR NEW.analysis_attempt>3
    OR NEW.key<>OLD.key OR NEW.card_id<>OLD.card_id OR NEW.actor_id<>OLD.actor_id
    OR NEW.source_hash<>OLD.source_hash OR NEW.access_version<>OLD.access_version THEN
    RAISE EXCEPTION 'BATCH_RATE_LIMIT_RETRY_UNPROVEN';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.run r
    JOIN atlas_defect_analysis.receipt p ON p.analysis_id=r.id AND p.kind='RESPONSE'
    WHERE r.card_id=OLD.card_id AND r.action_id=OLD.analysis_action_id AND r.actor_id=OLD.actor_id
      AND p.evidence::jsonb->>'state'='REFUSED' AND p.evidence::jsonb->>'httpStatus' IN ('429','500','502','503','504')
      AND p.evidence::jsonb->>'code'='DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR'
      AND p.evidence::jsonb->>'responseId' IS NULL
      AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.provider_event e WHERE e.analysis_id=r.id AND e.kind='ACCEPTED')) THEN
    RAISE EXCEPTION 'BATCH_RATE_LIMIT_RETRY_UNPROVEN';
  END IF;
  action_hash:=encode(sha256(convert_to(array_to_json(ARRAY['atlas-astra-batch-v1',OLD.key,
    'ANALYZE_RETRY_'||NEW.analysis_attempt::text])::text,'UTF8')),'hex');
  expected_action:=(substr(action_hash,1,8)||'-'||substr(action_hash,9,4)||'-4'||substr(action_hash,14,3)
    ||'-a'||substr(action_hash,18,3)||'-'||substr(action_hash,21,12))::uuid;
  IF NEW.analysis_action_id<>expected_action
    OR NEW.evidence::jsonb->'analysisActions' IS DISTINCT FROM
      (COALESCE(OLD.evidence::jsonb->'analysisActions','[]'::jsonb)||to_jsonb(OLD.analysis_action_id::text))
    OR NEW.available_at<clock_timestamp()+interval '25 seconds' THEN
    RAISE EXCEPTION 'BATCH_RATE_LIMIT_RETRY_BINDING_INVALID';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.identification_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.id<>OLD.id OR NEW.card_id<>OLD.card_id OR NEW.source_hash<>OLD.source_hash OR NEW.actor_id<>OLD.actor_id
 OR NEW.input<>OLD.input OR NEW.created_at<>OLD.created_at OR OLD.state<>'RUNNING' OR NEW.state='RUNNING'
 OR NEW.retry_of IS DISTINCT FROM OLD.retry_of OR NEW.retry_action_id IS DISTINCT FROM OLD.retry_action_id
 OR NEW.evidence_attempt_id IS DISTINCT FROM OLD.evidence_attempt_id
 OR NEW.finished_at IS NULL THEN RAISE EXCEPTION 'Manual identification is immutable after completion'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.identification_retry_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
DECLARE parent atlas_manual_connected.identification%ROWTYPE;
BEGIN
 IF NEW.retry_of IS NULL THEN RETURN NEW; END IF;
 -- The immutable parent remains UNKNOWN. Its row lock and unique child index
 -- serialize concurrent claims without resetting or replacing any history.
 SELECT * INTO parent FROM atlas_manual_connected.identification WHERE id=NEW.retry_of FOR UPDATE;
 IF NOT FOUND OR parent.id=NEW.id OR parent.state<>'UNKNOWN' OR parent.finished_at IS NULL OR parent.result IS NOT NULL
 OR NEW.state<>'RUNNING' OR NEW.result IS NOT NULL OR NEW.error IS NOT NULL OR NEW.finished_at IS NOT NULL
 OR NEW.card_id IS DISTINCT FROM parent.card_id OR NEW.source_hash IS DISTINCT FROM parent.source_hash
 OR NEW.input IS DISTINCT FROM parent.input
 OR NEW.evidence_attempt_id IS DISTINCT FROM coalesce(parent.evidence_attempt_id,parent.id)
 OR NOT EXISTS (SELECT 1 FROM atlas_manual_connected.identification root
   WHERE root.id=NEW.evidence_attempt_id AND root.retry_of IS NULL AND root.retry_action_id IS NULL
     AND root.evidence_attempt_id IS NULL AND root.card_id=NEW.card_id
     AND root.source_hash=NEW.source_hash AND root.input=NEW.input)
 OR NOT EXISTS (SELECT 1 FROM atlas_manual_connected.effect dispatch
   JOIN atlas_manual_connected.effect response ON response.attempt_id=dispatch.attempt_id
     AND response.stage=dispatch.stage AND response.request_hash=dispatch.request_hash AND response.event='RESPONSE'
   WHERE dispatch.attempt_id=parent.id AND dispatch.stage='MODEL' AND dispatch.event='DISPATCH')
 THEN RAISE EXCEPTION 'Exact terminal identification and retained model receipts required'; END IF;
 -- The application verifies the exact retained response artifact is the
 -- allowlisted credit-balance rejection before claiming this successor.
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.market_job_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'QUEUED' OR NEW.attempts<>0 OR NEW.recoveries<>0 OR NEW.public_hash IS NOT NULL OR NEW.response IS NOT NULL OR NEW.dispatch_id IS NOT NULL OR NEW.audit<>'[]'::jsonb
   OR NOT EXISTS(SELECT 1 FROM atlas_manual.approval a JOIN atlas_manual.publication p USING(card_id,action_id)
    JOIN atlas_manual.presentation_market m ON m.card_id=a.card_id AND m.approval_action_id=a.action_id
    WHERE a.card_id=NEW.card_id AND a.action_id=NEW.approval_action_id AND a.source_hash=NEW.source_hash AND a.report_hash=NEW.report_hash
    AND p.mode=NEW.mode AND m.request_id=NEW.request_id AND m.actor_id=NEW.actor_id AND m.state='STARTED')
  THEN RAISE EXCEPTION 'Market job requires exact approval reservation'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Market job history is retained'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','attempts','recoveries','claim_id','lease_until','dispatch_id','public_hash','response','response_hash','code','available_at','updated_at','audit'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','attempts','recoveries','claim_id','lease_until','dispatch_id','public_hash','response','response_hash','code','available_at','updated_at','audit'])
  OR (NEW.attempts<OLD.attempts OR NEW.recoveries<>OLD.recoveries)
    AND NOT(OLD.state='FAILED' AND NEW.state='QUEUED' AND OLD.response IS NOT NULL AND NEW.attempts=0 AND NEW.recoveries=OLD.recoveries+1
      AND NEW.audit->-1->>'event'='RECOVERY' AND jsonb_array_length(NEW.audit)=jsonb_array_length(OLD.audit)+1)
  OR OLD.public_hash IS NOT NULL AND NEW.public_hash IS DISTINCT FROM OLD.public_hash
  OR OLD.response IS NOT NULL AND ROW(NEW.response,NEW.response_hash,NEW.dispatch_id) IS DISTINCT FROM ROW(OLD.response,OLD.response_hash,OLD.dispatch_id)
  OR OLD.state IN('READY','FAILED','UNAVAILABLE')
    AND NOT(OLD.state='FAILED' AND NEW.state='QUEUED' AND OLD.response IS NOT NULL AND NEW.attempts=0 AND NEW.recoveries=OLD.recoveries+1
      AND NEW.audit->-1->>'event'='RECOVERY' AND jsonb_array_length(NEW.audit)=jsonb_array_length(OLD.audit)+1) AND (to_jsonb(NEW)-ARRAY['response','response_hash','updated_at','audit']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['response','response_hash','updated_at','audit'])
  OR jsonb_array_length(NEW.audit)<jsonb_array_length(OLD.audit)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.audit) WITH ORDINALITY a(value,n) WHERE NEW.audit->(a.n::integer-1) IS DISTINCT FROM a.value)
  OR OLD.state='UNKNOWN' AND NEW.state NOT IN('UNKNOWN','QUEUED','FAILED')
  OR OLD.state='UNKNOWN' AND NEW.state<>'UNKNOWN' AND NEW.response IS NULL
 THEN RAISE EXCEPTION 'Market approval binding and response are immutable'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.pending_early_geometry(engine text, after_created timestamp with time zone, after_upload uuid)
 RETURNS TABLE(card_id uuid, upload_id uuid, side text, plan text, verification text, source text, settings jsonb, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
 SELECT c.id,u.id,u.side,u.plan,u.verification,u.source,
 atlas_manual_connected.geometry_side_settings(d.content::jsonb,u.side),i.created_at
 FROM atlas_manual_connected.early_geometry_intent i
 JOIN atlas_manual_intake.card c ON c.id=i.card_id AND c.owner_id=i.actor_id
 JOIN atlas_manual_intake.upload u ON u.id=i.upload_id AND u.card_id=c.id AND u.source IS NOT NULL
 JOIN atlas_staff."StaffIdentity" a ON a.id=i.actor_id AND a."accessVersion"=i.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 LEFT JOIN atlas_manual_connected.details d ON d.card_id=c.id
 WHERE NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 AND u.id=CASE u.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND (after_created IS NULL OR (i.created_at,u.id)>(after_created,after_upload))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.early_geometry j WHERE j.upload_id=u.id AND j.engine_hash=engine
 AND j.input::jsonb->'settings'=atlas_manual_connected.geometry_side_settings(d.content::jsonb,u.side))
 ORDER BY i.created_at,u.id LIMIT 2;
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.pending_early_geometry(engine text, after_created timestamp with time zone, after_upload uuid, page_size integer)
 RETURNS TABLE(card_id uuid, upload_id uuid, side text, plan text, verification text, source text, settings jsonb, created_at timestamp with time zone, cursor_created_at text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
BEGIN
 IF engine IS NULL OR engine !~ '^[a-f0-9]{64}$' OR page_size IS NULL OR page_size<1 OR page_size>32
 OR (after_created IS NULL)<>(after_upload IS NULL) THEN RAISE EXCEPTION 'Invalid geometry discovery'; END IF;
 RETURN QUERY
 SELECT c.id,u.id,u.side,u.plan,u.verification,u.source,
 atlas_manual_connected.geometry_side_settings(d.content::jsonb,u.side),i.created_at,
 to_char(i.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 FROM atlas_manual_connected.early_geometry_intent i
 JOIN atlas_manual_intake.card c ON c.id=i.card_id AND c.owner_id=i.actor_id
 JOIN atlas_manual_intake.upload u ON u.id=i.upload_id AND u.card_id=c.id AND u.source IS NOT NULL
 JOIN atlas_staff."StaffIdentity" a ON a.id=i.actor_id AND a."accessVersion"=i.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 LEFT JOIN atlas_manual_connected.details d ON d.card_id=c.id
 WHERE NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 AND u.id=CASE u.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND (after_created IS NULL OR (i.created_at,u.id)>(after_created,after_upload))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.early_geometry j WHERE j.upload_id=u.id AND j.engine_hash=engine
 AND j.input::jsonb->'settings'=atlas_manual_connected.geometry_side_settings(d.content::jsonb,u.side))
 ORDER BY i.created_at,u.id LIMIT page_size;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.published_display_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Published display history is retained'; END IF;
 IF ROW(NEW.id,NEW.card_id,NEW.action_id,NEW.side,NEW.mode,NEW.policy,NEW.manifest,NEW.manifest_hash,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.card_id,OLD.action_id,OLD.side,OLD.mode,OLD.policy,OLD.manifest,OLD.manifest_hash,OLD.created_at)
   OR NEW.attempts<OLD.attempts OR OLD.state='READY' AND NEW IS DISTINCT FROM OLD
 THEN RAISE EXCEPTION 'Published display identity and ready evidence are immutable'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.queue_early_geometry(payload text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
DECLARE v jsonb; i atlas_manual_connected.early_geometry_intent%ROWTYPE; u atlas_manual_intake.upload%ROWTYPE; d jsonb;
BEGIN
 IF octet_length(payload)>32768 THEN RAISE EXCEPTION 'Invalid geometry payload'; END IF;
 v=payload::jsonb;
 -- Discard locks this same intake row FOR UPDATE. Read the tombstone only
 -- after this lock statement returns, using a fresh READ COMMITTED snapshot.
 PERFORM c.id FROM atlas_manual_intake.card c WHERE c.id=(v->>'cardId')::uuid FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT x.* INTO i FROM atlas_manual_connected.early_geometry_intent x
 JOIN atlas_manual_intake.card c ON c.id=x.card_id AND c.owner_id=x.actor_id
 JOIN atlas_staff."StaffIdentity" a ON a.id=x.actor_id AND a."accessVersion"=x.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE x.upload_id=(v->>'uploadId')::uuid AND c.id=(v->>'cardId')::uuid
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 AND x.upload_id=CASE v->>'side' WHEN 'FRONT' THEN c.front_upload_id WHEN 'BACK' THEN c.back_upload_id END;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO u FROM atlas_manual_intake.upload WHERE id=i.upload_id AND card_id=i.card_id;
 SELECT content::jsonb INTO d FROM atlas_manual_connected.details WHERE card_id=i.card_id;
 IF v->>'policy' IS DISTINCT FROM 'atlas-early-photo-geometry-v1' OR v->>'side' IS DISTINCT FROM u.side OR v->'plan' IS DISTINCT FROM u.plan::jsonb
 OR v->'verification' IS DISTINCT FROM u.verification::jsonb OR v->'photoSource' IS DISTINCT FROM u.source::jsonb
 OR v->'settings' IS DISTINCT FROM atlas_manual_connected.geometry_side_settings(d,u.side)
 THEN RETURN false; END IF;
 INSERT INTO atlas_manual_connected.early_geometry(key,card_id,upload_id,side,actor_id,access_version,engine_hash,input)
 VALUES(encode(sha256(convert_to(payload,'UTF8')),'hex'),i.card_id,i.upload_id,u.side,i.actor_id,i.access_version,
 v->>'engineHash',payload) ON CONFLICT DO NOTHING;
 RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.read_geometry_model(job text)
 RETURNS SETOF atlas_manual_connected.geometry_model_action
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
 SELECT * FROM atlas_manual_connected.geometry_model_action WHERE job_key=job ORDER BY attempt DESC LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.read_grading_photo(p_card uuid, p_upload uuid, p_side text, p_mode text)
 RETURNS TABLE(key text, state text, result text, result_hash text, source_hash text, recipe_hash text, bound_original_sha256 text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT j.key,j.state,j.result,j.result_hash,j.source_hash,j.recipe_hash,b.original_sha256
 FROM atlas_manual_connected.card_image_binding b
 JOIN atlas_manual_connected.report_image_job j ON j.key=b.job_key
 JOIN atlas_manual_intake.card c ON c.id=b.card_id
 JOIN atlas_manual_intake.upload u ON u.card_id=c.id AND u.id=b.upload_id AND u.side=b.side
 WHERE b.card_id=p_card AND b.upload_id=p_upload AND b.side=p_side AND j.mode=p_mode
 AND b.upload_id=CASE WHEN b.side='FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND b.original_sha256=u.plan::jsonb->'expected'->>'sha256'
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.receive_geometry_model(job text, request_sha text, evidence text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
DECLARE changed integer;
BEGIN
 IF octet_length(evidence)>32768 THEN RAISE EXCEPTION 'Invalid geometry receipt'; END IF;
 -- A late actual response survives lease expiry. It grants no card mutation.
 UPDATE atlas_manual_connected.geometry_model_action SET response=evidence,received_at=clock_timestamp()
 WHERE job_key=job AND request_hash=request_sha AND response IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1 OR EXISTS(SELECT 1 FROM atlas_manual_connected.geometry_model_action WHERE job_key=job AND request_hash=request_sha AND response=evidence);
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.report_image_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Presentation image audit is retained'; END IF;
 IF ROW(NEW.key,NEW.source_hash,NEW.recipe_hash,NEW.recipe,NEW.mode,NEW.source_card_id,NEW.source_media,NEW.source_media_hash,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.key,OLD.source_hash,OLD.recipe_hash,OLD.recipe,OLD.mode,OLD.source_card_id,OLD.source_media,OLD.source_media_hash,OLD.created_at)
  OR NEW.attempts<OLD.attempts OR OLD.state IN('READY','FAILED','UNKNOWN')
    AND (to_jsonb(NEW)-ARRAY['audit','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['audit','updated_at'])
  OR jsonb_array_length(NEW.audit)<jsonb_array_length(OLD.audit)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.audit) WITH ORDINALITY a(value,n) WHERE NEW.audit->(a.n::integer-1) IS DISTINCT FROM a.value)
 THEN RAISE EXCEPTION 'Presentation image identity and receipts are immutable'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.retry_geometry_model(job text, actor uuid, access_ver integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
DECLARE changed integer;
BEGIN
 -- Only an explicit authenticated Retry can authorize a successor. A lost or
 -- unknown response has no definite rejection and can never pass this branch.
 PERFORM 1 FROM atlas_manual_connected.early_geometry j
 JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=actor AND j.actor_id=actor
 JOIN atlas_staff."StaffIdentity" a ON a.id=actor AND a."accessVersion"=access_ver AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE j.key=job AND j.state IN ('FAILED','NEEDS_REVIEW')
 AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 FOR UPDATE OF j;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE atlas_manual_connected.geometry_model_action SET retry_authorized_at=clock_timestamp()
 WHERE job_key=job AND attempt=(SELECT max(attempt) FROM atlas_manual_connected.geometry_model_action WHERE job_key=job)
 AND attempt<3 AND response IS NOT NULL AND retry_authorized_at IS NULL
 AND (response::jsonb->>'httpStatus')::integer IN (429,500,502,503,504);
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.review_display_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Display history is retained'; END IF;
 IF ROW(NEW.id,NEW.recovery,NEW.retry_of,NEW.retry_action,NEW.photo_hash,NEW.variant,NEW.policy,NEW.card_id,NEW.upload_id,NEW.side,NEW.owner_id,NEW.access_version,NEW.photo_source,NEW.prepared,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.recovery,OLD.retry_of,OLD.retry_action,OLD.photo_hash,OLD.variant,OLD.policy,OLD.card_id,OLD.upload_id,OLD.side,OLD.owner_id,OLD.access_version,OLD.photo_source,OLD.prepared,OLD.created_at)
   OR NEW.attempts<OLD.attempts OR OLD.state='READY' AND NEW IS DISTINCT FROM OLD
 THEN RAISE EXCEPTION 'Display identity and ready evidence are immutable'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.revision_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.card_id<>OLD.card_id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Manual details revision conflict'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.variant_confirmation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE a record;
BEGIN
 SELECT * INTO a FROM atlas_manual.action WHERE card_id=NEW.card_id AND action_id=NEW.action_id;
 IF a IS NULL OR a.actor_id<>NEW.actor_id OR a.request::jsonb->'action'->>'type'<>'VARIANT_CONFIRM' OR a.request::jsonb->'action'->>'decision'<>NEW.decision OR a.request::jsonb->'action'->>'sourceHash'<>NEW.source_hash OR (a.result::jsonb->'card'->'draft'->>'identityRevision')::int<>NEW.identity_revision
 OR (a.request::jsonb->'action'->>'candidateId') IS DISTINCT FROM NEW.candidate_id
 OR (a.request::jsonb->'action'->>'resultHash') IS DISTINCT FROM NEW.result_hash
 THEN RAISE EXCEPTION 'Variant confirmation requires exact human action'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.variant_job_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Variant history is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'QUEUED' OR NEW.attempts<>0 OR NEW.catalog IS NOT NULL OR NEW.response IS NOT NULL OR NEW.result IS NOT NULL OR NEW.dispatch_id IS NOT NULL OR NEW.audit<>'[]'::jsonb
    OR NOT EXISTS(SELECT 1 FROM atlas_manual.card c WHERE c.id=NEW.card_id AND c.owner_id=NEW.actor_id AND c.content::jsonb->'source'->>'sourceHash'=NEW.source_hash AND (c.content::jsonb->>'identityRevision')::int=NEW.identity_revision)
  THEN RAISE EXCEPTION 'Variant job requires current immutable source'; END IF; RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','attempts','claim_id','lease_until','dispatch_id','catalog','catalog_hash','response','response_hash','result','result_hash','code','available_at','updated_at','audit']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','attempts','claim_id','lease_until','dispatch_id','catalog','catalog_hash','response','response_hash','result','result_hash','code','available_at','updated_at','audit'])
 OR NEW.attempts<OLD.attempts
 OR OLD.catalog IS NOT NULL AND ROW(NEW.catalog,NEW.catalog_hash) IS DISTINCT FROM ROW(OLD.catalog,OLD.catalog_hash) AND NOT COALESCE((
   OLD.state='RUNNING' AND NEW.state='RUNNING' AND NEW.claim_id IS NOT DISTINCT FROM OLD.claim_id AND OLD.lease_until>clock_timestamp()
   AND OLD.result IS NULL AND OLD.response IS NULL AND OLD.dispatch_id IS NULL AND NEW.catalog IS NOT NULL
   AND OLD.catalog::jsonb->'problems' ? 'REFERENCE_ACQUISITION_PENDING'
   AND NEW.catalog::jsonb->'demandKey' = OLD.catalog::jsonb->'demandKey'
   AND NEW.catalog::jsonb->'candidates' = OLD.catalog::jsonb->'candidates'
   AND coalesce(NEW.catalog::jsonb->'referencePhotos','[]'::jsonb) @> coalesce(OLD.catalog::jsonb->'referencePhotos','[]'::jsonb)
 ),false)
 OR OLD.response IS NOT NULL AND ROW(NEW.response,NEW.response_hash) IS DISTINCT FROM ROW(OLD.response,OLD.response_hash)
 OR OLD.dispatch_id IS NULL AND NEW.dispatch_id IS NOT NULL AND (NEW.state<>'REQUESTED' OR NEW.catalog IS NULL OR NEW.audit->-1->>'event'<>'DISPATCH' OR NEW.audit->-1->>'id'<>NEW.dispatch_id::text)
 OR OLD.dispatch_id IS NOT NULL AND NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id
 OR OLD.result IS NOT NULL AND ROW(NEW.result,NEW.result_hash) IS DISTINCT FROM ROW(OLD.result,OLD.result_hash)
 OR OLD.state IN('READY','FAILED','STALE') AND NEW.state IS DISTINCT FROM OLD.state
 OR OLD.state='UNKNOWN' AND NEW.state NOT IN('UNKNOWN','STALE') AND NEW.response IS NULL
 OR jsonb_array_length(NEW.audit)<jsonb_array_length(OLD.audit)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.audit) WITH ORDINALITY a(value,n) WHERE NEW.audit->(a.n::int-1) IS DISTINCT FROM a.value)
 THEN RAISE EXCEPTION 'Variant evidence is immutable'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_manual_intake.card_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE p atlas_manual_intake.upload%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Intake card history is retained'; END IF;
  IF NEW.id<>OLD.id OR NEW.pair_id<>OLD.pair_id OR NEW.owner_id<>OLD.owner_id
    OR NEW.create_request_id<>OLD.create_request_id OR NEW.create_request_hash<>OLD.create_request_hash
    OR NEW.label<>OLD.label OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
    THEN RAISE EXCEPTION 'Intake immutable card identity or revision'; END IF;
  IF NEW.front_upload_id IS DISTINCT FROM OLD.front_upload_id THEN
    SELECT * INTO p FROM atlas_manual_intake.upload WHERE id=NEW.front_upload_id;
    IF (p.card_id=NEW.id AND p.side='FRONT' AND p.version=OLD.front_version+1 AND NEW.front_version=p.version) IS NOT TRUE
      THEN RAISE EXCEPTION 'Intake front version conflict'; END IF;
  ELSIF NEW.front_version<>OLD.front_version THEN RAISE EXCEPTION 'Intake front version conflict'; END IF;
  IF NEW.back_upload_id IS DISTINCT FROM OLD.back_upload_id THEN
    SELECT * INTO p FROM atlas_manual_intake.upload WHERE id=NEW.back_upload_id;
    IF (p.card_id=NEW.id AND p.side='BACK' AND p.version=OLD.back_version+1 AND NEW.back_version=p.version) IS NOT TRUE
      THEN RAISE EXCEPTION 'Intake back version conflict'; END IF;
  ELSIF NEW.back_version<>OLD.back_version THEN RAISE EXCEPTION 'Intake back version conflict'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_intake.create_discard_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-intake-discard:'||NEW.owner_id::text,0));
 IF EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card WHERE owner_id=NEW.owner_id AND create_request_id=NEW.create_request_id)
 THEN RAISE EXCEPTION 'Intake card was deleted'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_intake.discard_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN RAISE EXCEPTION 'Workspace discard history is immutable'; END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_intake.discard_insert_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE c atlas_manual_intake.card%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-intake-discard:'||NEW.owner_id::text,0));
 SELECT * INTO c FROM atlas_manual_intake.card WHERE owner_id=NEW.owner_id AND create_request_id=NEW.create_request_id FOR UPDATE;
 IF c.id IS DISTINCT FROM NEW.card_id THEN RAISE EXCEPTION 'Workspace discard card binding mismatch'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_intake.ingestion_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Intake ingestion history is retained'; END IF;
 IF ROW(NEW.upload_id,NEW.card_id,NEW.owner_id,NEW.access_version,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.upload_id,OLD.card_id,OLD.owner_id,OLD.access_version,OLD.created_at)
  OR NEW.attempts<OLD.attempts THEN RAISE EXCEPTION 'Intake ingestion identity is immutable'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_intake.schedule_ingestion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_intake'
AS $function$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO atlas_manual_intake.ingestion(upload_id,card_id,owner_id,access_version,stage)
  SELECT NEW.id,NEW.card_id,c.owner_id,a."accessVersion",'VERIFY'
  FROM atlas_manual_intake.card c JOIN atlas_staff."StaffIdentity" a ON a.id=c.owner_id
  WHERE c.id=NEW.card_id;
 ELSIF (OLD.verification IS NULL AND NEW.verification IS NOT NULL) OR (OLD.source IS NULL AND NEW.source IS NOT NULL) THEN
  -- Active claim holders choose their next stage at the fenced finish. A browser
  -- completion only brings an unclaimed same-intent task forward.
  UPDATE atlas_manual_intake.ingestion SET
   stage=CASE WHEN NEW.source IS NOT NULL THEN 'ADMIT' ELSE 'PREPARE' END,
   available_at=clock_timestamp(),updated_at=clock_timestamp(),code=NULL,failures=0
  WHERE upload_id=NEW.id AND state='QUEUED';
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_manual_intake.upload_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Intake upload history is retained'; END IF;
  IF ROW(NEW.id,NEW.card_id,NEW.request_id,NEW.actor_id,NEW.request,NEW.request_hash,NEW.side,NEW.version,NEW.plan,NEW.plan_hash,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.card_id,OLD.request_id,OLD.actor_id,OLD.request,OLD.request_hash,OLD.side,OLD.version,OLD.plan,OLD.plan_hash,OLD.created_at)
    OR OLD.verification IS NOT NULL AND ROW(NEW.verification,NEW.verification_hash) IS DISTINCT FROM ROW(OLD.verification,OLD.verification_hash)
    OR OLD.source IS NOT NULL AND ROW(NEW.source,NEW.source_hash) IS DISTINCT FROM ROW(OLD.source,OLD.source_hash)
    THEN RAISE EXCEPTION 'Intake upload evidence is immutable'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_staff.lock_control()
 RETURNS SETOF atlas_staff."StaffControl"
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_staff'
AS $function$SELECT * FROM atlas_staff."StaffControl" WHERE id = 'active' FOR SHARE$function$;

CREATE OR REPLACE FUNCTION atlas_staff.operations_audit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_staff'
AS $function$
DECLARE d jsonb:=NEW.details::jsonb;g atlas_staff."StaffOperationsGrant"%ROWTYPE;i atlas_staff."StaffIdentity"%ROWTYPE;
  s atlas_staff."StaffSession"%ROWTYPE;b atlas_staff."StaffBrowser"%ROWTYPE;c atlas_staff."StaffControl"%ROWTYPE;
  now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF NEW.event NOT IN ('SPECIMEN_INTAKE_ADMITTED','STAFF_ROSTER_UPDATED','STAFF_ASSIGNMENT_UPDATED','TEN_CARD_PILOT_PREPARED','INVOICE_COST_RECONCILED') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO g FROM atlas_staff."StaffOperationsGrant" WHERE id=(d->>'operationsGrantId')::uuid FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=NEW."actorId" FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "tokenHash"=d->>'sessionHash' FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=s."browserHash" FOR SHARE;
  SELECT * INTO c FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  IF (c.enabled AND g."identityId"=i.id AND g."revokedAt" IS NULL AND g."createdAt"<=now_at AND g."expiresAt">now_at
    AND g."accessVersion"=i."accessVersion" AND g."controlRevision"=c.revision AND g.mode=c.mode AND g.origin=c.origin
    AND g."deploymentId"=c."deploymentId" AND g."releaseSha"=c."releaseSha" AND g."configHash"=c."configHash"
    AND i."revokedAt" IS NULL AND s."identityId"=i.id AND s."revokedAt" IS NULL AND s."expiresAt">now_at
    AND s."createdAt">=now_at-interval '5 minutes' AND s."createdAt"<=now_at AND s."accessVersion"=i."accessVersion"
    AND s."controlRevision"=c.revision AND b."controlRevision"=c.revision AND b."expiresAt">now_at
    AND (d->>'accessVersion')::int=i."accessVersion" AND (d->>'controlRevision')::int=c.revision
    AND d->>'version'='atlas-human-operations-v1' AND d->>'inputHash' ~ '^[a-f0-9]{64}$'
    AND d->>'authorizationEvidenceHash' ~ '^[a-f0-9]{64}$' AND length(trim(d->>'reason'))>0
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS operations audit requires current human capability'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_staff.operations_change_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_staff'
AS $function$
DECLARE audit atlas_staff."StaffAudit"%ROWTYPE;d jsonb;p jsonb:=to_jsonb(NEW);wanted text;subject text;
  matched boolean:=false;
BEGIN
  IF session_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='atlas_staff."StaffOperationsGrant"'::regclass)
    OR NOT has_table_privilege(session_user,'atlas_staff."StaffOperationsGrant"','SELECT') THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME<>'StaffIdentity' THEN RAISE EXCEPTION 'Current staff identity audit only'; END IF;
  wanted:='STAFF_ROSTER_UPDATED';subject:=p->>'id';
  FOR audit IN SELECT * FROM atlas_staff."StaffAudit" WHERE event=wanted AND (subject IS NULL OR "subjectId"=subject)
    AND "createdAt">=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') LOOP
    d:=audit.details::jsonb;
      matched:=d->'receipt'->>'identityId'=p->>'id' AND (d->'receipt'->>'accessVersion')::int=NEW."accessVersion"
        AND d->'after'->>'role'=NEW.role AND (d->'after'->>'revoked')::boolean=(NEW."revokedAt" IS NOT NULL)
        AND ((d->'after'->>'certificationUntil')::timestamptz AT TIME ZONE 'UTC') IS NOT DISTINCT FROM NEW."certificationUntil"
        AND ((d->'after'->>'trustedLearningUntil')::timestamptz AT TIME ZONE 'UTC') IS NOT DISTINCT FROM NEW."trustedLearningUntil";
    IF matched IS TRUE THEN RETURN NULL; END IF;
  END LOOP;
  RAISE EXCEPTION 'ATLAS operations change requires its exact current human audit';
END $function$;

CREATE OR REPLACE FUNCTION atlas_staff.operations_grant_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (to_jsonb(NEW)-'revokedAt') IS DISTINCT FROM (to_jsonb(OLD)-'revokedAt')
    OR OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL THEN RAISE EXCEPTION 'ATLAS operations grant is immutable except one-way revocation'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_staff.public_reader_control_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'ATLAS public activation changes must advance their revision'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_staff.sms_pilot_claim_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_staff'
AS $function$
DECLARE app text; active jsonb; current_binding jsonb; policy atlas_staff."SmsPilotControl";
  t timestamptz;
BEGIN
  IF TG_TABLE_SCHEMA='atlas_staff' AND TG_TABLE_NAME='StaffChallenge' THEN
    app:='STAFF';
    SELECT to_jsonb(c) INTO active FROM atlas_staff."StaffControl" c WHERE id='active' FOR SHARE;
  ELSIF TG_TABLE_SCHEMA='atlas_customer' AND TG_TABLE_NAME='CustomerChallenge' THEN
    app:='CUSTOMER';
    SELECT to_jsonb(c) INTO active FROM atlas_customer."CustomerControl" c WHERE id='active' FOR SHARE;
  ELSE RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
  END IF;
  IF (active->>'enabled')::boolean IS DISTINCT FROM true
    OR NEW."controlRevision" IS DISTINCT FROM (active->>'revision')::integer THEN
    RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
  END IF;
  -- The exemption is an operator-owned fixture control, never an address or
  -- phone prefix. A production request using a test number still needs a hold.
  IF active->>'mode'='LOCAL_FIXTURE' AND active->>'origin'='http://127.0.0.1:4318'
    AND active->>'releaseSha'=repeat('0',40) THEN RETURN NEW; END IF;
  -- Preserve the fresh-statement isolation used by both auth adapters.
  -- SMS policy rows still serialize the exact current destination/binding.
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
  END IF;
  current_binding:=jsonb_build_object('mode',active->>'mode','origin',active->>'origin',
    'deploymentId',active->>'deploymentId','releaseSha',active->>'releaseSha','configHash',active->>'configHash');
  SELECT * INTO policy FROM atlas_staff."SmsPilotControl" WHERE application=app FOR UPDATE;
  -- The original activation time remains evidence; the test expiry is retired.
  t:=clock_timestamp();
  IF (active->>'mode'='PRODUCTION' AND active->>'origin'='https://atlasgrading.com'
    AND policy.enabled AND policy."activatedAt"<=t
    AND policy.binding=current_binding
    AND ((app='CUSTOMER' AND policy."publicCustomerAdmission") OR policy."allowedPhoneHash"=NEW."phoneHash")
    AND policy."accountSid"=NEW."accountSid" AND policy."serviceSid"=NEW."serviceSid"
    AND NEW.state='SENDING' AND NEW.attempts=0 AND NEW."verificationSid" IS NULL
    AND NEW."checkClaimId" IS NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
  END IF;
  IF app='CUSTOMER' AND NOT policy."publicCustomerAdmission" THEN
    IF policy."allowedDestinationHash" IS DISTINCT FROM
      encode(sha256(convert_to('atlas-sms-pilot-v1:CUSTOMER:'||NEW.phone,'UTF8')),'hex') THEN
      RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
    END IF;
  END IF;
  -- The owner retired SMS test count, cost and seven-day limits. Keep the
  -- existing per-claim reservation as immutable accounting evidence; it no
  -- longer imposes a spend ceiling or implies delivery/invoice settlement.
  INSERT INTO atlas_staff."SmsPilotReservation"(application,"sendClaimId","challengeId","browserHash","requestId",
    "pilotId","policyRevision","controlRevision","phoneHash","accountSid","serviceSid","feeEvidenceHash",binding,"reservedMicroUsd","recordedAt")
  VALUES(app,NEW."sendClaimId",NEW.id,NEW."browserHash",NEW."requestId"::text,policy."pilotId",policy.revision,
    NEW."controlRevision",NEW."phoneHash",NEW."accountSid",NEW."serviceSid",policy."feeEvidenceHash",
    current_binding,policy."reservationMicroUsd",t);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_staff.sms_pilot_control_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE t timestamptz:=clock_timestamp();
BEGIN
  IF NEW.application IS DISTINCT FROM OLD.application OR NEW.revision<>OLD.revision+1
    OR (NEW."maxClaims",NEW."reservationMicroUsd",NEW."maxReservedMicroUsd",NEW."createdAt")
      IS DISTINCT FROM (OLD."maxClaims",OLD."reservationMicroUsd",OLD."maxReservedMicroUsd",OLD."createdAt") THEN
    RAISE EXCEPTION 'ATLAS SMS pilot revision required';
  END IF;
  IF (NEW."activatedAt",NEW."expiresAt") IS DISTINCT FROM (OLD."activatedAt",OLD."expiresAt") THEN
    RAISE EXCEPTION 'ATLAS SMS pilot window is immutable';
  END IF;
  IF OLD."activatedAt" IS NULL THEN
    IF NEW.enabled THEN
      NEW."activatedAt":=t;
      NEW."expiresAt":=t+interval '168 hours';
    END IF;
  ELSIF (NEW."pilotId",NEW."allowedPhoneHash",NEW."allowedDestinationHash",NEW."accountSid",NEW."serviceSid",NEW."feeEvidenceHash")
    IS DISTINCT FROM (OLD."pilotId",OLD."allowedPhoneHash",OLD."allowedDestinationHash",OLD."accountSid",OLD."serviceSid",OLD."feeEvidenceHash") THEN
    RAISE EXCEPTION 'ATLAS SMS pilot identity is immutable';
  END IF;
  NEW."updatedAt":=t;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION atlas_staff.sms_pilot_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN RAISE EXCEPTION 'ATLAS SMS pilot evidence is immutable'; END $function$;

CREATE OR REPLACE FUNCTION atlas_staff.staff_challenge_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET "TimeZone" TO 'UTC'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'SENDING' OR NEW.attempts <> 0 OR NEW."verificationSid" IS NOT NULL OR NEW."checkClaimId" IS NOT NULL THEN
      RAISE EXCEPTION 'ATLAS challenge requires an unused send claim'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['state','verificationSid','attempts','checkClaimId','replayHash','replayUntil','consumedAt'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','verificationSid','attempts','checkClaimId','replayHash','replayUntil','consumedAt'])
    THEN RAISE EXCEPTION 'ATLAS challenge input is immutable'; END IF;
  IF OLD.state IN ('CONSUMED','SUPERSEDED') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'ATLAS terminal challenge is immutable'; END IF;
  IF OLD."verificationSid" IS NOT NULL AND NEW."verificationSid" IS DISTINCT FROM OLD."verificationSid" THEN
    RAISE EXCEPTION 'ATLAS verification SID is write-once'; END IF;
  IF NEW.state = 'SUPERSEDED' THEN
    IF OLD.state IN ('SENDING','CHECKING','UNKNOWN') AND OLD."quarantineUntil" > clock_timestamp() THEN
      RAISE EXCEPTION 'ATLAS unknown verification remains quarantined'; END IF;
    IF NEW.attempts <> OLD.attempts THEN RAISE EXCEPTION 'ATLAS attempt count cannot change during supersession'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'SENDING' AND NEW.state IN ('PENDING','UNKNOWN') AND NEW.attempts = 0 THEN RETURN NEW; END IF;
  IF OLD.state = 'PENDING' AND NEW.state = 'CHECKING' AND NEW.attempts = OLD.attempts + 1
    AND NEW."checkClaimId" IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.state = 'CHECKING' AND NEW.state IN ('PENDING','UNKNOWN','CONSUMED') AND NEW.attempts = OLD.attempts
    AND (NEW.state = 'PENDING' OR NEW."checkClaimId" = OLD."checkClaimId") THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'ATLAS challenge transition is invalid';
END; $function$;

CREATE OR REPLACE FUNCTION atlas_staff.staff_consumption_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas_staff'
AS $function$
DECLARE c atlas_staff."StaffChallenge"%ROWTYPE; s atlas_staff."StaffSession"%ROWTYPE; i atlas_staff."StaffIdentity"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'StaffSession' THEN SELECT * INTO c FROM atlas_staff."StaffChallenge" WHERE id = NEW."challengeId";
  ELSE SELECT * INTO c FROM atlas_staff."StaffChallenge" WHERE id = NEW.id; END IF;
  SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "challengeId" = c.id;
  IF c.state <> 'CONSUMED' AND s."tokenHash" IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id = s."identityId";
  IF c.state <> 'CONSUMED' OR s."tokenHash" IS NULL OR i.id IS NULL OR c."phoneHash" <> i."phoneHash"
    OR c."browserHash" <> s."browserHash" OR c."controlRevision" <> s."controlRevision"
    OR s."createdAt" <> c."consumedAt" OR c."consumedAt" >= c."expiresAt" THEN
    RAISE EXCEPTION 'ATLAS challenge consumption and bound session must commit together'; END IF;
  RETURN NULL;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_staff.staff_control_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'ATLAS control revision must advance once'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_staff.staff_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (NEW.id,NEW."phoneHash",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."phoneHash",OLD."createdAt")
    OR NEW."accessVersion" < OLD."accessVersion" THEN RAISE EXCEPTION 'ATLAS identity binding is immutable'; END IF;
  IF (NEW.role,NEW."revokedAt",NEW."certificationUntil",NEW."trustedLearningUntil")
    IS DISTINCT FROM (OLD.role,OLD."revokedAt",OLD."certificationUntil",OLD."trustedLearningUntil")
    AND NEW."accessVersion" <> OLD."accessVersion" + 1 THEN RAISE EXCEPTION 'ATLAS access changes must revoke existing sessions'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION atlas_staff.staff_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN RAISE EXCEPTION 'ATLAS staff history is immutable'; END; $function$;

CREATE OR REPLACE FUNCTION atlas_staff.staff_session_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (to_jsonb(NEW) - 'revokedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'revokedAt')
    OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN
    RAISE EXCEPTION 'ATLAS issued session binding is immutable'; END IF;
  RETURN NEW;
END; $function$;

ALTER TABLE "atlas_customer"."CommerceControl" ADD CONSTRAINT "CommerceControl_binding_check" CHECK (jsonb_typeof(binding) = 'object'::text);

ALTER TABLE "atlas_customer"."CommerceControl" ADD CONSTRAINT "CommerceControl_id_check" CHECK (id = 'active'::text);

ALTER TABLE "atlas_customer"."CommerceControl" ADD CONSTRAINT "CommerceControl_merchant_check" CHECK (jsonb_typeof(merchant) = 'object'::text);

ALTER TABLE "atlas_customer"."CommerceControl" ADD CONSTRAINT "CommerceControl_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CommerceControl" ADD CONSTRAINT "CommerceControl_shippingPlans_check" CHECK (jsonb_typeof("shippingPlans") = 'array'::text);

ALTER TABLE "atlas_customer"."CommerceEffect" ADD CONSTRAINT "CommerceEffect_check" CHECK (state = 'PENDING'::text OR "claimId" IS NOT NULL);

ALTER TABLE "atlas_customer"."CommerceEffect" ADD CONSTRAINT "CommerceEffect_kind_check" CHECK (kind = ANY (ARRAY['EMAIL_RECEIPT'::text, 'EMAIL_SHIPPING_RECEIPT'::text, 'EMAIL_LABEL_READY'::text, 'SMS_RECEIPT'::text, 'FEDEX_LABEL'::text, 'SHIPSTATION_LABEL'::text, 'TAX_TRANSACTION'::text, 'PACKAGE_LABEL'::text]));

ALTER TABLE "atlas_customer"."CommerceEffect" ADD CONSTRAINT "CommerceEffect_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CommerceEffect" ADD CONSTRAINT "CommerceEffect_reconcileCount_check" CHECK ("reconcileCount" >= 0 AND "reconcileCount" <= 5);

ALTER TABLE "atlas_customer"."CommerceEffect" ADD CONSTRAINT "CommerceEffect_state_check" CHECK (state = ANY (ARRAY['PENDING'::text, 'DISPATCHED'::text, 'UNKNOWN'::text, 'SUCCEEDED'::text, 'FAILED'::text]));

ALTER TABLE "atlas_customer"."CommerceOrder" ADD CONSTRAINT "CommerceOrder_draftId_key" UNIQUE ("draftId");

ALTER TABLE "atlas_customer"."CommerceOrder" ADD CONSTRAINT "CommerceOrder_paymentId_key" UNIQUE ("paymentId");

ALTER TABLE "atlas_customer"."CommerceOrder" ADD CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CommerceOrder" ADD CONSTRAINT "CommerceOrder_quoteId_key" UNIQUE ("quoteId");

ALTER TABLE "atlas_customer"."CommerceOrder" ADD CONSTRAINT "CommerceOrder_receipt_check" CHECK (jsonb_typeof(receipt) = 'object'::text);

ALTER TABLE "atlas_customer"."CommerceOrder" ADD CONSTRAINT "CommerceOrder_reference_key" UNIQUE (reference);

ALTER TABLE "atlas_customer"."CommercePayment" ADD CONSTRAINT "CommercePayment_accountId_requestId_key" UNIQUE ("accountId", "requestId");

ALTER TABLE "atlas_customer"."CommercePayment" ADD CONSTRAINT "CommercePayment_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CommercePayment" ADD CONSTRAINT "CommercePayment_providerId_key" UNIQUE ("providerId");

ALTER TABLE "atlas_customer"."CommercePayment" ADD CONSTRAINT "CommercePayment_state_check" CHECK (state = ANY (ARRAY['DISPATCHED'::text, 'UNKNOWN'::text, 'AWAITING_PAYMENT'::text, 'PROCESSING'::text, 'PAID'::text, 'CANCELED'::text]));

ALTER TABLE "atlas_customer"."CommerceProviderEvent" ADD CONSTRAINT "CommerceProviderEvent_bodyHash_check" CHECK ("bodyHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CommerceProviderEvent" ADD CONSTRAINT "CommerceProviderEvent_pkey" PRIMARY KEY (provider, merchant, "eventId");

ALTER TABLE "atlas_customer"."CommerceQuote" ADD CONSTRAINT "CommerceQuote_contentHash_check" CHECK ("contentHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CommerceQuote" ADD CONSTRAINT "CommerceQuote_draftRevision_check" CHECK ("draftRevision" > 0);

ALTER TABLE "atlas_customer"."CommerceQuote" ADD CONSTRAINT "CommerceQuote_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CommerceQuote" ADD CONSTRAINT "CommerceQuote_snapshot_check" CHECK (jsonb_typeof(snapshot) = 'object'::text);

ALTER TABLE "atlas_customer"."CommerceShippingPayment" ADD CONSTRAINT "CommerceShippingPayment_accountId_requestId_key" UNIQUE ("accountId", "requestId");

ALTER TABLE "atlas_customer"."CommerceShippingPayment" ADD CONSTRAINT "CommerceShippingPayment_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CommerceShippingPayment" ADD CONSTRAINT "CommerceShippingPayment_providerId_key" UNIQUE ("providerId");

ALTER TABLE "atlas_customer"."CommerceShippingPayment" ADD CONSTRAINT "CommerceShippingPayment_state_check" CHECK (state = ANY (ARRAY['DISPATCHED'::text, 'UNKNOWN'::text, 'AWAITING_PAYMENT'::text, 'PROCESSING'::text, 'PAID'::text, 'CANCELED'::text]));

ALTER TABLE "atlas_customer"."CommerceShippingProviderEvent" ADD CONSTRAINT "CommerceShippingProviderEvent_bodyHash_check" CHECK ("bodyHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CommerceShippingProviderEvent" ADD CONSTRAINT "CommerceShippingProviderEvent_pkey" PRIMARY KEY (provider, merchant, "eventId");

ALTER TABLE "atlas_customer"."CommerceShippingQuote" ADD CONSTRAINT "CommerceShippingQuote_contentHash_check" CHECK ("contentHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CommerceShippingQuote" ADD CONSTRAINT "CommerceShippingQuote_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CommerceShippingQuote" ADD CONSTRAINT "CommerceShippingQuote_snapshot_check" CHECK (jsonb_typeof(snapshot) = 'object'::text);

ALTER TABLE "atlas_customer"."CommerceShippingReceipt" ADD CONSTRAINT "CommerceShippingReceipt_orderId_key" UNIQUE ("orderId");

ALTER TABLE "atlas_customer"."CommerceShippingReceipt" ADD CONSTRAINT "CommerceShippingReceipt_paymentId_key" UNIQUE ("paymentId");

ALTER TABLE "atlas_customer"."CommerceShippingReceipt" ADD CONSTRAINT "CommerceShippingReceipt_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CommerceShippingReceipt" ADD CONSTRAINT "CommerceShippingReceipt_quoteId_key" UNIQUE ("quoteId");

ALTER TABLE "atlas_customer"."CommerceShippingReceipt" ADD CONSTRAINT "CommerceShippingReceipt_receipt_check" CHECK (jsonb_typeof(receipt) = 'object'::text);

ALTER TABLE "atlas_customer"."CustomerAccount" ADD CONSTRAINT "CustomerAccount_accessVersion_check" CHECK ("accessVersion" > 0);

ALTER TABLE "atlas_customer"."CustomerAccount" ADD CONSTRAINT "CustomerAccount_phoneHash_check" CHECK ("phoneHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CustomerAccount" ADD CONSTRAINT "CustomerAccount_phoneHash_key" UNIQUE ("phoneHash");

ALTER TABLE "atlas_customer"."CustomerAccount" ADD CONSTRAINT "CustomerAccount_phone_check" CHECK (phone::text ~ '^\+[1-9][0-9]{7,14}$'::text);

ALTER TABLE "atlas_customer"."CustomerAccount" ADD CONSTRAINT "CustomerAccount_phone_key" UNIQUE (phone);

ALTER TABLE "atlas_customer"."CustomerAccount" ADD CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CustomerAccount" ADD CONSTRAINT "CustomerAccount_profile" CHECK (profile IS NULL OR atlas_customer.valid_shop_profile(profile));

ALTER TABLE "atlas_customer"."CustomerBrowser" ADD CONSTRAINT "CustomerBrowser_check" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= ("createdAt" + '7 days'::interval));

ALTER TABLE "atlas_customer"."CustomerBrowser" ADD CONSTRAINT "CustomerBrowser_controlRevision_check" CHECK ("controlRevision" > 0);

ALTER TABLE "atlas_customer"."CustomerBrowser" ADD CONSTRAINT "CustomerBrowser_pkey" PRIMARY KEY ("tokenHash");

ALTER TABLE "atlas_customer"."CustomerBrowser" ADD CONSTRAINT "CustomerBrowser_tokenHash_check" CHECK ("tokenHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_accountSid_check" CHECK ("accountSid"::text ~ '^AC[0-9a-fA-F]{32}$'::text);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_attempts_check" CHECK (attempts >= 0 AND attempts <= 5);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_browserHash_requestId_key" UNIQUE ("browserHash", "requestId");

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_check" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= ("createdAt" + '00:05:00'::interval));

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_check1" CHECK ("quarantineUntil" >= "expiresAt" AND "quarantineUntil" <= ("createdAt" + '00:11:00'::interval));

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_check2" CHECK ((state <> ALL (ARRAY['PENDING'::text, 'CHECKING'::text, 'CONSUMED'::text])) OR "verificationSid"::text ~ '^VE[0-9a-fA-F]{32}$'::text);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_check3" CHECK (state <> 'CHECKING'::text OR "checkClaimId" IS NOT NULL);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_check4" CHECK (state <> 'CONSUMED'::text OR "consumedAt" IS NOT NULL AND "replayHash"::text ~ '^[a-f0-9]{64}$'::text AND "replayUntil" IS NOT NULL);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_id_check" CHECK (id::text ~ '^[A-Za-z0-9_-]{43}$'::text);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_phoneHash_check" CHECK ("phoneHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_phone_check" CHECK (phone::text ~ '^\+[1-9][0-9]{7,14}$'::text);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_sendClaimId_key" UNIQUE ("sendClaimId");

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_serviceSid_check" CHECK ("serviceSid"::text ~ '^VA[0-9a-fA-F]{32}$'::text);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_state_check" CHECK (state = ANY (ARRAY['SENDING'::text, 'PENDING'::text, 'CHECKING'::text, 'UNKNOWN'::text, 'SUPERSEDED'::text, 'CONSUMED'::text]));

ALTER TABLE "atlas_customer"."CustomerControl" ADD CONSTRAINT "CustomerControl_check" CHECK (mode = 'PRODUCTION'::text AND origin = 'https://atlasgrading.com'::text OR mode = 'LOCAL_FIXTURE'::text AND origin = 'http://127.0.0.1:4318'::text);

ALTER TABLE "atlas_customer"."CustomerControl" ADD CONSTRAINT "CustomerControl_configHash_check" CHECK ("configHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CustomerControl" ADD CONSTRAINT "CustomerControl_id_check" CHECK (id = 'active'::text);

ALTER TABLE "atlas_customer"."CustomerControl" ADD CONSTRAINT "CustomerControl_mode_check" CHECK (mode = ANY (ARRAY['PRODUCTION'::text, 'LOCAL_FIXTURE'::text]));

ALTER TABLE "atlas_customer"."CustomerControl" ADD CONSTRAINT "CustomerControl_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CustomerControl" ADD CONSTRAINT "CustomerControl_releaseSha_check" CHECK ("releaseSha"::text ~ '^[a-f0-9]{40}$'::text);

ALTER TABLE "atlas_customer"."CustomerControl" ADD CONSTRAINT "CustomerControl_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_accountId_requestId_key" UNIQUE ("accountId", "requestId");

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_browserHash_check" CHECK ("browserHash" ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_check" CHECK (atlas_customer.canonical_email("deliveryEmail") = email);

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_check1" CHECK ("expiresAt" = ("createdAt" + '00:30:00'::interval));

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_check2" CHECK ((state = 'VERIFIED'::text) = ("consumedAt" IS NOT NULL));

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_email_check" CHECK (atlas_customer.canonical_email(email) IS NOT NULL AND email = atlas_customer.canonical_email(email));

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_providerId_check" CHECK ("providerId" IS NULL OR length("providerId") >= 1 AND length("providerId") <= 200);

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_state_check" CHECK (state = ANY (ARRAY['SENDING'::text, 'SENT'::text, 'UNKNOWN'::text, 'SUPERSEDED'::text, 'VERIFIED'::text]));

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_tokenHash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_tokenHash_key" UNIQUE ("tokenHash");

ALTER TABLE "atlas_customer"."CustomerIntakeCard" ADD CONSTRAINT "CustomerIntakeCard_draftId_requestId_key" UNIQUE ("draftId", "requestId");

ALTER TABLE "atlas_customer"."CustomerIntakeCard" ADD CONSTRAINT "CustomerIntakeCard_identitySource_check" CHECK ("identitySource" = ANY (ARRAY['MACHINE_PROPOSAL'::text, 'CUSTOMER_CORRECTION'::text]));

ALTER TABLE "atlas_customer"."CustomerIntakeCard" ADD CONSTRAINT "CustomerIntakeCard_identityState_check" CHECK ("identityState" = ANY (ARRAY['UPLOADING'::text, 'QUEUED'::text, 'PROCESSING'::text, 'READY'::text, 'ATTENTION'::text, 'UNKNOWN'::text]));

ALTER TABLE "atlas_customer"."CustomerIntakeCard" ADD CONSTRAINT "CustomerIntakeCard_pairId_key" UNIQUE ("pairId");

ALTER TABLE "atlas_customer"."CustomerIntakeCard" ADD CONSTRAINT "CustomerIntakeCard_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CustomerIntakeCard" ADD CONSTRAINT "CustomerIntake_identity" CHECK (identity IS NULL OR atlas_customer.intake_identity_valid(identity));

ALTER TABLE "atlas_customer"."CustomerIntakeDraft" ADD CONSTRAINT "CustomerIntakeDraft_accountId_requestId_key" UNIQUE ("accountId", "requestId");

ALTER TABLE "atlas_customer"."CustomerIntakeDraft" ADD CONSTRAINT "CustomerIntakeDraft_check" CHECK (("intakeMethod" = 'MAIL_IN'::text) = ("kioskId" IS NULL));

ALTER TABLE "atlas_customer"."CustomerIntakeDraft" ADD CONSTRAINT "CustomerIntakeDraft_intakeMethod_check" CHECK ("intakeMethod" = ANY (ARRAY['MAIL_IN'::text, 'DEALER_DROP_OFF'::text]));

ALTER TABLE "atlas_customer"."CustomerIntakeDraft" ADD CONSTRAINT "CustomerIntakeDraft_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CustomerIntakeDraft" ADD CONSTRAINT "CustomerIntakeDraft_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_customer"."CustomerIntakeDraft" ADD CONSTRAINT "CustomerIntakeDraft_state_check" CHECK (state = ANY (ARRAY['DRAFT'::text, 'REVIEW'::text, 'ORDERED'::text]));

ALTER TABLE "atlas_customer"."CustomerIntakeEffect" ADD CONSTRAINT "CustomerIntakeEffect_pkey" PRIMARY KEY ("attemptId", stage);

ALTER TABLE "atlas_customer"."CustomerIntakeEffect" ADD CONSTRAINT "CustomerIntakeEffect_requestHash_check" CHECK ("requestHash" ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CustomerIntakeEffect" ADD CONSTRAINT "CustomerIntakeEffect_stage_check" CHECK (stage = ANY (ARRAY['OCR_FRONT'::text, 'OCR_BACK'::text, 'MODEL'::text]));

ALTER TABLE "atlas_customer"."CustomerIntakeIdentification" ADD CONSTRAINT "CustomerIntakeIdentification_cardId_key" UNIQUE ("cardId");

ALTER TABLE "atlas_customer"."CustomerIntakeIdentification" ADD CONSTRAINT "CustomerIntakeIdentification_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CustomerIntakeIdentification" ADD CONSTRAINT "CustomerIntakeIdentification_state_check" CHECK (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'READY'::text, 'ATTENTION'::text, 'UNKNOWN'::text]));

ALTER TABLE "atlas_customer"."CustomerIntakeUpload" ADD CONSTRAINT "CustomerIntakeUpload_cardId_side_key" UNIQUE ("cardId", side);

ALTER TABLE "atlas_customer"."CustomerIntakeUpload" ADD CONSTRAINT "CustomerIntakeUpload_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CustomerIntakeUpload" ADD CONSTRAINT "CustomerIntakeUpload_side_check" CHECK (side = ANY (ARRAY['FRONT'::text, 'BACK'::text]));

ALTER TABLE "atlas_customer"."CustomerRateBucket" ADD CONSTRAINT "CustomerRateBucket_count_check" CHECK (count > 0);

ALTER TABLE "atlas_customer"."CustomerRateBucket" ADD CONSTRAINT "CustomerRateBucket_pkey" PRIMARY KEY (key);

ALTER TABLE "atlas_customer"."CustomerServiceControl" ADD CONSTRAINT "CustomerServiceControl_binding_check" CHECK (jsonb_typeof(binding) = 'object'::text);

ALTER TABLE "atlas_customer"."CustomerServiceControl" ADD CONSTRAINT "CustomerServiceControl_id_check" CHECK (id = 'active'::text);

ALTER TABLE "atlas_customer"."CustomerServiceControl" ADD CONSTRAINT "CustomerServiceControl_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."CustomerSession" ADD CONSTRAINT "CustomerSession_challengeId_key" UNIQUE ("challengeId");

ALTER TABLE "atlas_customer"."CustomerSession" ADD CONSTRAINT "CustomerSession_check" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= ("createdAt" + '12:00:00'::interval));

ALTER TABLE "atlas_customer"."CustomerSession" ADD CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("tokenHash");

ALTER TABLE "atlas_customer"."CustomerSession" ADD CONSTRAINT "CustomerSession_tokenHash_check" CHECK ("tokenHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_customer"."CustomerVerifiedEmail" ADD CONSTRAINT "CustomerVerifiedEmail_email_check" CHECK (atlas_customer.canonical_email(email) IS NOT NULL AND email = atlas_customer.canonical_email(email));

ALTER TABLE "atlas_customer"."CustomerVerifiedEmail" ADD CONSTRAINT "CustomerVerifiedEmail_pkey" PRIMARY KEY ("accountId", email);

ALTER TABLE "atlas_customer"."ProgressNotification" ADD CONSTRAINT "ProgressNotification_channel_check" CHECK (channel = ANY (ARRAY['EMAIL'::text, 'SMS'::text]));

ALTER TABLE "atlas_customer"."ProgressNotification" ADD CONSTRAINT "ProgressNotification_check" CHECK ((state = ANY (ARRAY['DISPATCHED'::text, 'ACCEPTED'::text, 'UNKNOWN'::text])) = ("claimId" IS NOT NULL));

ALTER TABLE "atlas_customer"."ProgressNotification" ADD CONSTRAINT "ProgressNotification_id_check" CHECK (length(id) <= 180);

ALTER TABLE "atlas_customer"."ProgressNotification" ADD CONSTRAINT "ProgressNotification_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."ProgressNotification" ADD CONSTRAINT "ProgressNotification_state_check" CHECK (state = ANY (ARRAY['PENDING'::text, 'DISPATCHED'::text, 'ACCEPTED'::text, 'UNKNOWN'::text, 'SUPPRESSED'::text]));

ALTER TABLE "atlas_customer"."ProgressNotificationControl" ADD CONSTRAINT "ProgressNotificationControl_id_check" CHECK (id = 'active'::text);

ALTER TABLE "atlas_customer"."ProgressNotificationControl" ADD CONSTRAINT "ProgressNotificationControl_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_customer"."ProgressPreference" ADD CONSTRAINT "ProgressPreference_pkey" PRIMARY KEY ("accountId");

ALTER TABLE "atlas_customer"."ProgressPreference" ADD CONSTRAINT "ProgressPreference_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_customer"."ProgressPreferenceEvent" ADD CONSTRAINT "ProgressPreferenceEvent_accountId_requestId_key" UNIQUE ("accountId", "requestId");

ALTER TABLE "atlas_customer"."ProgressPreferenceEvent" ADD CONSTRAINT "ProgressPreferenceEvent_pkey" PRIMARY KEY ("accountId", revision);

ALTER TABLE "atlas_customer"."WeeklyCapacityConfig" ADD CONSTRAINT "WeeklyCapacityConfig_channel_check" CHECK (channel = ANY (ARRAY['MAIL_IN'::text, 'DEALER_DROP_OFF'::text]));

ALTER TABLE "atlas_customer"."WeeklyCapacityConfig" ADD CONSTRAINT "WeeklyCapacityConfig_pkey" PRIMARY KEY (channel);

ALTER TABLE "atlas_customer"."WeeklyCapacityConfig" ADD CONSTRAINT "WeeklyCapacityConfig_quotaCards_check" CHECK ("quotaCards" >= 0);

ALTER TABLE "atlas_customer"."WeeklyCapacityReservation" ADD CONSTRAINT "WeeklyCapacityReservation_cardCount_check" CHECK ("cardCount" > 0);

ALTER TABLE "atlas_customer"."WeeklyCapacityReservation" ADD CONSTRAINT "WeeklyCapacityReservation_pkey" PRIMARY KEY ("paymentId");

ALTER TABLE "atlas_customer"."WeeklyCapacityReservation" ADD CONSTRAINT "WeeklyCapacityReservation_state_check" CHECK (state = ANY (ARRAY['HELD'::text, 'CONSUMED'::text, 'RELEASED'::text]));

ALTER TABLE "atlas_customer"."WeeklyCapacitySharedPolicy" ADD CONSTRAINT "WeeklyCapacitySharedPolicy_authorizationReference_check" CHECK (length(btrim("authorizationReference")) >= 1 AND length(btrim("authorizationReference")) <= 240 AND "authorizationReference" !~ '[[:cntrl:]]'::text);

ALTER TABLE "atlas_customer"."WeeklyCapacitySharedPolicy" ADD CONSTRAINT "WeeklyCapacitySharedPolicy_pkey" PRIMARY KEY ("effectiveWeekStartsAt");

ALTER TABLE "atlas_customer"."WeeklyCapacitySharedPolicy" ADD CONSTRAINT "WeeklyCapacitySharedPolicy_quotaCards_check" CHECK ("quotaCards" >= 0);

ALTER TABLE "atlas_customer"."WeeklyCapacitySharedWeek" ADD CONSTRAINT "WeeklyCapacitySharedWeek_check" CHECK ("resetsAt" > "weekStartsAt");

ALTER TABLE "atlas_customer"."WeeklyCapacitySharedWeek" ADD CONSTRAINT "WeeklyCapacitySharedWeek_pkey" PRIMARY KEY ("weekStartsAt");

ALTER TABLE "atlas_customer"."WeeklyCapacitySharedWeek" ADD CONSTRAINT "WeeklyCapacitySharedWeek_quotaCards_check" CHECK ("quotaCards" >= 0);

ALTER TABLE "atlas_customer"."WeeklyCapacityWeek" ADD CONSTRAINT "WeeklyCapacityWeek_check" CHECK ("resetsAt" > "weekStartsAt");

ALTER TABLE "atlas_customer"."WeeklyCapacityWeek" ADD CONSTRAINT "WeeklyCapacityWeek_pkey" PRIMARY KEY (channel, "weekStartsAt");

ALTER TABLE "atlas_customer"."WeeklyCapacityWeek" ADD CONSTRAINT "WeeklyCapacityWeek_quotaCards_check" CHECK ("quotaCards" >= 0);

ALTER TABLE "atlas_dealer"."commission_event" ADD CONSTRAINT "commission_event_card_id_source_ref_key" UNIQUE (card_id, source_ref);

ALTER TABLE "atlas_dealer"."commission_event" ADD CONSTRAINT "commission_event_check" CHECK (kind = 'ACCRUED'::text AND amount_cents = 500 OR kind = 'REVERSED'::text AND amount_cents >= '-500'::integer AND amount_cents <= '-1'::integer);

ALTER TABLE "atlas_dealer"."commission_event" ADD CONSTRAINT "commission_event_kind_check" CHECK (kind = ANY (ARRAY['ACCRUED'::text, 'REVERSED'::text]));

ALTER TABLE "atlas_dealer"."commission_event" ADD CONSTRAINT "commission_event_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_dealer"."custody_event" ADD CONSTRAINT "custody_event_card_id_request_id_key" UNIQUE (card_id, request_id);

ALTER TABLE "atlas_dealer"."custody_event" ADD CONSTRAINT "custody_event_card_id_sequence_key" UNIQUE (card_id, sequence);

ALTER TABLE "atlas_dealer"."custody_event" ADD CONSTRAINT "custody_event_check" CHECK ((kind = 'DEPOSIT_DECLARED'::text) = (customer_id IS NOT NULL));

ALTER TABLE "atlas_dealer"."custody_event" ADD CONSTRAINT "custody_event_check1" CHECK ((actor_id IS NULL) = (customer_id IS NOT NULL));

ALTER TABLE "atlas_dealer"."custody_event" ADD CONSTRAINT "custody_event_evidence_check" CHECK (jsonb_typeof(evidence) = 'object'::text);

ALTER TABLE "atlas_dealer"."custody_event" ADD CONSTRAINT "custody_event_kind_check" CHECK (kind = ANY (ARRAY['DEPOSIT_DECLARED'::text, 'COLLECTED'::text, 'ATLAS_RECEIVED'::text, 'RETURN_DISPATCHED'::text, 'RETURNED_TO_KIOSK'::text, 'CUSTOMER_COLLECTED'::text, 'MAIL_DISPATCHED'::text, 'CUSTOMER_DELIVERED'::text, 'DELAY_REPORTED'::text, 'DELAY_RESOLVED'::text]));

ALTER TABLE "atlas_dealer"."custody_event" ADD CONSTRAINT "custody_event_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_dealer"."custody_event" ADD CONSTRAINT "custody_event_sequence_check" CHECK (sequence > 0);

ALTER TABLE "atlas_dealer"."handoff" ADD CONSTRAINT "handoff_card_ids_check" CHECK (cardinality(card_ids) >= 1 AND cardinality(card_ids) <= 100);

ALTER TABLE "atlas_dealer"."handoff" ADD CONSTRAINT "handoff_order_id_key" UNIQUE (order_id);

ALTER TABLE "atlas_dealer"."handoff" ADD CONSTRAINT "handoff_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_dealer"."handoff_receipt" ADD CONSTRAINT "handoff_receipt_card_ids_check" CHECK (cardinality(card_ids) >= 1 AND cardinality(card_ids) <= 100);

ALTER TABLE "atlas_dealer"."handoff_receipt" ADD CONSTRAINT "handoff_receipt_handoff_id_key" UNIQUE (handoff_id);

ALTER TABLE "atlas_dealer"."handoff_receipt" ADD CONSTRAINT "handoff_receipt_input_hash_check" CHECK (input_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_dealer"."handoff_receipt" ADD CONSTRAINT "handoff_receipt_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_dealer"."handoff_receipt" ADD CONSTRAINT "handoff_receipt_request_id_key" UNIQUE (request_id);

ALTER TABLE "atlas_dealer"."location" ADD CONSTRAINT "location_address_check" CHECK (jsonb_typeof(address) = 'object'::text);

ALTER TABLE "atlas_dealer"."location" ADD CONSTRAINT "location_entry_token_check" CHECK (entry_token ~ '^[A-Za-z0-9_-]{32,96}$'::text);

ALTER TABLE "atlas_dealer"."location" ADD CONSTRAINT "location_entry_token_key" UNIQUE (entry_token);

ALTER TABLE "atlas_dealer"."location" ADD CONSTRAINT "location_latitude_check" CHECK (latitude >= '-90'::integer::numeric AND latitude <= 90::numeric);

ALTER TABLE "atlas_dealer"."location" ADD CONSTRAINT "location_longitude_check" CHECK (longitude >= '-180'::integer::numeric AND longitude <= 180::numeric);

ALTER TABLE "atlas_dealer"."location" ADD CONSTRAINT "location_name_check" CHECK (length(name) >= 1 AND length(name) <= 160);

ALTER TABLE "atlas_dealer"."location" ADD CONSTRAINT "location_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_dealer"."location" ADD CONSTRAINT "location_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_dealer"."location" ADD CONSTRAINT "location_schedule_check" CHECK (jsonb_typeof(schedule) = 'object'::text);

ALTER TABLE "atlas_dealer"."location" ADD CONSTRAINT "valid_schedule" CHECK (atlas_dealer.valid_schedule(schedule));

ALTER TABLE "atlas_dealer"."location_revision" ADD CONSTRAINT "location_revision_pkey" PRIMARY KEY (location_id, revision);

ALTER TABLE "atlas_dealer"."manual_card_link" ADD CONSTRAINT "manual_card_link_evidence_ref_check" CHECK (length(evidence_ref) >= 1 AND length(evidence_ref) <= 300);

ALTER TABLE "atlas_dealer"."manual_card_link" ADD CONSTRAINT "manual_card_link_manual_card_id_key" UNIQUE (manual_card_id);

ALTER TABLE "atlas_dealer"."manual_card_link" ADD CONSTRAINT "manual_card_link_pkey" PRIMARY KEY (card_id);

ALTER TABLE "atlas_dealer"."membership" ADD CONSTRAINT "membership_account_id_location_id_key" UNIQUE (account_id, location_id);

ALTER TABLE "atlas_dealer"."membership" ADD CONSTRAINT "membership_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_dealer"."membership" ADD CONSTRAINT "membership_version_check" CHECK (version > 0);

ALTER TABLE "atlas_dealer"."order_card" ADD CONSTRAINT "order_card_channel_check" CHECK (channel = ANY (ARRAY['MAIL_IN'::text, 'KIOSK'::text]));

ALTER TABLE "atlas_dealer"."order_card" ADD CONSTRAINT "order_card_check" CHECK ((channel = 'KIOSK'::text) = (location_id IS NOT NULL));

ALTER TABLE "atlas_dealer"."order_card" ADD CONSTRAINT "order_card_check1" CHECK ((location_id IS NULL) = (dealer_id IS NULL));

ALTER TABLE "atlas_dealer"."order_card" ADD CONSTRAINT "order_card_pkey" PRIMARY KEY (card_id);

ALTER TABLE "atlas_dealer"."order_inbox_acknowledgment" ADD CONSTRAINT "order_inbox_acknowledgment_pkey" PRIMARY KEY (order_id);

ALTER TABLE "atlas_dealer"."order_inbox_acknowledgment" ADD CONSTRAINT "order_inbox_acknowledgment_request_id_key" UNIQUE (request_id);

ALTER TABLE "atlas_dealer"."session" ADD CONSTRAINT "session_browser_hash_check" CHECK (browser_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_dealer"."session" ADD CONSTRAINT "session_check" CHECK (expires_at > created_at AND expires_at <= (created_at + '08:00:00'::interval));

ALTER TABLE "atlas_dealer"."session" ADD CONSTRAINT "session_pkey" PRIMARY KEY (token_hash);

ALTER TABLE "atlas_dealer"."session" ADD CONSTRAINT "session_token_hash_check" CHECK (token_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_defect_analysis"."provider_event" ADD CONSTRAINT "provider_event_check" CHECK (evidence_hash = encode(sha256(convert_to(evidence, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_defect_analysis"."provider_event" ADD CONSTRAINT "provider_event_evidence_check" CHECK (octet_length(evidence) <= 16384 AND jsonb_typeof(evidence::jsonb) = 'object'::text);

ALTER TABLE "atlas_defect_analysis"."provider_event" ADD CONSTRAINT "provider_event_kind_check" CHECK (kind = ANY (ARRAY['ACCEPTED'::text, 'ACK_ARTIFACT'::text]));

ALTER TABLE "atlas_defect_analysis"."provider_event" ADD CONSTRAINT "provider_event_pkey" PRIMARY KEY (analysis_id, kind);

ALTER TABLE "atlas_defect_analysis"."provider_event" ADD CONSTRAINT "provider_event_provider_binding_hash_check" CHECK (provider_binding_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_defect_analysis"."provider_event" ADD CONSTRAINT "provider_event_request_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_defect_analysis"."provider_event" ADD CONSTRAINT "provider_event_response_id_check" CHECK (response_id ~ '^resp_[A-Za-z0-9_-]{1,180}$'::text);

ALTER TABLE "atlas_defect_analysis"."receipt" ADD CONSTRAINT "receipt_evidence_check" CHECK (octet_length(evidence) <= 32768 AND jsonb_typeof(evidence::jsonb) = 'object'::text);

ALTER TABLE "atlas_defect_analysis"."receipt" ADD CONSTRAINT "receipt_kind_check" CHECK (kind = ANY (ARRAY['OUTCOME'::text, 'RESPONSE'::text]));

ALTER TABLE "atlas_defect_analysis"."receipt" ADD CONSTRAINT "receipt_pkey" PRIMARY KEY (analysis_id, kind);

ALTER TABLE "atlas_defect_analysis"."receipt" ADD CONSTRAINT "receipt_request_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_defect_analysis"."request_refusal" ADD CONSTRAINT "request_refusal_base_hash_check" CHECK (base_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_defect_analysis"."request_refusal" ADD CONSTRAINT "request_refusal_card_id_analysis_id_key" UNIQUE (card_id, analysis_id);

ALTER TABLE "atlas_defect_analysis"."request_refusal" ADD CONSTRAINT "request_refusal_code_check" CHECK (code = ANY (ARRAY['DEFECT_ANALYSIS_STALE'::text, 'DEFECT_ANALYSIS_REQUEST_EXPIRED'::text, 'MANUAL_GEOMETRY_REVIEW_REQUIRED'::text, 'MANUAL_DEFECT_PENDING'::text, 'DEFECT_ANALYSIS_PENDING'::text, 'DEFECT_ANALYSIS_REPLACEMENT_INVALID'::text]));

ALTER TABLE "atlas_defect_analysis"."request_refusal" ADD CONSTRAINT "request_refusal_pkey" PRIMARY KEY (card_id, action_id);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "background_replacement_complete" CHECK ((replaces_analysis_id IS NULL) = (replaces_outcome_hash IS NULL));

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_base_hash_check" CHECK (base_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_binding_check" CHECK (octet_length(binding) <= 32768 AND jsonb_typeof(binding::jsonb) = 'object'::text);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_card_id_action_id_key" UNIQUE (card_id, action_id);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_check" CHECK (binding_hash = encode(sha256(convert_to(binding, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_check1" CHECK (evidence_hash = encode(sha256(convert_to(request_evidence, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_check2" CHECK (expires_at > created_at AND expires_at <= (created_at + '00:05:00'::interval));

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_check3" CHECK ((state = 'PREPARED'::text) = (dispatched_at IS NULL));

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_replaces_outcome_hash_check" CHECK (replaces_outcome_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_request_evidence_check" CHECK (octet_length(request_evidence) <= 32768 AND jsonb_typeof(request_evidence::jsonb) = 'object'::text);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_request_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_request_ref_check" CHECK (octet_length(request_ref) <= 8192 AND jsonb_typeof(request_ref::jsonb) = 'object'::text);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_state_check" CHECK (state = ANY (ARRAY['PREPARED'::text, 'DISPATCHED'::text]));

ALTER TABLE "atlas_manual"."action" ADD CONSTRAINT "action_card_id_result_revision_key" UNIQUE (card_id, result_revision);

ALTER TABLE "atlas_manual"."action" ADD CONSTRAINT "action_check" CHECK (result_revision = (expected_revision + 1));

ALTER TABLE "atlas_manual"."action" ADD CONSTRAINT "action_check1" CHECK (request_hash = encode(sha256(convert_to(request, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."action" ADD CONSTRAINT "action_expected_revision_check" CHECK (expected_revision > 0);

ALTER TABLE "atlas_manual"."action" ADD CONSTRAINT "action_pkey" PRIMARY KEY (card_id, action_id);

ALTER TABLE "atlas_manual"."action" ADD CONSTRAINT "action_request_check" CHECK (octet_length(request) <= 65536);

ALTER TABLE "atlas_manual"."action" ADD CONSTRAINT "action_result_check" CHECK (octet_length(result) <= 524288);

ALTER TABLE "atlas_manual"."approval" ADD CONSTRAINT "approval_check" CHECK (report_hash = encode(sha256(convert_to(report, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."approval" ADD CONSTRAINT "approval_pkey" PRIMARY KEY (card_id, action_id);

ALTER TABLE "atlas_manual"."approval" ADD CONSTRAINT "approval_report_check" CHECK (octet_length(report) <= 262144 AND jsonb_typeof(report::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual"."approval" ADD CONSTRAINT "approval_source_hash_check" CHECK (source_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual"."approval" ADD CONSTRAINT "approval_source_revision_check" CHECK (source_revision > 0);

ALTER TABLE "atlas_manual"."card" ADD CONSTRAINT "card_check" CHECK (content_hash = encode(sha256(convert_to(content, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."card" ADD CONSTRAINT "card_content_check" CHECK (octet_length(content) <= 262144);

ALTER TABLE "atlas_manual"."card" ADD CONSTRAINT "card_content_check1" CHECK (jsonb_typeof(content::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual"."card" ADD CONSTRAINT "card_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_manual"."card" ADD CONSTRAINT "card_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_manual"."defect_memory_publication" ADD CONSTRAINT "defect_memory_publication_card_id_action_id_key" UNIQUE (card_id, action_id);

ALTER TABLE "atlas_manual"."defect_memory_publication" ADD CONSTRAINT "defect_memory_publication_check" CHECK (document_hash = encode(sha256(convert_to(document, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."defect_memory_publication" ADD CONSTRAINT "defect_memory_publication_content_hash_check" CHECK (content_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual"."defect_memory_publication" ADD CONSTRAINT "defect_memory_publication_design_key_check" CHECK (design_key ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual"."defect_memory_publication" ADD CONSTRAINT "defect_memory_publication_document_check" CHECK (octet_length(document) <= 1048576 AND jsonb_typeof(document::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual"."defect_memory_publication" ADD CONSTRAINT "defect_memory_publication_pkey" PRIMARY KEY (revision);

ALTER TABLE "atlas_manual"."defect_memory_publication" ADD CONSTRAINT "defect_memory_publication_result_revision_check" CHECK (result_revision > 1);

ALTER TABLE "atlas_manual"."defect_memory_publication" ADD CONSTRAINT "defect_memory_publication_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_manual"."defect_memory_publication" ADD CONSTRAINT "defect_memory_publication_source_hash_check" CHECK (source_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual"."learning_activation_history" ADD CONSTRAINT "learning_activation_history_pkey" PRIMARY KEY (sequence);

ALTER TABLE "atlas_manual"."learning_control" ADD CONSTRAINT "learning_control_pkey" PRIMARY KEY (singleton);

ALTER TABLE "atlas_manual"."learning_control" ADD CONSTRAINT "learning_control_singleton_check" CHECK (singleton);

ALTER TABLE "atlas_manual"."learning_publication" ADD CONSTRAINT "defect_memory_publication_check" CHECK (document_hash = encode(sha256(convert_to(document, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."learning_publication" ADD CONSTRAINT "defect_memory_publication_content_hash_check" CHECK (content_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual"."learning_publication" ADD CONSTRAINT "defect_memory_publication_design_key_check" CHECK (design_key ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual"."learning_publication" ADD CONSTRAINT "defect_memory_publication_document_check" CHECK (octet_length(document) <= 1048576 AND jsonb_typeof(document::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual"."learning_publication" ADD CONSTRAINT "defect_memory_publication_result_revision_check" CHECK (result_revision > 1);

ALTER TABLE "atlas_manual"."learning_publication" ADD CONSTRAINT "defect_memory_publication_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_manual"."learning_publication" ADD CONSTRAINT "defect_memory_publication_source_hash_check" CHECK (source_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual"."learning_publication" ADD CONSTRAINT "learning_publication_card_id_action_id_key" UNIQUE (card_id, action_id);

ALTER TABLE "atlas_manual"."learning_publication" ADD CONSTRAINT "learning_publication_pkey" PRIMARY KEY (revision);

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_access_version_check" CHECK (access_version > 0);

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_attempts_check" CHECK (attempts >= 0);

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_check" CHECK ((state = 'RUNNING'::text) = (claim_id IS NOT NULL));

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_check1" CHECK ((claim_id IS NULL) = (lease_until IS NULL));

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_check2" CHECK ((feedback IS NULL) = (feedback_hash IS NULL));

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_check3" CHECK (feedback IS NULL OR encode(sha256(convert_to(feedback, 'UTF8'::name)), 'hex'::text) = feedback_hash);

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_check4" CHECK (access_version IS NOT NULL OR state = 'HELD'::text);

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_code_check" CHECK (code ~ '^[A-Z][A-Z0-9_]{0,100}$'::text);

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_failures_check" CHECK (failures >= 0);

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_feedback_hash_check" CHECK (feedback_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_pkey" PRIMARY KEY (card_id, action_id);

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_state_check" CHECK (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'PREPARED'::text, 'HELD'::text, 'SUPERSEDED'::text]));

ALTER TABLE "atlas_manual"."learning_release" ADD CONSTRAINT "learning_release_check" CHECK (encode(sha256(convert_to(manifest, 'UTF8'::name)), 'hex'::text) = manifest_hash);

ALTER TABLE "atlas_manual"."learning_release" ADD CONSTRAINT "learning_release_id_check" CHECK (id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$'::text);

ALTER TABLE "atlas_manual"."learning_release" ADD CONSTRAINT "learning_release_manifest_hash_check" CHECK (manifest_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual"."learning_release" ADD CONSTRAINT "learning_release_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_manual"."learning_release_member" ADD CONSTRAINT "learning_release_member_pkey" PRIMARY KEY (release_id, publication_revision);

ALTER TABLE "atlas_manual"."learning_withdrawal" ADD CONSTRAINT "learning_withdrawal_pkey" PRIMARY KEY (publication_revision);

ALTER TABLE "atlas_manual"."learning_withdrawal" ADD CONSTRAINT "learning_withdrawal_reason_check" CHECK (length(reason) >= 1 AND length(reason) <= 2000);

ALTER TABLE "atlas_manual"."presentation" ADD CONSTRAINT "presentation_card_id_request_id_key" UNIQUE (card_id, request_id);

ALTER TABLE "atlas_manual"."presentation" ADD CONSTRAINT "presentation_check" CHECK (octet_length(presentation) <= 262144 AND presentation_hash = encode(sha256(convert_to(presentation, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."presentation" ADD CONSTRAINT "presentation_check1" CHECK (media IS NULL AND media_hash IS NULL OR media IS NOT NULL AND media_hash IS NOT NULL AND octet_length(media) <= 32768 AND media_hash = encode(sha256(convert_to(media, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."presentation" ADD CONSTRAINT "presentation_check2" CHECK (market_source IS NULL AND market_source_hash IS NULL OR market_source IS NOT NULL AND market_source_hash IS NOT NULL AND octet_length(market_source) <= 32768 AND market_source_hash = encode(sha256(convert_to(market_source, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."presentation" ADD CONSTRAINT "presentation_pkey" PRIMARY KEY (card_id, approval_action_id, revision);

ALTER TABLE "atlas_manual"."presentation" ADD CONSTRAINT "presentation_request_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual"."presentation" ADD CONSTRAINT "presentation_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_manual"."presentation_market" ADD CONSTRAINT "presentation_market_check" CHECK (octet_length(request) <= 4096 AND request_hash = encode(sha256(convert_to(request, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."presentation_market" ADD CONSTRAINT "presentation_market_check1" CHECK (state = 'STARTED'::text AND result IS NULL AND result_hash IS NULL OR state <> 'STARTED'::text AND result IS NOT NULL AND result_hash IS NOT NULL AND octet_length(result) <= 8192 AND result_hash = encode(sha256(convert_to(result, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."presentation_market" ADD CONSTRAINT "presentation_market_pkey" PRIMARY KEY (card_id, request_id);

ALTER TABLE "atlas_manual"."presentation_market" ADD CONSTRAINT "presentation_market_state_check" CHECK (state = ANY (ARRAY['STARTED'::text, 'READY'::text, 'UNAVAILABLE'::text, 'UNKNOWN'::text]));

ALTER TABLE "atlas_manual"."presentation_upload" ADD CONSTRAINT "presentation_upload_card_id_request_id_key" UNIQUE (card_id, request_id);

ALTER TABLE "atlas_manual"."presentation_upload" ADD CONSTRAINT "presentation_upload_check" CHECK (octet_length(request) <= 4096 AND request_hash = encode(sha256(convert_to(request, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."presentation_upload" ADD CONSTRAINT "presentation_upload_check1" CHECK (octet_length(plan) <= 8192 AND plan_hash = encode(sha256(convert_to(plan, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."presentation_upload" ADD CONSTRAINT "presentation_upload_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_manual"."public_report_identity" ADD CONSTRAINT "public_report_identity_pkey" PRIMARY KEY (card_id);

ALTER TABLE "atlas_manual"."public_report_identity" ADD CONSTRAINT "public_report_identity_public_token_check" CHECK (public_token ~ '^ar_[A-Za-z0-9_-]{24}$'::text);

ALTER TABLE "atlas_manual"."public_report_identity" ADD CONSTRAINT "public_report_identity_public_token_key" UNIQUE (public_token);

ALTER TABLE "atlas_manual"."public_report_identity" ADD CONSTRAINT "public_report_identity_report_number_check" CHECK (report_number ~ '^ATLAS-[A-F0-9]{12}$'::text);

ALTER TABLE "atlas_manual"."public_report_identity" ADD CONSTRAINT "public_report_identity_report_number_key" UNIQUE (report_number);

ALTER TABLE "atlas_manual"."publication" ADD CONSTRAINT "publication_card_id_version_key" UNIQUE (card_id, version);

ALTER TABLE "atlas_manual"."publication" ADD CONSTRAINT "publication_check" CHECK (state = 'PENDING'::text AND manifest IS NULL AND manifest_hash IS NULL AND public_hash IS NULL AND published_at IS NULL OR state = 'PUBLISHED'::text AND manifest IS NOT NULL AND manifest_hash IS NOT NULL AND public_hash IS NOT NULL AND octet_length(manifest) <= 16384 AND jsonb_typeof(manifest::jsonb) = 'object'::text AND manifest_hash = encode(sha256(convert_to(manifest, 'UTF8'::name)), 'hex'::text) AND public_hash ~ '^[a-f0-9]{64}$'::text AND published_at IS NOT NULL);

ALTER TABLE "atlas_manual"."publication" ADD CONSTRAINT "publication_mode_check" CHECK (mode = ANY (ARRAY['PRODUCTION'::text, 'LOCAL_FIXTURE'::text]));

ALTER TABLE "atlas_manual"."publication" ADD CONSTRAINT "publication_pkey" PRIMARY KEY (card_id, action_id);

ALTER TABLE "atlas_manual"."publication" ADD CONSTRAINT "publication_state_check" CHECK (state = ANY (ARRAY['PENDING'::text, 'PUBLISHED'::text]));

ALTER TABLE "atlas_manual"."publication" ADD CONSTRAINT "publication_version_check" CHECK (version > 0);

ALTER TABLE "atlas_manual"."research_effect" ADD CONSTRAINT "research_effect_card_id_request_id_request_hash_event_key" UNIQUE (card_id, request_id, request_hash, event);

ALTER TABLE "atlas_manual"."research_effect" ADD CONSTRAINT "research_effect_check" CHECK (octet_length(evidence) <= 16384 AND evidence_hash = encode(sha256(convert_to(evidence, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual"."research_effect" ADD CONSTRAINT "research_effect_check1" CHECK ((event = ANY (ARRAY['INIT'::text, 'COMPLETE'::text])) = (sequence = 0));

ALTER TABLE "atlas_manual"."research_effect" ADD CONSTRAINT "research_effect_event_check" CHECK (event = ANY (ARRAY['INIT'::text, 'DISPATCH'::text, 'RESPONSE'::text, 'FAILURE'::text, 'COMPLETE'::text]));

ALTER TABLE "atlas_manual"."research_effect" ADD CONSTRAINT "research_effect_pkey" PRIMARY KEY (card_id, request_id, sequence, event);

ALTER TABLE "atlas_manual"."research_effect" ADD CONSTRAINT "research_effect_request_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual"."research_effect" ADD CONSTRAINT "research_effect_sequence_check" CHECK (sequence >= 0 AND sequence <= 128);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_access_version_check" CHECK (access_version > 0);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_analysis_action_id_key" UNIQUE (analysis_action_id);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_analysis_attempt_check" CHECK (analysis_attempt >= 0 AND analysis_attempt <= 3);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_attempts_check" CHECK (attempts >= 0);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_card_id_source_hash_key" UNIQUE (card_id, source_hash);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_check" CHECK (input_hash = encode(sha256(convert_to(input, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_check1" CHECK ((state = 'RUNNING'::text) = (claim_id IS NOT NULL AND lease_until IS NOT NULL));

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_check2" CHECK (state = 'RUNNING'::text OR claim_id IS NULL AND lease_until IS NULL);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_code_check" CHECK (code IS NULL OR code ~ '^[A-Z][A-Z0-9_]{0,100}$'::text);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_evidence_check" CHECK (octet_length(evidence) <= 65536 AND jsonb_typeof(evidence::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_input_check" CHECK (octet_length(input) <= 8192 AND jsonb_typeof(input::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_key_check" CHECK (key ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_pkey" PRIMARY KEY (key);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_source_hash_check" CHECK (source_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_stage_check" CHECK (stage = ANY (ARRAY['PREPARE'::text, 'ANALYZE'::text, 'REPORT'::text]));

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_state_check" CHECK (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'REVIEW'::text, 'NEEDS_ATTENTION'::text, 'SUPERSEDED'::text, 'APPROVED'::text]));

ALTER TABLE "atlas_manual_connected"."batch_request" ADD CONSTRAINT "batch_request_pkey" PRIMARY KEY (actor_id, action_id);

ALTER TABLE "atlas_manual_connected"."batch_request" ADD CONSTRAINT "batch_request_request_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."batch_review" ADD CONSTRAINT "batch_review_check" CHECK (input_hash = encode(sha256(convert_to(input, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."batch_review" ADD CONSTRAINT "batch_review_input_check" CHECK (octet_length(input) <= 4096 AND jsonb_typeof(input::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."batch_review" ADD CONSTRAINT "batch_review_pkey" PRIMARY KEY (job_key);

ALTER TABLE "atlas_manual_connected"."card_image_binding" ADD CONSTRAINT "card_image_binding_original_sha256_check" CHECK (original_sha256 ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."card_image_binding" ADD CONSTRAINT "card_image_binding_pkey" PRIMARY KEY (upload_id);

ALTER TABLE "atlas_manual_connected"."card_image_binding" ADD CONSTRAINT "card_image_binding_side_check" CHECK (side = ANY (ARRAY['FRONT'::text, 'BACK'::text]));

ALTER TABLE "atlas_manual_connected"."card_image_intent" ADD CONSTRAINT "card_image_intent_mode_check" CHECK (mode = ANY (ARRAY['LOCAL_FIXTURE'::text, 'PRODUCTION'::text]));

ALTER TABLE "atlas_manual_connected"."card_image_intent" ADD CONSTRAINT "card_image_intent_pkey" PRIMARY KEY (upload_id);

ALTER TABLE "atlas_manual_connected"."details" ADD CONSTRAINT "details_check" CHECK (content_hash = encode(sha256(convert_to(content, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."details" ADD CONSTRAINT "details_content_check" CHECK (octet_length(content) <= 16384 AND jsonb_typeof(content::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."details" ADD CONSTRAINT "details_pkey" PRIMARY KEY (card_id);

ALTER TABLE "atlas_manual_connected"."details" ADD CONSTRAINT "details_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_manual_connected"."details_action" ADD CONSTRAINT "details_action_pkey" PRIMARY KEY (card_id, action_id);

ALTER TABLE "atlas_manual_connected"."details_action" ADD CONSTRAINT "details_action_result_check" CHECK (octet_length(result) <= 32768);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_access_version_check" CHECK (access_version > 0);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_attempts_check" CHECK (attempts >= 0);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_check" CHECK (octet_length(input) <= 32768 AND key = encode(sha256(convert_to(input, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_check1" CHECK (state = 'RUNNING'::text AND claim_id IS NOT NULL AND lease_until IS NOT NULL OR state <> 'RUNNING'::text AND claim_id IS NULL AND lease_until IS NULL);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_check2" CHECK ((state = ANY (ARRAY['READY'::text, 'NEEDS_REVIEW'::text])) = (result IS NOT NULL));

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_engine_hash_check" CHECK (engine_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_error_check" CHECK (error IS NULL OR error ~ '^[A-Z][A-Z0-9_]{0,100}$'::text);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_key_check" CHECK (key ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_pkey" PRIMARY KEY (key);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_result_check" CHECK (result IS NULL OR octet_length(result) <= 32768 AND jsonb_typeof(result::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_side_check" CHECK (side = ANY (ARRAY['FRONT'::text, 'BACK'::text]));

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_state_check" CHECK (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'READY'::text, 'NEEDS_REVIEW'::text, 'FAILED'::text]));

ALTER TABLE "atlas_manual_connected"."early_geometry_intent" ADD CONSTRAINT "early_geometry_intent_access_version_check" CHECK (access_version > 0);

ALTER TABLE "atlas_manual_connected"."early_geometry_intent" ADD CONSTRAINT "early_geometry_intent_pkey" PRIMARY KEY (upload_id);

ALTER TABLE "atlas_manual_connected"."effect" ADD CONSTRAINT "effect_event_check" CHECK (event = ANY (ARRAY['DISPATCH'::text, 'RESPONSE'::text, 'FAILURE'::text]));

ALTER TABLE "atlas_manual_connected"."effect" ADD CONSTRAINT "effect_evidence_check" CHECK (octet_length(evidence) <= 16384);

ALTER TABLE "atlas_manual_connected"."effect" ADD CONSTRAINT "effect_pkey" PRIMARY KEY (attempt_id, stage, event);

ALTER TABLE "atlas_manual_connected"."effect" ADD CONSTRAINT "effect_request_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."effect" ADD CONSTRAINT "effect_stage_check" CHECK (stage = ANY (ARRAY['OCR_FRONT'::text, 'OCR_BACK'::text, 'MODEL'::text]));

ALTER TABLE "atlas_manual_connected"."geometry_claim_capacity" ADD CONSTRAINT "geometry_claim_capacity_concurrency_check" CHECK (concurrency >= 1 AND concurrency <= 12);

ALTER TABLE "atlas_manual_connected"."geometry_claim_capacity" ADD CONSTRAINT "geometry_claim_capacity_pkey" PRIMARY KEY (singleton);

ALTER TABLE "atlas_manual_connected"."geometry_claim_capacity" ADD CONSTRAINT "geometry_claim_capacity_singleton_check" CHECK (singleton);

ALTER TABLE "atlas_manual_connected"."geometry_model_action" ADD CONSTRAINT "geometry_model_action_attempt_check" CHECK (attempt >= 1 AND attempt <= 3);

ALTER TABLE "atlas_manual_connected"."geometry_model_action" ADD CONSTRAINT "geometry_model_action_check" CHECK ((response IS NULL) = (received_at IS NULL));

ALTER TABLE "atlas_manual_connected"."geometry_model_action" ADD CONSTRAINT "geometry_model_action_check1" CHECK (retry_authorized_at IS NULL OR response IS NOT NULL);

ALTER TABLE "atlas_manual_connected"."geometry_model_action" ADD CONSTRAINT "geometry_model_action_pkey" PRIMARY KEY (job_key, attempt);

ALTER TABLE "atlas_manual_connected"."geometry_model_action" ADD CONSTRAINT "geometry_model_action_request_check" CHECK (octet_length(request) <= 32768 AND jsonb_typeof(request::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."geometry_model_action" ADD CONSTRAINT "geometry_model_action_request_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."geometry_model_action" ADD CONSTRAINT "geometry_model_action_response_check" CHECK (response IS NULL OR octet_length(response) <= 32768 AND jsonb_typeof(response::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."identification" ADD CONSTRAINT "identification_input_check" CHECK (octet_length(input) <= 16384);

ALTER TABLE "atlas_manual_connected"."identification" ADD CONSTRAINT "identification_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_manual_connected"."identification" ADD CONSTRAINT "identification_result_check" CHECK (octet_length(result) <= 16384);

ALTER TABLE "atlas_manual_connected"."identification" ADD CONSTRAINT "identification_retry_lineage_complete" CHECK (retry_of IS NULL AND retry_action_id IS NULL AND evidence_attempt_id IS NULL OR retry_of IS NOT NULL AND retry_action_id IS NOT NULL AND evidence_attempt_id IS NOT NULL);

ALTER TABLE "atlas_manual_connected"."identification" ADD CONSTRAINT "identification_source_hash_check" CHECK (source_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."identification" ADD CONSTRAINT "identification_state_check" CHECK (state = ANY (ARRAY['RUNNING'::text, 'COMPLETE'::text, 'FAILED'::text, 'UNKNOWN'::text, 'STALE'::text]));

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_access_version_check" CHECK (access_version > 0);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_attempts_check" CHECK (attempts >= 0 AND attempts <= 6);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_audit_check" CHECK (jsonb_typeof(audit) = 'array'::text AND jsonb_array_length(audit) <= 2048 AND octet_length(audit::text) <= 262144);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_check" CHECK ((state = ANY (ARRAY['RUNNING'::text, 'REQUESTED'::text])) = (claim_id IS NOT NULL AND lease_until IS NOT NULL));

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_check1" CHECK ((state = ANY (ARRAY['RUNNING'::text, 'REQUESTED'::text])) OR claim_id IS NULL AND lease_until IS NULL);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_check2" CHECK (state <> 'REQUESTED'::text OR dispatch_id = claim_id AND public_hash IS NOT NULL);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_check3" CHECK (state <> 'READY'::text OR response IS NOT NULL);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_check4" CHECK ((response IS NULL) = (response_hash IS NULL));

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_check5" CHECK (response IS NULL OR dispatch_id IS NOT NULL AND octet_length(response) <= 524288 AND jsonb_typeof(response::jsonb) = 'object'::text AND response_hash = encode(sha256(convert_to(response, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_code_check" CHECK (code ~ '^[A-Z][A-Z0-9_]{0,100}$'::text);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_mode_check" CHECK (mode = ANY (ARRAY['LOCAL_FIXTURE'::text, 'PRODUCTION'::text]));

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_origin_check" CHECK (origin = ANY (ARRAY['APPROVAL'::text, 'REFRESH'::text, 'BACKFILL'::text]));

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_pkey" PRIMARY KEY (request_id);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_public_hash_check" CHECK (public_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_recoveries_check" CHECK (recoveries >= 0);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_report_hash_check" CHECK (report_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_source_hash_check" CHECK (source_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_state_check" CHECK (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'REQUESTED'::text, 'READY'::text, 'FAILED'::text, 'UNKNOWN'::text, 'UNAVAILABLE'::text]));

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_attempts_check" CHECK (attempts >= 0);

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_card_id_action_id_side_policy_key" UNIQUE (card_id, action_id, side, policy);

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_check" CHECK (octet_length(manifest) <= 16384 AND jsonb_typeof(manifest::jsonb) = 'object'::text AND manifest_hash = encode(sha256(convert_to(manifest, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_check1" CHECK ((state = 'RUNNING'::text) = (claim_id IS NOT NULL AND lease_until IS NOT NULL));

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_check2" CHECK (state = 'RUNNING'::text OR claim_id IS NULL AND lease_until IS NULL);

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_check3" CHECK ((state = 'READY'::text) = (result IS NOT NULL AND result_hash IS NOT NULL AND source_image_hash IS NOT NULL));

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_check4" CHECK (result IS NULL OR octet_length(result) <= 32768 AND jsonb_typeof(result::jsonb) = 'object'::text AND result_hash = encode(sha256(convert_to(result, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_code_check" CHECK (code ~ '^[A-Z][A-Z0-9_]{0,100}$'::text);

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_mode_check" CHECK (mode = ANY (ARRAY['LOCAL_FIXTURE'::text, 'PRODUCTION'::text]));

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_policy_check" CHECK (policy = 'atlas-review-delivery-v1'::text);

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_side_check" CHECK (side = ANY (ARRAY['FRONT'::text, 'BACK'::text]));

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_source_image_hash_check" CHECK (source_image_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_state_check" CHECK (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'READY'::text, 'FAILED'::text, 'SUPERSEDED'::text]));

ALTER TABLE "atlas_manual_connected"."report_image_binding" ADD CONSTRAINT "report_image_binding_manifest_hash_check" CHECK (manifest_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."report_image_binding" ADD CONSTRAINT "report_image_binding_original_sha256_check" CHECK (original_sha256 ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."report_image_binding" ADD CONSTRAINT "report_image_binding_pkey" PRIMARY KEY (card_id, action_id, side);

ALTER TABLE "atlas_manual_connected"."report_image_binding" ADD CONSTRAINT "report_image_binding_report_source_hash_check" CHECK (report_source_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."report_image_binding" ADD CONSTRAINT "report_image_binding_side_check" CHECK (side = ANY (ARRAY['FRONT'::text, 'BACK'::text]));

ALTER TABLE "atlas_manual_connected"."report_image_binding" ADD CONSTRAINT "report_image_generation_binding" CHECK ((report_source_hash IS NULL) = (original_sha256 IS NULL));

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_attempts_check" CHECK (attempts >= 0 AND attempts <= 6);

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_audit_check" CHECK (jsonb_typeof(audit) = 'array'::text AND jsonb_array_length(audit) <= 20 AND octet_length(audit::text) <= 65536);

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_check" CHECK (octet_length(recipe) <= 8192 AND jsonb_typeof(recipe::jsonb) = 'object'::text AND recipe_hash = encode(sha256(convert_to(recipe, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_check1" CHECK (octet_length(source_media) <= 32768 AND jsonb_typeof(source_media::jsonb) = 'object'::text AND source_media_hash = encode(sha256(convert_to(source_media, 'UTF8'::name)), 'hex'::text) AND ((((source_media::jsonb -> 'descriptor'::text) -> 'raster'::text) -> 'content'::text) ->> 'sha256'::text) = source_hash);

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_check2" CHECK ((state = ANY (ARRAY['RUNNING'::text, 'REQUESTED'::text])) = (claim_id IS NOT NULL AND lease_until IS NOT NULL));

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_check3" CHECK ((state = ANY (ARRAY['RUNNING'::text, 'REQUESTED'::text])) OR claim_id IS NULL AND lease_until IS NULL);

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_check4" CHECK ((state = 'READY'::text) = (result IS NOT NULL AND result_hash IS NOT NULL));

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_check5" CHECK (result IS NULL OR octet_length(result) <= 65536 AND jsonb_typeof(result::jsonb) = 'object'::text AND result_hash = encode(sha256(convert_to(result, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_code_check" CHECK (code ~ '^[A-Z][A-Z0-9_]{0,100}$'::text);

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_key_check" CHECK (key ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_mode_check" CHECK (mode = ANY (ARRAY['LOCAL_FIXTURE'::text, 'PRODUCTION'::text]));

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_pkey" PRIMARY KEY (key);

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_recipe_hash_check" CHECK (recipe_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_source_hash_check" CHECK (source_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_state_check" CHECK (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'REQUESTED'::text, 'READY'::text, 'FAILED'::text, 'UNKNOWN'::text]));

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_access_version_check" CHECK (access_version > 0);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_attempts_check" CHECK (attempts >= 0);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_check" CHECK (octet_length(photo_source) <= 16384 AND jsonb_typeof(photo_source::jsonb) = 'object'::text AND ((photo_source::jsonb -> 'ref'::text) ->> 'sha256'::text) = photo_hash);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_check1" CHECK (prepared IS NULL OR octet_length(prepared) <= 16384 AND jsonb_typeof(prepared::jsonb) = 'object'::text AND variant = ('inspection:'::text || ((prepared::jsonb -> 'ref'::text) ->> 'sha256'::text)));

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_check2" CHECK ((recovery = 0) = (retry_of IS NULL AND retry_action IS NULL));

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_check3" CHECK ((variant ~~ 'inspection:%'::text) = (prepared IS NOT NULL));

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_check4" CHECK ((state = 'RUNNING'::text) = (claim_id IS NOT NULL AND lease_until IS NOT NULL));

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_check5" CHECK (state = 'RUNNING'::text OR claim_id IS NULL AND lease_until IS NULL);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_check6" CHECK ((state = 'READY'::text) = (result IS NOT NULL AND result_hash IS NOT NULL AND source_image_hash IS NOT NULL));

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_check7" CHECK (result IS NULL OR octet_length(result) <= 32768 AND jsonb_typeof(result::jsonb) = 'object'::text AND result_hash = encode(sha256(convert_to(result, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_code_check" CHECK (code ~ '^[A-Z][A-Z0-9_]{0,100}$'::text);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_photo_hash_check" CHECK (photo_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_photo_hash_variant_policy_access_version_rec_key" UNIQUE (photo_hash, variant, policy, access_version, recovery);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_policy_check" CHECK (policy = 'atlas-review-delivery-v1'::text);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_recovery_check" CHECK (recovery >= 0 AND recovery <= 3);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_retry_action_key" UNIQUE (retry_action);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_retry_of_key" UNIQUE (retry_of);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_side_check" CHECK (side = ANY (ARRAY['FRONT'::text, 'BACK'::text]));

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_source_image_hash_check" CHECK (source_image_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_state_check" CHECK (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'READY'::text, 'FAILED'::text, 'SUPERSEDED'::text]));

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_variant_check" CHECK (variant ~ '^(context|full|inspection:[a-f0-9]{64})$'::text);

ALTER TABLE "atlas_manual_connected"."station_active" ADD CONSTRAINT "station_active_intent_id_key" UNIQUE (intent_id);

ALTER TABLE "atlas_manual_connected"."station_active" ADD CONSTRAINT "station_active_pkey" PRIMARY KEY (station_id);

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_actor_id_request_id_key" UNIQUE (actor_id, request_id);

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_authorization_envelope_check" CHECK (octet_length(authorization_envelope) <= 12288 AND jsonb_typeof(authorization_envelope::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_card_id_approval_action_id_key" UNIQUE (card_id, approval_action_id);

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_check" CHECK (request_hash = encode(sha256(convert_to(request, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_check1" CHECK (authorization_hash = encode(sha256(convert_to(claims, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_check2" CHECK (authorization_envelope_hash = encode(sha256(convert_to(authorization_envelope, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_check3" CHECK (expires_at > created_at AND expires_at <= (created_at + '00:15:00'::interval));

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_claims_check" CHECK (octet_length(claims) <= 8192 AND jsonb_typeof(claims::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_intent_id_check" CHECK (intent_id ~ '^afnfc_[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_pkey" PRIMARY KEY (intent_id);

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_request_check" CHECK (octet_length(request) <= 4096 AND jsonb_typeof(request::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."station_challenge" ADD CONSTRAINT "station_challenge_actor_id_request_id_key" UNIQUE (actor_id, request_id);

ALTER TABLE "atlas_manual_connected"."station_challenge" ADD CONSTRAINT "station_challenge_check" CHECK (content_hash = encode(sha256(convert_to(content, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."station_challenge" ADD CONSTRAINT "station_challenge_check1" CHECK (expires_at > created_at AND expires_at <= (created_at + '00:02:00'::interval));

ALTER TABLE "atlas_manual_connected"."station_challenge" ADD CONSTRAINT "station_challenge_content_check" CHECK (octet_length(content) <= 4096 AND jsonb_typeof(content::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."station_challenge" ADD CONSTRAINT "station_challenge_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_manual_connected"."station_challenge" ADD CONSTRAINT "station_challenge_station_id_check" CHECK (station_id ~ '^[A-Za-z0-9_-]{1,128}$'::text);

ALTER TABLE "atlas_manual_connected"."station_enrollment" ADD CONSTRAINT "station_enrollment_challenge_id_key" UNIQUE (challenge_id);

ALTER TABLE "atlas_manual_connected"."station_enrollment" ADD CONSTRAINT "station_enrollment_check" CHECK (proof_hash = encode(sha256(convert_to(proof, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."station_enrollment" ADD CONSTRAINT "station_enrollment_key_fingerprint_check" CHECK (key_fingerprint ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."station_enrollment" ADD CONSTRAINT "station_enrollment_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_manual_connected"."station_enrollment" ADD CONSTRAINT "station_enrollment_proof_check" CHECK (octet_length(proof) <= 4096 AND jsonb_typeof(proof::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."station_enrollment" ADD CONSTRAINT "station_enrollment_protection_evidence_hash_check" CHECK (protection_evidence_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."station_enrollment" ADD CONSTRAINT "station_enrollment_public_key_spki_check" CHECK (octet_length(public_key_spki) <= 256);

ALTER TABLE "atlas_manual_connected"."station_enrollment" ADD CONSTRAINT "station_enrollment_signature_check" CHECK (octet_length(signature) <= 256);

ALTER TABLE "atlas_manual_connected"."station_pairing" ADD CONSTRAINT "station_pairing_check" CHECK (proof_hash = encode(sha256(convert_to(proof, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."station_pairing" ADD CONSTRAINT "station_pairing_pkey" PRIMARY KEY (challenge_id);

ALTER TABLE "atlas_manual_connected"."station_pairing" ADD CONSTRAINT "station_pairing_proof_check" CHECK (octet_length(proof) <= 4096 AND jsonb_typeof(proof::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."station_pairing" ADD CONSTRAINT "station_pairing_signature_check" CHECK (octet_length(signature) <= 256);

ALTER TABLE "atlas_manual_connected"."station_receipt" ADD CONSTRAINT "station_receipt_check" CHECK (receipt_hash = encode(sha256(convert_to(receipt, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."station_receipt" ADD CONSTRAINT "station_receipt_kind_check" CHECK (kind = ANY (ARRAY['WRITE'::text, 'REMOVAL'::text]));

ALTER TABLE "atlas_manual_connected"."station_receipt" ADD CONSTRAINT "station_receipt_pkey" PRIMARY KEY (intent_id, kind);

ALTER TABLE "atlas_manual_connected"."station_receipt" ADD CONSTRAINT "station_receipt_receipt_check" CHECK (octet_length(receipt) <= 4096 AND jsonb_typeof(receipt::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."station_receipt" ADD CONSTRAINT "station_receipt_signature_check" CHECK (octet_length(signature) <= 256);

ALTER TABLE "atlas_manual_connected"."variant_catalog_cache" ADD CONSTRAINT "variant_catalog_cache_check" CHECK (snapshot_hash = encode(sha256(convert_to(snapshot, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."variant_catalog_cache" ADD CONSTRAINT "variant_catalog_cache_pkey" PRIMARY KEY (key, snapshot_hash);

ALTER TABLE "atlas_manual_connected"."variant_catalog_cache" ADD CONSTRAINT "variant_catalog_cache_snapshot_check" CHECK (octet_length(snapshot) <= 8388608 AND jsonb_typeof(snapshot::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."variant_confirmation" ADD CONSTRAINT "variant_confirmation_check" CHECK (decision <> 'SELECTED'::text OR job_key IS NOT NULL AND result_hash IS NOT NULL AND catalog_hash IS NOT NULL AND candidate_id IS NOT NULL);

ALTER TABLE "atlas_manual_connected"."variant_confirmation" ADD CONSTRAINT "variant_confirmation_decision_check" CHECK (decision = ANY (ARRAY['SELECTED'::text, 'MANUAL'::text, 'UNRESOLVED'::text]));

ALTER TABLE "atlas_manual_connected"."variant_confirmation" ADD CONSTRAINT "variant_confirmation_identity_hash_check" CHECK (identity_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."variant_confirmation" ADD CONSTRAINT "variant_confirmation_identity_revision_check" CHECK (identity_revision > 0);

ALTER TABLE "atlas_manual_connected"."variant_confirmation" ADD CONSTRAINT "variant_confirmation_pkey" PRIMARY KEY (action_id);

ALTER TABLE "atlas_manual_connected"."variant_confirmation" ADD CONSTRAINT "variant_confirmation_source_hash_check" CHECK (source_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_access_version_check" CHECK (access_version > 0);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_attempts_check" CHECK (attempts >= 0 AND attempts <= 6);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_audit_check" CHECK (jsonb_typeof(audit) = 'array'::text AND octet_length(audit::text) <= 65536);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_card_id_source_hash_identity_revision_policy_ge_key" UNIQUE (card_id, source_hash, identity_revision, policy, generation);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_check" CHECK (input_hash = encode(sha256(convert_to(input, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_check1" CHECK ((state = ANY (ARRAY['RUNNING'::text, 'REQUESTED'::text])) = (claim_id IS NOT NULL AND lease_until IS NOT NULL));

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_check10" CHECK (state <> 'REQUESTED'::text OR dispatch_id IS NOT NULL);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_check2" CHECK ((state = ANY (ARRAY['RUNNING'::text, 'REQUESTED'::text])) OR claim_id IS NULL AND lease_until IS NULL);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_check3" CHECK ((catalog IS NULL) = (catalog_hash IS NULL));

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_check4" CHECK (catalog IS NULL OR octet_length(catalog) <= 4194304 AND jsonb_typeof(catalog::jsonb) = 'object'::text AND catalog_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_check5" CHECK ((response IS NULL) = (response_hash IS NULL));

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_check6" CHECK (response IS NULL OR dispatch_id IS NOT NULL AND octet_length(response) <= 8388608 AND jsonb_typeof(response::jsonb) = 'object'::text AND response_hash = encode(sha256(convert_to(response, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_check7" CHECK ((result IS NULL) = (result_hash IS NULL));

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_check8" CHECK (result IS NULL OR octet_length(result) <= 8388608 AND jsonb_typeof(result::jsonb) = 'object'::text AND result_hash = encode(sha256(convert_to(result, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_check9" CHECK (state <> 'READY'::text OR result IS NOT NULL);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_code_check" CHECK (code IS NULL OR code ~ '^[A-Z][A-Z0-9_]{0,100}$'::text);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_identity_hash_check" CHECK (identity_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_identity_revision_check" CHECK (identity_revision > 0);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_input_check" CHECK (octet_length(input) <= 16384 AND jsonb_typeof(input::jsonb) = 'object'::text);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_key_check" CHECK (key ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_pkey" PRIMARY KEY (key);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_source_hash_check" CHECK (source_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_state_check" CHECK (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'REQUESTED'::text, 'READY'::text, 'FAILED'::text, 'UNKNOWN'::text, 'STALE'::text]));

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_back_version_check" CHECK (back_version >= 0);

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_check" CHECK ((front_upload_id IS NULL) = (front_version = 0));

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_check1" CHECK ((back_upload_id IS NULL) = (back_version = 0));

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_create_request_hash_check" CHECK (create_request_hash ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_front_version_check" CHECK (front_version >= 0);

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_label_check" CHECK (char_length(label) <= 120);

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_owner_id_create_request_id_key" UNIQUE (owner_id, create_request_id);

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_pair_id_key" UNIQUE (pair_id);

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_manual_intake"."discard_request" ADD CONSTRAINT "discard_request_check" CHECK (request_hash = encode(sha256(convert_to(request, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_intake"."discard_request" ADD CONSTRAINT "discard_request_check1" CHECK (receipt_hash = encode(sha256(convert_to(receipt, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_intake"."discard_request" ADD CONSTRAINT "discard_request_pkey" PRIMARY KEY (owner_id, request_id);

ALTER TABLE "atlas_manual_intake"."discard_request" ADD CONSTRAINT "discard_request_request_check" CHECK (octet_length(request) <= 32768);

ALTER TABLE "atlas_manual_intake"."discarded_card" ADD CONSTRAINT "discarded_card_card_id_key" UNIQUE (card_id);

ALTER TABLE "atlas_manual_intake"."discarded_card" ADD CONSTRAINT "discarded_card_pkey" PRIMARY KEY (owner_id, create_request_id);

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_access_version_check" CHECK (access_version > 0);

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_attempts_check" CHECK (attempts >= 0);

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_check" CHECK ((state = 'RUNNING'::text) = (claim_id IS NOT NULL));

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_check1" CHECK ((claim_id IS NULL) = (lease_until IS NULL));

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_code_check" CHECK (code ~ '^[A-Z][A-Z0-9_]{0,100}$'::text);

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_failures_check" CHECK (failures >= 0);

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_pkey" PRIMARY KEY (upload_id);

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_stage_check" CHECK (stage = ANY (ARRAY['VERIFY'::text, 'PREPARE'::text, 'ADMIT'::text]));

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_state_check" CHECK (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'COMPLETE'::text, 'ATTENTION'::text, 'SUPERSEDED'::text]));

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_card_id_id_key" UNIQUE (card_id, id);

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_card_id_request_id_key" UNIQUE (card_id, request_id);

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_card_id_side_version_key" UNIQUE (card_id, side, version);

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_check" CHECK (request_hash = encode(sha256(convert_to(request, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_check1" CHECK (plan_hash = encode(sha256(convert_to(plan, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_check2" CHECK (verification_hash = encode(sha256(convert_to(verification, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_check3" CHECK (source_hash = encode(sha256(convert_to(source, 'UTF8'::name)), 'hex'::text));

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_check4" CHECK ((verification IS NULL) = (verification_hash IS NULL));

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_check5" CHECK ((source IS NULL) = (source_hash IS NULL));

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_check6" CHECK (source IS NULL OR verification IS NOT NULL);

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_plan_check" CHECK (octet_length(plan) <= 8192);

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_request_check" CHECK (octet_length(request) <= 4096);

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_side_check" CHECK (side = ANY (ARRAY['FRONT'::text, 'BACK'::text]));

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_source_check" CHECK (octet_length(source) <= 8192);

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_verification_check" CHECK (octet_length(verification) <= 8192);

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_version_check" CHECK (version > 0);

ALTER TABLE "atlas_staff"."PublicReaderControl" ADD CONSTRAINT "PublicReaderControl_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_staff"."PublicReaderControl" ADD CONSTRAINT "PublicReaderControl_shape" CHECK ((id = 'active'::text AND revision > 0 AND "releaseSha"::text ~ '^[a-f0-9]{40}$'::text AND "configHash"::text ~ '^[a-f0-9]{64}$'::text AND (mode = 'PRODUCTION'::text AND origin = 'https://atlasgrading.com'::text AND "deploymentId" ~ '^[a-z0-9-]+\.vercel\.app$'::text OR mode = 'LOCAL_FIXTURE'::text AND origin = 'http://127.0.0.1:4319'::text AND "deploymentId" = 'local-public-fixture'::text)) IS TRUE);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_accountSid_check" CHECK ("accountSid"::text ~ '^AC[0-9a-fA-F]{32}$'::text);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_allowedDestinationHash_check" CHECK ("allowedDestinationHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_allowedPhoneHash_check" CHECK ("allowedPhoneHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_application_check" CHECK (application = ANY (ARRAY['STAFF'::text, 'CUSTOMER'::text]));

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_binding_check" CHECK (binding IS NULL OR (jsonb_typeof(binding) = 'object'::text AND binding ?& ARRAY['mode'::text, 'origin'::text, 'deploymentId'::text, 'releaseSha'::text, 'configHash'::text] AND (binding - ARRAY['mode'::text, 'origin'::text, 'deploymentId'::text, 'releaseSha'::text, 'configHash'::text]) = '{}'::jsonb AND (binding ->> 'mode'::text) = 'PRODUCTION'::text AND (binding ->> 'origin'::text) = 'https://atlasgrading.com'::text AND jsonb_typeof(binding -> 'deploymentId'::text) = 'string'::text AND length(binding ->> 'deploymentId'::text) >= 1 AND length(binding ->> 'deploymentId'::text) <= 253 AND (binding ->> 'releaseSha'::text) ~ '^[a-f0-9]{40}$'::text AND (binding ->> 'releaseSha'::text) <> repeat('0'::text, 40) AND (binding ->> 'configHash'::text) ~ '^[a-f0-9]{64}$'::text) IS TRUE);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_check" CHECK ("activatedAt" IS NULL AND "expiresAt" IS NULL AND NOT enabled OR "activatedAt" IS NOT NULL AND "expiresAt" = ("activatedAt" + '168:00:00'::interval) AND "pilotId" IS NOT NULL AND "allowedPhoneHash" IS NOT NULL AND "allowedDestinationHash" IS NOT NULL AND "accountSid" IS NOT NULL AND "serviceSid" IS NOT NULL AND "feeEvidenceHash" IS NOT NULL AND binding IS NOT NULL);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_feeEvidenceHash_check" CHECK ("feeEvidenceHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_maxClaims_check" CHECK ("maxClaims" = 10);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_maxReservedMicroUsd_check" CHECK ("maxReservedMicroUsd" = 5000000);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_pkey" PRIMARY KEY (application);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_public_customer_only" CHECK (NOT "publicCustomerAdmission" OR application = 'CUSTOMER'::text);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_reservationMicroUsd_check" CHECK ("reservationMicroUsd" = 500000);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_revision_check" CHECK (revision > 0);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_serviceSid_check" CHECK ("serviceSid"::text ~ '^VA[0-9a-fA-F]{32}$'::text);

ALTER TABLE "atlas_staff"."SmsPilotControl" ADD CONSTRAINT "SmsPilotControl_serviceSid_key" UNIQUE ("serviceSid");

ALTER TABLE "atlas_staff"."SmsPilotReservation" ADD CONSTRAINT "SmsPilotReservation_application_challengeId_key" UNIQUE (application, "challengeId");

ALTER TABLE "atlas_staff"."SmsPilotReservation" ADD CONSTRAINT "SmsPilotReservation_browserHash_check" CHECK ("browserHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_staff"."SmsPilotReservation" ADD CONSTRAINT "SmsPilotReservation_challengeId_check" CHECK ("challengeId"::text ~ '^[A-Za-z0-9_-]{43}$'::text);

ALTER TABLE "atlas_staff"."SmsPilotReservation" ADD CONSTRAINT "SmsPilotReservation_controlRevision_check" CHECK ("controlRevision" > 0);

ALTER TABLE "atlas_staff"."SmsPilotReservation" ADD CONSTRAINT "SmsPilotReservation_phoneHash_check" CHECK ("phoneHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_staff"."SmsPilotReservation" ADD CONSTRAINT "SmsPilotReservation_pkey" PRIMARY KEY (application, "sendClaimId");

ALTER TABLE "atlas_staff"."SmsPilotReservation" ADD CONSTRAINT "SmsPilotReservation_policyRevision_check" CHECK ("policyRevision" > 0);

ALTER TABLE "atlas_staff"."SmsPilotReservation" ADD CONSTRAINT "SmsPilotReservation_requestId_check" CHECK ("requestId"::text ~ '^[A-Za-z0-9_-]{8,80}$'::text);

ALTER TABLE "atlas_staff"."SmsPilotReservation" ADD CONSTRAINT "SmsPilotReservation_reservedMicroUsd_check" CHECK ("reservedMicroUsd" = 500000);

ALTER TABLE "atlas_staff"."StaffAudit" ADD CONSTRAINT "StaffAudit_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_staff"."StaffAudit" ADD CONSTRAINT "StaffAudit_shape" CHECK (octet_length(details) <= 16384 AND jsonb_typeof(details::jsonb) = 'object'::text);

ALTER TABLE "atlas_staff"."StaffBrowser" ADD CONSTRAINT "StaffBrowser_pkey" PRIMARY KEY ("tokenHash");

ALTER TABLE "atlas_staff"."StaffBrowser" ADD CONSTRAINT "StaffBrowser_shape" CHECK ("tokenHash"::text ~ '^[a-f0-9]{64}$'::text AND "controlRevision" > 0 AND "expiresAt" > "createdAt" AND ("expiresAt" <= ("createdAt" + '01:00:00'::interval) OR "expiresAt" = '9999-12-31 23:59:59.999'::timestamp without time zone));

ALTER TABLE "atlas_staff"."StaffChallenge" ADD CONSTRAINT "StaffChallenge_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_staff"."StaffChallenge" ADD CONSTRAINT "StaffChallenge_shape" CHECK ((id::text ~ '^[A-Za-z0-9_-]{43}$'::text AND "phoneHash"::text ~ '^[a-f0-9]{64}$'::text AND "controlRevision" > 0 AND "accountSid"::text ~ '^AC[0-9a-fA-F]{32}$'::text AND "serviceSid"::text ~ '^VA[0-9a-fA-F]{32}$'::text AND (state = ANY (ARRAY['SENDING'::text, 'PENDING'::text, 'CHECKING'::text, 'UNKNOWN'::text, 'SUPERSEDED'::text, 'CONSUMED'::text])) AND attempts >= 0 AND attempts <= 5 AND "expiresAt" > "createdAt" AND "expiresAt" <= ("createdAt" + '00:05:00'::interval) AND "quarantineUntil" >= "expiresAt" AND "quarantineUntil" <= ("createdAt" + '25:00:00'::interval) AND ((state <> ALL (ARRAY['PENDING'::text, 'CHECKING'::text, 'CONSUMED'::text])) OR "verificationSid"::text ~ '^VE[0-9a-fA-F]{32}$'::text) AND (state <> 'PENDING'::text OR "checkClaimId" IS NULL) AND (state <> 'CHECKING'::text OR "checkClaimId" IS NOT NULL) AND (state = 'CONSUMED'::text AND "consumedAt" IS NOT NULL AND "checkClaimId" IS NOT NULL AND "replayHash"::text ~ '^[a-f0-9]{64}$'::text AND "replayUntil" <= "expiresAt" AND "replayUntil" <= ("consumedAt" + '00:01:00'::interval) OR state <> 'CONSUMED'::text AND "consumedAt" IS NULL AND "replayHash" IS NULL AND "replayUntil" IS NULL)) IS TRUE);

ALTER TABLE "atlas_staff"."StaffControl" ADD CONSTRAINT "StaffControl_grading_policy" CHECK ("gradingPolicyHash" IS NULL OR "gradingPolicyHash"::text ~ '^[a-f0-9]{64}$'::text);

ALTER TABLE "atlas_staff"."StaffControl" ADD CONSTRAINT "StaffControl_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_staff"."StaffControl" ADD CONSTRAINT "StaffControl_shape" CHECK (id = 'active'::text AND revision > 0 AND "configHash"::text ~ '^[a-f0-9]{64}$'::text AND "releaseSha"::text ~ '^[a-f0-9]{40}$'::text AND (mode = 'PRODUCTION'::text AND origin = 'https://atlasgrading.com'::text OR mode = 'PRODUCTION'::text AND origin = 'https://app.atlasgrading.com'::text AND NOT enabled OR mode = 'LOCAL_FIXTURE'::text AND origin = 'http://127.0.0.1:4318'::text));

ALTER TABLE "atlas_staff"."StaffIdentity" ADD CONSTRAINT "StaffIdentity_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_staff"."StaffIdentity" ADD CONSTRAINT "StaffIdentity_shape" CHECK ("phoneHash"::text ~ '^[a-f0-9]{64}$'::text AND (role = ANY (ARRAY['REVIEWER'::text, 'OBSERVER'::text])) AND "accessVersion" > 0);

ALTER TABLE "atlas_staff"."StaffOperationsGrant" ADD CONSTRAINT "StaffOperationsGrant_check" CHECK (("accessVersion" > 0 AND "controlRevision" > 0 AND (mode = ANY (ARRAY['PRODUCTION'::text, 'LOCAL_FIXTURE'::text])) AND "releaseSha"::text ~ '^[a-f0-9]{40}$'::text AND "configHash"::text ~ '^[a-f0-9]{64}$'::text AND "authorizationEvidenceHash"::text ~ '^[a-f0-9]{64}$'::text AND "expiresAt" > "createdAt" AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")) IS TRUE);

ALTER TABLE "atlas_staff"."StaffOperationsGrant" ADD CONSTRAINT "StaffOperationsGrant_pkey" PRIMARY KEY (id);

ALTER TABLE "atlas_staff"."StaffRateBucket" ADD CONSTRAINT "StaffRateBucket_pkey" PRIMARY KEY (key);

ALTER TABLE "atlas_staff"."StaffRateBucket" ADD CONSTRAINT "StaffRateBucket_shape" CHECK (count > 0);

ALTER TABLE "atlas_staff"."StaffSession" ADD CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("tokenHash");

ALTER TABLE "atlas_staff"."StaffSession" ADD CONSTRAINT "StaffSession_shape" CHECK ("tokenHash"::text ~ '^[a-f0-9]{64}$'::text AND "accessVersion" > 0 AND "controlRevision" > 0 AND "expiresAt" > "createdAt" AND ("expiresAt" <= ("createdAt" + '00:30:00'::interval) OR "expiresAt" = '9999-12-31 23:59:59.999'::timestamp without time zone));

ALTER TABLE "atlas_customer"."CommerceEffect" ADD CONSTRAINT "CommerceEffect_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES atlas_customer."CommerceOrder"(id);

ALTER TABLE "atlas_customer"."CommerceOrder" ADD CONSTRAINT "CommerceOrder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."CommerceOrder" ADD CONSTRAINT "CommerceOrder_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES atlas_customer."CommercePayment"(id);

ALTER TABLE "atlas_customer"."CommerceOrder" ADD CONSTRAINT "CommerceOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES atlas_customer."CommerceQuote"(id);

ALTER TABLE "atlas_customer"."CommercePayment" ADD CONSTRAINT "CommercePayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."CommercePayment" ADD CONSTRAINT "CommercePayment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES atlas_customer."CommerceQuote"(id);

ALTER TABLE "atlas_customer"."CommerceProviderEvent" ADD CONSTRAINT "CommerceProviderEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES atlas_customer."CommercePayment"(id);

ALTER TABLE "atlas_customer"."CommerceQuote" ADD CONSTRAINT "CommerceQuote_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."CommerceShippingPayment" ADD CONSTRAINT "CommerceShippingPayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."CommerceShippingPayment" ADD CONSTRAINT "CommerceShippingPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES atlas_customer."CommerceOrder"(id);

ALTER TABLE "atlas_customer"."CommerceShippingPayment" ADD CONSTRAINT "CommerceShippingPayment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES atlas_customer."CommerceShippingQuote"(id);

ALTER TABLE "atlas_customer"."CommerceShippingProviderEvent" ADD CONSTRAINT "CommerceShippingProviderEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES atlas_customer."CommerceShippingPayment"(id);

ALTER TABLE "atlas_customer"."CommerceShippingQuote" ADD CONSTRAINT "CommerceShippingQuote_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."CommerceShippingQuote" ADD CONSTRAINT "CommerceShippingQuote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES atlas_customer."CommerceOrder"(id);

ALTER TABLE "atlas_customer"."CommerceShippingReceipt" ADD CONSTRAINT "CommerceShippingReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES atlas_customer."CommerceOrder"(id);

ALTER TABLE "atlas_customer"."CommerceShippingReceipt" ADD CONSTRAINT "CommerceShippingReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES atlas_customer."CommerceShippingPayment"(id);

ALTER TABLE "atlas_customer"."CommerceShippingReceipt" ADD CONSTRAINT "CommerceShippingReceipt_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES atlas_customer."CommerceShippingQuote"(id);

ALTER TABLE "atlas_customer"."CustomerChallenge" ADD CONSTRAINT "CustomerChallenge_browserHash_fkey" FOREIGN KEY ("browserHash") REFERENCES atlas_customer."CustomerBrowser"("tokenHash");

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."CustomerEmailVerification" ADD CONSTRAINT "CustomerEmailVerification_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES atlas_customer."CustomerIntakeDraft"(id);

ALTER TABLE "atlas_customer"."CustomerIntakeCard" ADD CONSTRAINT "CustomerIntakeCard_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES atlas_customer."CustomerIntakeDraft"(id);

ALTER TABLE "atlas_customer"."CustomerIntakeDraft" ADD CONSTRAINT "CustomerIntakeDraft_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."CustomerIntakeEffect" ADD CONSTRAINT "CustomerIntakeEffect_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES atlas_customer."CustomerIntakeIdentification"(id);

ALTER TABLE "atlas_customer"."CustomerIntakeIdentification" ADD CONSTRAINT "CustomerIntakeIdentification_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES atlas_customer."CustomerIntakeCard"(id);

ALTER TABLE "atlas_customer"."CustomerIntakeUpload" ADD CONSTRAINT "CustomerIntakeUpload_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES atlas_customer."CustomerIntakeCard"(id);

ALTER TABLE "atlas_customer"."CustomerSession" ADD CONSTRAINT "CustomerSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."CustomerSession" ADD CONSTRAINT "CustomerSession_browserHash_fkey" FOREIGN KEY ("browserHash") REFERENCES atlas_customer."CustomerBrowser"("tokenHash");

ALTER TABLE "atlas_customer"."CustomerSession" ADD CONSTRAINT "CustomerSession_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES atlas_customer."CustomerChallenge"(id);

ALTER TABLE "atlas_customer"."CustomerVerifiedEmail" ADD CONSTRAINT "CustomerVerifiedEmail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."ProgressNotification" ADD CONSTRAINT "ProgressNotification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."ProgressNotification" ADD CONSTRAINT "ProgressNotification_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES atlas_dealer.order_card(card_id);

ALTER TABLE "atlas_customer"."ProgressPreference" ADD CONSTRAINT "ProgressPreference_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."ProgressPreferenceEvent" ADD CONSTRAINT "ProgressPreferenceEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_customer"."WeeklyCapacityReservation" ADD CONSTRAINT "WeeklyCapacityReservation_channel_weekStartsAt_fkey" FOREIGN KEY (channel, "weekStartsAt") REFERENCES atlas_customer."WeeklyCapacityWeek"(channel, "weekStartsAt");

ALTER TABLE "atlas_customer"."WeeklyCapacityReservation" ADD CONSTRAINT "WeeklyCapacityReservation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES atlas_customer."CommercePayment"(id);

ALTER TABLE "atlas_customer"."WeeklyCapacityWeek" ADD CONSTRAINT "WeeklyCapacityWeek_channel_fkey" FOREIGN KEY (channel) REFERENCES atlas_customer."WeeklyCapacityConfig"(channel);

ALTER TABLE "atlas_dealer"."commission_event" ADD CONSTRAINT "commission_event_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_dealer.order_card(card_id);

ALTER TABLE "atlas_dealer"."custody_event" ADD CONSTRAINT "custody_event_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_dealer"."custody_event" ADD CONSTRAINT "custody_event_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_dealer.order_card(card_id);

ALTER TABLE "atlas_dealer"."custody_event" ADD CONSTRAINT "custody_event_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_dealer"."handoff" ADD CONSTRAINT "handoff_account_id_fkey" FOREIGN KEY (account_id) REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_dealer"."handoff" ADD CONSTRAINT "handoff_location_id_fkey" FOREIGN KEY (location_id) REFERENCES atlas_dealer.location(id);

ALTER TABLE "atlas_dealer"."handoff" ADD CONSTRAINT "handoff_order_id_fkey" FOREIGN KEY (order_id) REFERENCES atlas_customer."CommerceOrder"(id);

ALTER TABLE "atlas_dealer"."handoff_receipt" ADD CONSTRAINT "handoff_receipt_dealer_account_id_fkey" FOREIGN KEY (dealer_account_id) REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_dealer"."handoff_receipt" ADD CONSTRAINT "handoff_receipt_handoff_id_fkey" FOREIGN KEY (handoff_id) REFERENCES atlas_dealer.handoff(id);

ALTER TABLE "atlas_dealer"."handoff_receipt" ADD CONSTRAINT "handoff_receipt_location_id_fkey" FOREIGN KEY (location_id) REFERENCES atlas_dealer.location(id);

ALTER TABLE "atlas_dealer"."handoff_receipt" ADD CONSTRAINT "handoff_receipt_membership_id_fkey" FOREIGN KEY (membership_id) REFERENCES atlas_dealer.membership(id);

ALTER TABLE "atlas_dealer"."location" ADD CONSTRAINT "location_configured_by_fkey" FOREIGN KEY (configured_by) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_dealer"."location_revision" ADD CONSTRAINT "location_revision_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_dealer"."location_revision" ADD CONSTRAINT "location_revision_location_id_fkey" FOREIGN KEY (location_id) REFERENCES atlas_dealer.location(id);

ALTER TABLE "atlas_dealer"."manual_card_link" ADD CONSTRAINT "manual_card_link_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_dealer"."manual_card_link" ADD CONSTRAINT "manual_card_link_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_dealer.order_card(card_id);

ALTER TABLE "atlas_dealer"."manual_card_link" ADD CONSTRAINT "manual_card_link_manual_card_id_fkey" FOREIGN KEY (manual_card_id) REFERENCES atlas_manual.card(id);

ALTER TABLE "atlas_dealer"."manual_card_link" ADD CONSTRAINT "manual_card_link_received_event_id_fkey" FOREIGN KEY (received_event_id) REFERENCES atlas_dealer.custody_event(id);

ALTER TABLE "atlas_dealer"."membership" ADD CONSTRAINT "membership_account_id_fkey" FOREIGN KEY (account_id) REFERENCES atlas_customer."CustomerAccount"(id);

ALTER TABLE "atlas_dealer"."membership" ADD CONSTRAINT "membership_granted_by_fkey" FOREIGN KEY (granted_by) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_dealer"."membership" ADD CONSTRAINT "membership_location_id_fkey" FOREIGN KEY (location_id) REFERENCES atlas_dealer.location(id);

ALTER TABLE "atlas_dealer"."order_card" ADD CONSTRAINT "order_card_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_customer."CustomerIntakeCard"(id);

ALTER TABLE "atlas_dealer"."order_card" ADD CONSTRAINT "order_card_location_id_fkey" FOREIGN KEY (location_id) REFERENCES atlas_dealer.location(id);

ALTER TABLE "atlas_dealer"."order_card" ADD CONSTRAINT "order_card_order_id_fkey" FOREIGN KEY (order_id) REFERENCES atlas_customer."CommerceOrder"(id);

ALTER TABLE "atlas_dealer"."order_inbox_acknowledgment" ADD CONSTRAINT "order_inbox_acknowledgment_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_dealer"."order_inbox_acknowledgment" ADD CONSTRAINT "order_inbox_acknowledgment_order_id_fkey" FOREIGN KEY (order_id) REFERENCES atlas_customer."CommerceOrder"(id);

ALTER TABLE "atlas_dealer"."session" ADD CONSTRAINT "session_membership_id_fkey" FOREIGN KEY (membership_id) REFERENCES atlas_dealer.membership(id);

ALTER TABLE "atlas_defect_analysis"."provider_event" ADD CONSTRAINT "provider_event_analysis_id_fkey" FOREIGN KEY (analysis_id) REFERENCES atlas_defect_analysis.run(id);

ALTER TABLE "atlas_defect_analysis"."receipt" ADD CONSTRAINT "receipt_analysis_id_fkey" FOREIGN KEY (analysis_id) REFERENCES atlas_defect_analysis.run(id);

ALTER TABLE "atlas_defect_analysis"."request_refusal" ADD CONSTRAINT "request_refusal_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_defect_analysis"."request_refusal" ADD CONSTRAINT "request_refusal_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual.card(id);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual.card(id);

ALTER TABLE "atlas_defect_analysis"."run" ADD CONSTRAINT "run_replaces_analysis_id_fkey" FOREIGN KEY (replaces_analysis_id) REFERENCES atlas_defect_analysis.run(id);

ALTER TABLE "atlas_manual"."action" ADD CONSTRAINT "action_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual"."action" ADD CONSTRAINT "action_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual.card(id);

ALTER TABLE "atlas_manual"."approval" ADD CONSTRAINT "approval_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual"."approval" ADD CONSTRAINT "approval_card_id_action_id_fkey" FOREIGN KEY (card_id, action_id) REFERENCES atlas_manual.action(card_id, action_id);

ALTER TABLE "atlas_manual"."card" ADD CONSTRAINT "card_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual"."defect_memory_publication" ADD CONSTRAINT "defect_memory_publication_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual"."defect_memory_publication" ADD CONSTRAINT "defect_memory_publication_card_id_action_id_fkey" FOREIGN KEY (card_id, action_id) REFERENCES atlas_manual.action(card_id, action_id);

ALTER TABLE "atlas_manual"."learning_activation_history" ADD CONSTRAINT "learning_activation_history_active_release_id_fkey" FOREIGN KEY (active_release_id) REFERENCES atlas_manual.learning_release(id);

ALTER TABLE "atlas_manual"."learning_activation_history" ADD CONSTRAINT "learning_activation_history_previous_release_id_fkey" FOREIGN KEY (previous_release_id) REFERENCES atlas_manual.learning_release(id);

ALTER TABLE "atlas_manual"."learning_control" ADD CONSTRAINT "learning_control_active_release_id_fkey" FOREIGN KEY (active_release_id) REFERENCES atlas_manual.learning_release(id);

ALTER TABLE "atlas_manual"."learning_publication" ADD CONSTRAINT "learning_publication_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual"."learning_publication" ADD CONSTRAINT "learning_publication_card_id_action_id_fkey" FOREIGN KEY (card_id, action_id) REFERENCES atlas_manual.action(card_id, action_id);

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual"."learning_publication_job" ADD CONSTRAINT "learning_publication_job_card_id_action_id_fkey" FOREIGN KEY (card_id, action_id) REFERENCES atlas_manual.action(card_id, action_id);

ALTER TABLE "atlas_manual"."learning_release_member" ADD CONSTRAINT "learning_release_member_publication_revision_fkey" FOREIGN KEY (publication_revision) REFERENCES atlas_manual.learning_publication(revision);

ALTER TABLE "atlas_manual"."learning_release_member" ADD CONSTRAINT "learning_release_member_release_id_fkey" FOREIGN KEY (release_id) REFERENCES atlas_manual.learning_release(id);

ALTER TABLE "atlas_manual"."learning_withdrawal" ADD CONSTRAINT "learning_withdrawal_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual"."learning_withdrawal" ADD CONSTRAINT "learning_withdrawal_publication_revision_fkey" FOREIGN KEY (publication_revision) REFERENCES atlas_manual.learning_publication(revision);

ALTER TABLE "atlas_manual"."presentation" ADD CONSTRAINT "presentation_card_id_approval_action_id_fkey" FOREIGN KEY (card_id, approval_action_id) REFERENCES atlas_manual.publication(card_id, action_id);

ALTER TABLE "atlas_manual"."presentation_market" ADD CONSTRAINT "presentation_market_card_id_approval_action_id_fkey" FOREIGN KEY (card_id, approval_action_id) REFERENCES atlas_manual.publication(card_id, action_id);

ALTER TABLE "atlas_manual"."presentation_upload" ADD CONSTRAINT "presentation_upload_card_id_approval_action_id_fkey" FOREIGN KEY (card_id, approval_action_id) REFERENCES atlas_manual.publication(card_id, action_id);

ALTER TABLE "atlas_manual"."public_report_identity" ADD CONSTRAINT "public_report_identity_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual.card(id);

ALTER TABLE "atlas_manual"."publication" ADD CONSTRAINT "publication_card_id_action_id_fkey" FOREIGN KEY (card_id, action_id) REFERENCES atlas_manual.approval(card_id, action_id);

ALTER TABLE "atlas_manual"."publication" ADD CONSTRAINT "publication_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual.public_report_identity(card_id);

ALTER TABLE "atlas_manual"."research_effect" ADD CONSTRAINT "research_effect_card_id_request_id_fkey" FOREIGN KEY (card_id, request_id) REFERENCES atlas_manual.presentation_market(card_id, request_id);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."batch_grading" ADD CONSTRAINT "batch_grading_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual_intake.card(id);

ALTER TABLE "atlas_manual_connected"."batch_request" ADD CONSTRAINT "batch_request_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."batch_review" ADD CONSTRAINT "batch_review_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."batch_review" ADD CONSTRAINT "batch_review_job_key_fkey" FOREIGN KEY (job_key) REFERENCES atlas_manual_connected.batch_grading(key);

ALTER TABLE "atlas_manual_connected"."card_image_binding" ADD CONSTRAINT "card_image_binding_card_id_upload_id_fkey" FOREIGN KEY (card_id, upload_id) REFERENCES atlas_manual_intake.upload(card_id, id);

ALTER TABLE "atlas_manual_connected"."card_image_binding" ADD CONSTRAINT "card_image_binding_job_key_fkey" FOREIGN KEY (job_key) REFERENCES atlas_manual_connected.report_image_job(key);

ALTER TABLE "atlas_manual_connected"."card_image_binding" ADD CONSTRAINT "card_image_binding_upload_id_fkey" FOREIGN KEY (upload_id) REFERENCES atlas_manual_connected.card_image_intent(upload_id);

ALTER TABLE "atlas_manual_connected"."card_image_intent" ADD CONSTRAINT "card_image_intent_card_id_upload_id_fkey" FOREIGN KEY (card_id, upload_id) REFERENCES atlas_manual_intake.upload(card_id, id);

ALTER TABLE "atlas_manual_connected"."details" ADD CONSTRAINT "details_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual_intake.card(id);

ALTER TABLE "atlas_manual_connected"."details_action" ADD CONSTRAINT "details_action_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."details_action" ADD CONSTRAINT "details_action_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual_connected.details(card_id);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual_intake.card(id);

ALTER TABLE "atlas_manual_connected"."early_geometry" ADD CONSTRAINT "early_geometry_upload_id_fkey" FOREIGN KEY (upload_id) REFERENCES atlas_manual_intake.upload(id);

ALTER TABLE "atlas_manual_connected"."early_geometry_intent" ADD CONSTRAINT "early_geometry_intent_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."early_geometry_intent" ADD CONSTRAINT "early_geometry_intent_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual_intake.card(id);

ALTER TABLE "atlas_manual_connected"."early_geometry_intent" ADD CONSTRAINT "early_geometry_intent_upload_id_fkey" FOREIGN KEY (upload_id) REFERENCES atlas_manual_intake.upload(id);

ALTER TABLE "atlas_manual_connected"."effect" ADD CONSTRAINT "effect_attempt_id_fkey" FOREIGN KEY (attempt_id) REFERENCES atlas_manual_connected.identification(id);

ALTER TABLE "atlas_manual_connected"."geometry_model_action" ADD CONSTRAINT "geometry_model_action_job_key_fkey" FOREIGN KEY (job_key) REFERENCES atlas_manual_connected.early_geometry(key);

ALTER TABLE "atlas_manual_connected"."identification" ADD CONSTRAINT "identification_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."identification" ADD CONSTRAINT "identification_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual_intake.card(id);

ALTER TABLE "atlas_manual_connected"."identification" ADD CONSTRAINT "identification_evidence_attempt_id_fkey" FOREIGN KEY (evidence_attempt_id) REFERENCES atlas_manual_connected.identification(id);

ALTER TABLE "atlas_manual_connected"."identification" ADD CONSTRAINT "identification_retry_of_fkey" FOREIGN KEY (retry_of) REFERENCES atlas_manual_connected.identification(id);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_card_id_approval_action_id_fkey" FOREIGN KEY (card_id, approval_action_id) REFERENCES atlas_manual.approval(card_id, action_id);

ALTER TABLE "atlas_manual_connected"."market_job" ADD CONSTRAINT "market_job_card_id_request_id_fkey" FOREIGN KEY (card_id, request_id) REFERENCES atlas_manual.presentation_market(card_id, request_id);

ALTER TABLE "atlas_manual_connected"."published_review_display" ADD CONSTRAINT "published_review_display_card_id_action_id_fkey" FOREIGN KEY (card_id, action_id) REFERENCES atlas_manual.publication(card_id, action_id);

ALTER TABLE "atlas_manual_connected"."report_image_binding" ADD CONSTRAINT "report_image_binding_card_id_action_id_fkey" FOREIGN KEY (card_id, action_id) REFERENCES atlas_manual.publication(card_id, action_id);

ALTER TABLE "atlas_manual_connected"."report_image_binding" ADD CONSTRAINT "report_image_binding_job_key_fkey" FOREIGN KEY (job_key) REFERENCES atlas_manual_connected.report_image_job(key);

ALTER TABLE "atlas_manual_connected"."report_image_job" ADD CONSTRAINT "report_image_job_source_card_id_fkey" FOREIGN KEY (source_card_id) REFERENCES atlas_manual_intake.card(id);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual_intake.card(id);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_retry_of_fkey" FOREIGN KEY (retry_of) REFERENCES atlas_manual_connected.review_display(id);

ALTER TABLE "atlas_manual_connected"."review_display" ADD CONSTRAINT "review_display_upload_id_fkey" FOREIGN KEY (upload_id) REFERENCES atlas_manual_intake.upload(id);

ALTER TABLE "atlas_manual_connected"."station_active" ADD CONSTRAINT "station_active_intent_id_fkey" FOREIGN KEY (intent_id) REFERENCES atlas_manual_connected.station_arm(intent_id);

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_card_id_approval_action_id_fkey" FOREIGN KEY (card_id, approval_action_id) REFERENCES atlas_manual.publication(card_id, action_id);

ALTER TABLE "atlas_manual_connected"."station_arm" ADD CONSTRAINT "station_arm_enrollment_id_fkey" FOREIGN KEY (enrollment_id) REFERENCES atlas_manual_connected.station_enrollment(id);

ALTER TABLE "atlas_manual_connected"."station_challenge" ADD CONSTRAINT "station_challenge_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."station_enrollment" ADD CONSTRAINT "station_enrollment_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."station_enrollment" ADD CONSTRAINT "station_enrollment_challenge_id_fkey" FOREIGN KEY (challenge_id) REFERENCES atlas_manual_connected.station_challenge(id);

ALTER TABLE "atlas_manual_connected"."station_pairing" ADD CONSTRAINT "station_pairing_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_connected"."station_pairing" ADD CONSTRAINT "station_pairing_challenge_id_fkey" FOREIGN KEY (challenge_id) REFERENCES atlas_manual_connected.station_challenge(id);

ALTER TABLE "atlas_manual_connected"."station_pairing" ADD CONSTRAINT "station_pairing_enrollment_id_fkey" FOREIGN KEY (enrollment_id) REFERENCES atlas_manual_connected.station_enrollment(id);

ALTER TABLE "atlas_manual_connected"."station_receipt" ADD CONSTRAINT "station_receipt_intent_id_fkey" FOREIGN KEY (intent_id) REFERENCES atlas_manual_connected.station_arm(intent_id);

ALTER TABLE "atlas_manual_connected"."variant_confirmation" ADD CONSTRAINT "variant_confirmation_card_id_action_id_fkey" FOREIGN KEY (card_id, action_id) REFERENCES atlas_manual.action(card_id, action_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "atlas_manual_connected"."variant_confirmation" ADD CONSTRAINT "variant_confirmation_job_key_fkey" FOREIGN KEY (job_key) REFERENCES atlas_manual_connected.variant_job(key);

ALTER TABLE "atlas_manual_connected"."variant_job" ADD CONSTRAINT "variant_job_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual.card(id);

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_id_back_upload_id_fkey" FOREIGN KEY (id, back_upload_id) REFERENCES atlas_manual_intake.upload(card_id, id);

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_id_front_upload_id_fkey" FOREIGN KEY (id, front_upload_id) REFERENCES atlas_manual_intake.upload(card_id, id);

ALTER TABLE "atlas_manual_intake"."card" ADD CONSTRAINT "card_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_intake"."discard_request" ADD CONSTRAINT "discard_request_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_intake"."discarded_card" ADD CONSTRAINT "discarded_card_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual_intake.card(id);

ALTER TABLE "atlas_manual_intake"."discarded_card" ADD CONSTRAINT "discarded_card_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_intake"."discarded_card" ADD CONSTRAINT "discarded_card_owner_id_request_id_fkey" FOREIGN KEY (owner_id, request_id) REFERENCES atlas_manual_intake.discard_request(owner_id, request_id);

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual_intake.card(id);

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_card_id_upload_id_fkey" FOREIGN KEY (card_id, upload_id) REFERENCES atlas_manual_intake.upload(card_id, id);

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_intake"."ingestion" ADD CONSTRAINT "ingestion_upload_id_fkey" FOREIGN KEY (upload_id) REFERENCES atlas_manual_intake.upload(id);

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES atlas_staff."StaffIdentity"(id);

ALTER TABLE "atlas_manual_intake"."upload" ADD CONSTRAINT "upload_card_id_fkey" FOREIGN KEY (card_id) REFERENCES atlas_manual_intake.card(id);

ALTER TABLE "atlas_staff"."SmsPilotReservation" ADD CONSTRAINT "SmsPilotReservation_application_fkey" FOREIGN KEY (application) REFERENCES atlas_staff."SmsPilotControl"(application);

ALTER TABLE "atlas_staff"."StaffChallenge" ADD CONSTRAINT "StaffChallenge_browserHash_fkey" FOREIGN KEY ("browserHash") REFERENCES atlas_staff."StaffBrowser"("tokenHash") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "atlas_staff"."StaffOperationsGrant" ADD CONSTRAINT "StaffOperationsGrant_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES atlas_staff."StaffIdentity"(id) ON DELETE RESTRICT;

ALTER TABLE "atlas_staff"."StaffSession" ADD CONSTRAINT "StaffSession_browserHash_fkey" FOREIGN KEY ("browserHash") REFERENCES atlas_staff."StaffBrowser"("tokenHash") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "atlas_staff"."StaffSession" ADD CONSTRAINT "StaffSession_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES atlas_staff."StaffChallenge"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "atlas_staff"."StaffSession" ADD CONSTRAINT "StaffSession_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES atlas_staff."StaffIdentity"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX "CommerceOrder_desk_paid" ON atlas_customer."CommerceOrder" USING btree ("paidAt" DESC, id DESC);

CREATE UNIQUE INDEX "CommercePayment_draft_active" ON atlas_customer."CommercePayment" USING btree ("draftId") WHERE (state <> 'CANCELED'::text);

CREATE UNIQUE INDEX "CommercePayment_reader_active" ON atlas_customer."CommercePayment" USING btree ("readerId") WHERE (("readerId" IS NOT NULL) AND (state = ANY (ARRAY['DISPATCHED'::text, 'UNKNOWN'::text, 'AWAITING_PAYMENT'::text, 'PROCESSING'::text])));

CREATE UNIQUE INDEX "CommerceShippingPayment_order_active" ON atlas_customer."CommerceShippingPayment" USING btree ("orderId") WHERE (state <> 'CANCELED'::text);

CREATE INDEX "CustomerChallenge_phone_created" ON atlas_customer."CustomerChallenge" USING btree (phone, "createdAt");

CREATE INDEX "CustomerEmailVerification_account_created" ON atlas_customer."CustomerEmailVerification" USING btree ("accountId", "createdAt" DESC);

CREATE INDEX "CustomerIntakeCard_draft" ON atlas_customer."CustomerIntakeCard" USING btree ("draftId");

CREATE INDEX "CustomerIntakeDraft_account" ON atlas_customer."CustomerIntakeDraft" USING btree ("accountId", "createdAt");

CREATE INDEX "CustomerSession_account" ON atlas_customer."CustomerSession" USING btree ("accountId");

CREATE INDEX "ProgressNotification_pending" ON atlas_customer."ProgressNotification" USING btree ("createdAt", id) WHERE (state = 'PENDING'::text);

CREATE INDEX "WeeklyCapacityReservation_active" ON atlas_customer."WeeklyCapacityReservation" USING btree (channel, "weekStartsAt") WHERE (state <> 'RELEASED'::text);

CREATE UNIQUE INDEX commission_once ON atlas_dealer.commission_event USING btree (card_id) WHERE (kind = 'ACCRUED'::text);

CREATE INDEX order_card_location ON atlas_dealer.order_card USING btree (location_id);

CREATE INDEX order_card_order ON atlas_dealer.order_card USING btree (order_id);

CREATE INDEX background_pending ON atlas_defect_analysis.provider_event USING btree (provider_binding_hash, recorded_at, analysis_id) WHERE (kind = 'ACCEPTED'::text);

CREATE UNIQUE INDEX background_response_unique ON atlas_defect_analysis.provider_event USING btree (provider_binding_hash, response_id) WHERE (kind = 'ACCEPTED'::text);

CREATE UNIQUE INDEX analysis_replacement_parent_unique ON atlas_defect_analysis.run USING btree (replaces_analysis_id) WHERE (replaces_analysis_id IS NOT NULL);

CREATE INDEX defect_memory_confirmation ON atlas_manual.action USING btree (card_id, result_revision DESC) WHERE (((request)::jsonb #>> '{action,type}'::text[]) = 'CONFIRM_FINDINGS'::text);

CREATE INDEX learning_confirmations_card_revision ON atlas_manual.action USING btree (card_id, result_revision DESC) WHERE (((request)::jsonb #>> '{action,type}'::text[]) = 'CONFIRM_FINDINGS'::text);

CREATE INDEX defect_memory_design_revision ON atlas_manual.defect_memory_publication USING btree (design_key, revision DESC);

CREATE INDEX learning_publication_design_key_revision_idx ON atlas_manual.learning_publication USING btree (design_key, revision DESC);

CREATE INDEX learning_publication_due ON atlas_manual.learning_publication_job USING btree (available_at, card_id, action_id) WHERE (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text]));

CREATE INDEX learning_publication_family ON atlas_manual.learning_publication_job USING btree (design_family, card_id);

CREATE INDEX batch_grading_due ON atlas_manual_connected.batch_grading USING btree (available_at, created_at, key) WHERE (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'NEEDS_ATTENTION'::text]));

CREATE INDEX batch_grading_pending ON atlas_manual_connected.batch_grading USING btree (actor_id, created_at, key) WHERE (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text]));

CREATE INDEX card_image_binding_job ON atlas_manual_connected.card_image_binding USING btree (job_key);

CREATE INDEX early_geometry_pending ON atlas_manual_connected.early_geometry USING btree (engine_hash, created_at, key) WHERE (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text]));

CREATE UNIQUE INDEX identification_retry_action_unique ON atlas_manual_connected.identification USING btree (card_id, retry_action_id) WHERE (retry_action_id IS NOT NULL);

CREATE UNIQUE INDEX identification_retry_parent_unique ON atlas_manual_connected.identification USING btree (retry_of) WHERE (retry_of IS NOT NULL);

CREATE UNIQUE INDEX identification_root_source_unique ON atlas_manual_connected.identification USING btree (card_id, source_hash) WHERE (retry_of IS NULL);

CREATE INDEX market_job_latest ON atlas_manual_connected.market_job USING btree (card_id, approval_action_id, created_at DESC);

CREATE UNIQUE INDEX market_job_one_approval ON atlas_manual_connected.market_job USING btree (card_id, approval_action_id) WHERE (origin = ANY (ARRAY['APPROVAL'::text, 'BACKFILL'::text]));

CREATE INDEX market_job_pending ON atlas_manual_connected.market_job USING btree (available_at, created_at, request_id) WHERE (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'REQUESTED'::text, 'UNKNOWN'::text]));

CREATE INDEX published_display_pending ON atlas_manual_connected.published_review_display USING btree (available_at, card_id) WHERE (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text]));

CREATE INDEX published_display_source ON atlas_manual_connected.published_review_display USING btree (source_image_hash, policy) WHERE (state = 'READY'::text);

CREATE INDEX report_image_binding_job ON atlas_manual_connected.report_image_binding USING btree (job_key);

CREATE INDEX report_image_pending ON atlas_manual_connected.report_image_job USING btree (available_at, key) WHERE (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'REQUESTED'::text]));

CREATE UNIQUE INDEX report_image_upload_recipe ON atlas_manual_connected.report_image_job USING btree (source_hash, recipe_hash, ((((source_media)::jsonb -> 'original'::text) ->> 'uploadId'::text)));

CREATE INDEX review_display_pending ON atlas_manual_connected.review_display USING btree (available_at, upload_id) WHERE (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text]));

CREATE INDEX review_display_source ON atlas_manual_connected.review_display USING btree (source_image_hash, policy) WHERE (state = 'READY'::text);

CREATE INDEX variant_catalog_cache_latest ON atlas_manual_connected.variant_catalog_cache USING btree (key, created_at DESC);

CREATE INDEX variant_confirmation_current ON atlas_manual_connected.variant_confirmation USING btree (card_id, source_hash, identity_revision, identity_hash, created_at DESC);

CREATE INDEX variant_job_pending ON atlas_manual_connected.variant_job USING btree (available_at, created_at, key) WHERE (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'REQUESTED'::text, 'UNKNOWN'::text]));

CREATE INDEX intake_owner_created ON atlas_manual_intake.card USING btree (owner_id, created_at DESC, id DESC);

CREATE INDEX intake_ingestion_due ON atlas_manual_intake.ingestion USING btree (stage, available_at, upload_id) WHERE (state = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text]));

CREATE INDEX intake_ingestion_owner_fairness ON atlas_manual_intake.ingestion USING btree (owner_id, last_claimed_at DESC NULLS LAST);

CREATE UNIQUE INDEX "StaffAudit_finishing_record_key" ON atlas_staff."StaffAudit" USING btree ((((details)::jsonb ->> 'recordId'::text))) WHERE ((event)::text = ANY ((ARRAY['ATLAS_LABEL_ISSUED'::character varying, 'ATLAS_NFC_JOB_ISSUED'::character varying, 'ATLAS_NFC_VERIFIED'::character varying, 'ATLAS_ASSEMBLY_CONFIRMED'::character varying, 'ATLAS_SONIC_WELD_CONFIRMED'::character varying])::text[]));

CREATE UNIQUE INDEX "StaffAudit_learning_decision_key" ON atlas_staff."StaffAudit" USING btree ((((details)::jsonb ->> 'decisionId'::text))) WHERE ((event)::text = 'ATLAS_TRUSTED_LEARNING_DECIDED'::text);

CREATE INDEX "StaffAudit_subjectId_createdAt_idx" ON atlas_staff."StaffAudit" USING btree ("subjectId", "createdAt");

CREATE INDEX "StaffBrowser_expiresAt_idx" ON atlas_staff."StaffBrowser" USING btree ("expiresAt");

CREATE UNIQUE INDEX "StaffChallenge_browserHash_requestId_key" ON atlas_staff."StaffChallenge" USING btree ("browserHash", "requestId");

CREATE INDEX "StaffChallenge_phoneHash_createdAt_idx" ON atlas_staff."StaffChallenge" USING btree ("phoneHash", "createdAt");

CREATE UNIQUE INDEX "StaffChallenge_sendClaimId_key" ON atlas_staff."StaffChallenge" USING btree ("sendClaimId");

CREATE UNIQUE INDEX "StaffIdentity_phoneHash_key" ON atlas_staff."StaffIdentity" USING btree ("phoneHash");

CREATE INDEX "StaffOperationsGrant_identity_idx" ON atlas_staff."StaffOperationsGrant" USING btree ("identityId");

CREATE INDEX "StaffRateBucket_expiresAt_idx" ON atlas_staff."StaffRateBucket" USING btree ("expiresAt");

CREATE UNIQUE INDEX "StaffSession_challengeId_key" ON atlas_staff."StaffSession" USING btree ("challengeId");

CREATE INDEX "StaffSession_identityId_expiresAt_idx" ON atlas_staff."StaffSession" USING btree ("identityId", "expiresAt");

CREATE TRIGGER "CommerceEffect_guard" BEFORE DELETE OR UPDATE ON atlas_customer."CommerceEffect" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_effect_guard();

CREATE TRIGGER "CommerceEffect_label_ready_email" AFTER UPDATE ON atlas_customer."CommerceEffect" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_label_ready_email();

CREATE TRIGGER "CommerceOrder_immutable" BEFORE DELETE OR UPDATE ON atlas_customer."CommerceOrder" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER dealer_order_paid AFTER INSERT ON atlas_customer."CommerceOrder" FOR EACH ROW EXECUTE FUNCTION atlas_dealer.order_paid();

CREATE TRIGGER "CommercePayment_guard" BEFORE DELETE OR UPDATE ON atlas_customer."CommercePayment" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_payment_guard();

CREATE TRIGGER "CommercePayment_weekly_capacity" AFTER INSERT OR UPDATE OF state ON atlas_customer."CommercePayment" FOR EACH ROW EXECUTE FUNCTION atlas_customer.weekly_capacity_payment();

CREATE TRIGGER verified_email BEFORE INSERT ON atlas_customer."CommercePayment" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_verified_email_guard();

CREATE TRIGGER "CommerceProviderEvent_immutable" BEFORE DELETE OR UPDATE ON atlas_customer."CommerceProviderEvent" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "CommerceQuote_immutable" BEFORE DELETE OR UPDATE ON atlas_customer."CommerceQuote" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER verified_email BEFORE INSERT ON atlas_customer."CommerceQuote" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_verified_email_guard();

CREATE TRIGGER "CommerceShippingPayment_guard" BEFORE DELETE OR UPDATE ON atlas_customer."CommerceShippingPayment" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_shipping_payment_guard();

CREATE TRIGGER "CommerceShippingPayment_no_truncate" BEFORE TRUNCATE ON atlas_customer."CommerceShippingPayment" FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "CommerceShippingProviderEvent_immutable" BEFORE DELETE OR UPDATE ON atlas_customer."CommerceShippingProviderEvent" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "CommerceShippingProviderEvent_no_truncate" BEFORE TRUNCATE ON atlas_customer."CommerceShippingProviderEvent" FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "CommerceShippingQuote_immutable" BEFORE DELETE OR UPDATE ON atlas_customer."CommerceShippingQuote" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "CommerceShippingQuote_no_truncate" BEFORE TRUNCATE ON atlas_customer."CommerceShippingQuote" FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "CommerceShippingReceipt_immutable" BEFORE DELETE OR UPDATE ON atlas_customer."CommerceShippingReceipt" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "CommerceShippingReceipt_no_truncate" BEFORE TRUNCATE ON atlas_customer."CommerceShippingReceipt" FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "CustomerChallenge_sms_pilot" AFTER INSERT ON atlas_customer."CustomerChallenge" FOR EACH ROW EXECUTE FUNCTION atlas_staff.sms_pilot_claim_guard();

CREATE TRIGGER "CustomerControl_no_delete" BEFORE DELETE ON atlas_customer."CustomerControl" FOR EACH ROW EXECUTE FUNCTION atlas_customer.immutable_record();

CREATE TRIGGER "CustomerControl_no_truncate" BEFORE TRUNCATE ON atlas_customer."CustomerControl" FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.immutable_record();

CREATE TRIGGER "CustomerControl_revision" BEFORE UPDATE ON atlas_customer."CustomerControl" FOR EACH ROW EXECUTE FUNCTION atlas_customer.control_revision_guard();

CREATE TRIGGER "ProgressNotification_guard" BEFORE DELETE OR UPDATE ON atlas_customer."ProgressNotification" FOR EACH ROW EXECUTE FUNCTION atlas_customer.progress_notification_guard();

CREATE TRIGGER "ProgressPreferenceEvent_immutable" BEFORE DELETE OR UPDATE ON atlas_customer."ProgressPreferenceEvent" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "WeeklyCapacityReservation_guard" BEFORE DELETE OR UPDATE ON atlas_customer."WeeklyCapacityReservation" FOR EACH ROW EXECUTE FUNCTION atlas_customer.weekly_capacity_reservation_guard();

CREATE TRIGGER "WeeklyCapacitySharedPolicy_immutable" BEFORE DELETE OR UPDATE ON atlas_customer."WeeklyCapacitySharedPolicy" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "WeeklyCapacitySharedPolicy_no_truncate" BEFORE TRUNCATE ON atlas_customer."WeeklyCapacitySharedPolicy" FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "WeeklyCapacitySharedPolicy_valid" BEFORE INSERT ON atlas_customer."WeeklyCapacitySharedPolicy" FOR EACH ROW EXECUTE FUNCTION atlas_customer.weekly_capacity_shared_policy_guard();

CREATE TRIGGER "WeeklyCapacitySharedWeek_immutable" BEFORE DELETE OR UPDATE ON atlas_customer."WeeklyCapacitySharedWeek" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "WeeklyCapacitySharedWeek_no_truncate" BEFORE TRUNCATE ON atlas_customer."WeeklyCapacitySharedWeek" FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER "WeeklyCapacitySharedWeek_valid" BEFORE INSERT ON atlas_customer."WeeklyCapacitySharedWeek" FOR EACH ROW EXECUTE FUNCTION atlas_customer.weekly_capacity_shared_week_guard();

CREATE TRIGGER "WeeklyCapacityWeek_immutable" BEFORE DELETE OR UPDATE ON atlas_customer."WeeklyCapacityWeek" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_dealer.commission_event FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.commission_event FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_dealer.custody_event FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.custody_event FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER progress_notification AFTER INSERT ON atlas_dealer.custody_event FOR EACH ROW EXECUTE FUNCTION atlas_customer.progress_custody_event();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_dealer.handoff FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.handoff FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_dealer.handoff_receipt FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.handoff_receipt FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER progress_notification AFTER INSERT ON atlas_dealer.handoff_receipt FOR EACH ROW EXECUTE FUNCTION atlas_customer.progress_handoff_event();

CREATE TRIGGER location_guard BEFORE INSERT OR DELETE OR UPDATE ON atlas_dealer.location FOR EACH ROW EXECUTE FUNCTION atlas_dealer.location_guard();

CREATE TRIGGER save_revision AFTER INSERT OR UPDATE ON atlas_dealer.location FOR EACH ROW EXECUTE FUNCTION atlas_dealer.save_location_revision();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_dealer.location_revision FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.location_revision FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_dealer.manual_card_link FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.manual_card_link FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER manual_link_discard_guard BEFORE INSERT ON atlas_dealer.manual_card_link FOR EACH ROW EXECUTE FUNCTION atlas_dealer.manual_link_discard_guard();

CREATE TRIGGER progress_notification AFTER INSERT ON atlas_dealer.manual_card_link FOR EACH ROW EXECUTE FUNCTION atlas_customer.progress_grading_event();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_dealer.order_card FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.order_card FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();

CREATE TRIGGER order_inbox_acknowledgment_immutable BEFORE DELETE OR UPDATE ON atlas_dealer.order_inbox_acknowledgment FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER order_inbox_acknowledgment_no_truncate BEFORE TRUNCATE ON atlas_dealer.order_inbox_acknowledgment FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_defect_analysis.provider_event FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER background_receipt_guard BEFORE INSERT ON atlas_defect_analysis.receipt FOR EACH ROW EXECUTE FUNCTION atlas_defect_analysis.background_receipt_guard();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_defect_analysis.receipt FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_defect_analysis.request_refusal FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER refusal_guard BEFORE INSERT ON atlas_defect_analysis.request_refusal FOR EACH ROW EXECUTE FUNCTION atlas_defect_analysis.refusal_guard();

CREATE TRIGGER run_guard BEFORE INSERT OR DELETE OR UPDATE ON atlas_defect_analysis.run FOR EACH ROW EXECUTE FUNCTION atlas_defect_analysis.run_guard();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual.action FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER schedule_learning_publication AFTER INSERT ON atlas_manual.action FOR EACH ROW EXECUTE FUNCTION atlas_manual.schedule_learning_publication();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual.approval FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER card_revision BEFORE UPDATE ON atlas_manual.card FOR EACH ROW EXECUTE FUNCTION atlas_manual.card_revision();

CREATE TRIGGER defect_memory_guard BEFORE INSERT ON atlas_manual.defect_memory_publication FOR EACH ROW EXECUTE FUNCTION atlas_manual.defect_memory_guard();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual.defect_memory_publication FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER learning_activation_immutable BEFORE DELETE OR UPDATE ON atlas_manual.learning_activation_history FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_append_only();

CREATE TRIGGER learning_activation_guard BEFORE INSERT OR DELETE OR UPDATE ON atlas_manual.learning_control FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_activation_guard();

CREATE TRIGGER learning_publication_guard BEFORE INSERT ON atlas_manual.learning_publication FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_publication_guard();

CREATE TRIGGER learning_publication_immutable BEFORE DELETE OR UPDATE ON atlas_manual.learning_publication FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER learning_job_guard BEFORE DELETE OR UPDATE ON atlas_manual.learning_publication_job FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_job_guard();

CREATE TRIGGER learning_release_immutable BEFORE DELETE OR UPDATE ON atlas_manual.learning_release FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_append_only();

CREATE TRIGGER learning_member_guard BEFORE INSERT ON atlas_manual.learning_release_member FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_member_guard();

CREATE TRIGGER learning_member_immutable BEFORE DELETE OR UPDATE ON atlas_manual.learning_release_member FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_append_only();

CREATE TRIGGER learning_withdrawal_immutable BEFORE DELETE OR UPDATE ON atlas_manual.learning_withdrawal FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_append_only();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual.presentation FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.presentation FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable BEFORE DELETE ON atlas_manual.presentation_market FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.presentation_market FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER market_guard BEFORE INSERT OR UPDATE ON atlas_manual.presentation_market FOR EACH ROW EXECUTE FUNCTION atlas_manual.presentation_market_guard();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual.presentation_upload FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.presentation_upload FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual.public_report_identity FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.public_report_identity FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable_delete BEFORE DELETE ON atlas_manual.publication FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.publication FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER progress_notification AFTER UPDATE OF state ON atlas_manual.publication FOR EACH ROW EXECUTE FUNCTION atlas_customer.progress_publication_event();

CREATE TRIGGER publication_guard BEFORE INSERT OR UPDATE ON atlas_manual.publication FOR EACH ROW EXECUTE FUNCTION atlas_manual.publication_guard();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual.research_effect FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.research_effect FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER research_effect_guard BEFORE INSERT ON atlas_manual.research_effect FOR EACH ROW EXECUTE FUNCTION atlas_manual.research_effect_guard();

CREATE TRIGGER batch_analysis_successor BEFORE UPDATE OF analysis_action_id, analysis_attempt ON atlas_manual_connected.batch_grading FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.guard_batch_analysis_successor();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.batch_review FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.card_image_binding FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual_connected.card_image_binding FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.card_image_intent FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual_connected.card_image_intent FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER revision_guard BEFORE UPDATE ON atlas_manual_connected.details FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.revision_guard();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.details_action FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.effect FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER identification_guard BEFORE UPDATE ON atlas_manual_connected.identification FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.identification_guard();

CREATE TRIGGER identification_retry_guard BEFORE INSERT ON atlas_manual_connected.identification FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.identification_retry_guard();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual_connected.market_job FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER market_job_guard BEFORE INSERT OR DELETE OR UPDATE ON atlas_manual_connected.market_job FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.market_job_guard();

CREATE TRIGGER published_display_guard BEFORE DELETE OR UPDATE ON atlas_manual_connected.published_review_display FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.published_display_guard();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.report_image_binding FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual_connected.report_image_binding FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual_connected.report_image_job FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER report_image_guard BEFORE DELETE OR UPDATE ON atlas_manual_connected.report_image_job FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.report_image_guard();

CREATE TRIGGER review_display_guard BEFORE DELETE OR UPDATE ON atlas_manual_connected.review_display FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.review_display_guard();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.station_arm FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.station_challenge FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.station_enrollment FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.station_pairing FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.station_receipt FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER variant_catalog_immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.variant_catalog_cache FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER variant_catalog_truncate BEFORE TRUNCATE ON atlas_manual_connected.variant_catalog_cache FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE CONSTRAINT TRIGGER variant_confirmation_guard AFTER INSERT ON atlas_manual_connected.variant_confirmation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.variant_confirmation_guard();

CREATE TRIGGER variant_confirmation_immutable BEFORE DELETE OR UPDATE ON atlas_manual_connected.variant_confirmation FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER variant_confirmation_truncate BEFORE TRUNCATE ON atlas_manual_connected.variant_confirmation FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER variant_job_guard BEFORE INSERT OR DELETE OR UPDATE ON atlas_manual_connected.variant_job FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.variant_job_guard();

CREATE TRIGGER variant_job_truncate BEFORE TRUNCATE ON atlas_manual_connected.variant_job FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

CREATE TRIGGER intake_card_guard BEFORE DELETE OR UPDATE ON atlas_manual_intake.card FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.card_guard();

CREATE TRIGGER intake_create_discard_guard BEFORE INSERT ON atlas_manual_intake.card FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.create_discard_guard();

CREATE TRIGGER discard_request_immutable BEFORE DELETE OR UPDATE ON atlas_manual_intake.discard_request FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.discard_immutable();

CREATE TRIGGER discard_request_no_truncate BEFORE TRUNCATE ON atlas_manual_intake.discard_request FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual_intake.discard_immutable();

CREATE TRIGGER discarded_card_immutable BEFORE DELETE OR UPDATE ON atlas_manual_intake.discarded_card FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.discard_immutable();

CREATE TRIGGER discarded_card_insert BEFORE INSERT ON atlas_manual_intake.discarded_card FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.discard_insert_guard();

CREATE TRIGGER discarded_card_no_truncate BEFORE TRUNCATE ON atlas_manual_intake.discarded_card FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual_intake.discard_immutable();

CREATE TRIGGER intake_ingestion_guard BEFORE DELETE OR UPDATE ON atlas_manual_intake.ingestion FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.ingestion_guard();

CREATE TRIGGER intake_schedule_ingestion AFTER INSERT OR UPDATE OF verification, source ON atlas_manual_intake.upload FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.schedule_ingestion();

CREATE TRIGGER intake_upload_guard BEFORE DELETE OR UPDATE ON atlas_manual_intake.upload FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.upload_guard();

CREATE TRIGGER "PublicReaderControl_no_delete" BEFORE DELETE ON atlas_staff."PublicReaderControl" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE TRIGGER "PublicReaderControl_no_truncate" BEFORE TRUNCATE ON atlas_staff."PublicReaderControl" FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE TRIGGER "PublicReaderControl_revision" BEFORE UPDATE ON atlas_staff."PublicReaderControl" FOR EACH ROW EXECUTE FUNCTION atlas_staff.public_reader_control_guard();

CREATE TRIGGER "SmsPilotControl_no_replace" BEFORE INSERT OR DELETE ON atlas_staff."SmsPilotControl" FOR EACH ROW EXECUTE FUNCTION atlas_staff.sms_pilot_immutable();

CREATE TRIGGER "SmsPilotControl_no_truncate" BEFORE TRUNCATE ON atlas_staff."SmsPilotControl" FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.sms_pilot_immutable();

CREATE TRIGGER "SmsPilotControl_revision" BEFORE UPDATE ON atlas_staff."SmsPilotControl" FOR EACH ROW EXECUTE FUNCTION atlas_staff.sms_pilot_control_guard();

CREATE TRIGGER "SmsPilotReservation_immutable" BEFORE DELETE OR UPDATE ON atlas_staff."SmsPilotReservation" FOR EACH ROW EXECUTE FUNCTION atlas_staff.sms_pilot_immutable();

CREATE TRIGGER "SmsPilotReservation_no_truncate" BEFORE TRUNCATE ON atlas_staff."SmsPilotReservation" FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.sms_pilot_immutable();

CREATE TRIGGER "StaffAudit_immutable" BEFORE DELETE OR UPDATE ON atlas_staff."StaffAudit" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE TRIGGER "StaffAudit_no_truncate" BEFORE TRUNCATE ON atlas_staff."StaffAudit" FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE TRIGGER "StaffAudit_operations_authority" BEFORE INSERT ON atlas_staff."StaffAudit" FOR EACH ROW EXECUTE FUNCTION atlas_staff.operations_audit_guard();

CREATE TRIGGER "StaffBrowser_no_truncate" BEFORE TRUNCATE ON atlas_staff."StaffBrowser" FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE CONSTRAINT TRIGGER "StaffChallenge_atomic_consumption" AFTER UPDATE ON atlas_staff."StaffChallenge" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_consumption_guard();

CREATE TRIGGER "StaffChallenge_no_delete" BEFORE DELETE ON atlas_staff."StaffChallenge" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE TRIGGER "StaffChallenge_no_truncate" BEFORE TRUNCATE ON atlas_staff."StaffChallenge" FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE TRIGGER "StaffChallenge_sms_pilot" AFTER INSERT ON atlas_staff."StaffChallenge" FOR EACH ROW EXECUTE FUNCTION atlas_staff.sms_pilot_claim_guard();

CREATE TRIGGER "StaffChallenge_transition" BEFORE INSERT OR UPDATE ON atlas_staff."StaffChallenge" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_challenge_guard();

CREATE TRIGGER "StaffControl_no_truncate" BEFORE TRUNCATE ON atlas_staff."StaffControl" FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE TRIGGER "StaffControl_revision" BEFORE UPDATE ON atlas_staff."StaffControl" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();

CREATE TRIGGER "StaffIdentity_access" BEFORE UPDATE ON atlas_staff."StaffIdentity" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_identity_guard();

CREATE TRIGGER "StaffIdentity_no_truncate" BEFORE TRUNCATE ON atlas_staff."StaffIdentity" FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE CONSTRAINT TRIGGER "StaffIdentity_operations_audit" AFTER UPDATE ON atlas_staff."StaffIdentity" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.operations_change_guard();

CREATE TRIGGER "StaffOperationsGrant_guard" BEFORE UPDATE ON atlas_staff."StaffOperationsGrant" FOR EACH ROW EXECUTE FUNCTION atlas_staff.operations_grant_guard();

CREATE TRIGGER "StaffOperationsGrant_no_delete" BEFORE DELETE ON atlas_staff."StaffOperationsGrant" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE TRIGGER "StaffOperationsGrant_no_truncate" BEFORE TRUNCATE ON atlas_staff."StaffOperationsGrant" FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE CONSTRAINT TRIGGER "StaffSession_atomic_consumption" AFTER INSERT ON atlas_staff."StaffSession" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_consumption_guard();

CREATE TRIGGER "StaffSession_binding" BEFORE UPDATE ON atlas_staff."StaffSession" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_session_guard();

CREATE TRIGGER "StaffSession_no_delete" BEFORE DELETE ON atlas_staff."StaffSession" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE TRIGGER "StaffSession_no_truncate" BEFORE TRUNCATE ON atlas_staff."StaffSession" FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();

SET check_function_bodies = true;

CREATE OR REPLACE FUNCTION atlas_customer.account_projection(a atlas_customer."CustomerAccount")
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN a.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('id',a.id,'phone',a.phone,'profile',a.profile,'createdAt',a."createdAt") END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.canonical_email(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN length(btrim(value)) BETWEEN 3 AND 254
  AND btrim(value) !~ '[[:cntrl:][:space:]]'
  AND btrim(value) !~ U&'[\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]' AND btrim(value) ~ '^[^@]+@[^@]+\.[^@]+$'
  THEN split_part(btrim(value),'@',1)||'@'||lower(split_part(btrim(value),'@',2)) ELSE NULL END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_canonical(v jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT CASE jsonb_typeof(v)
 WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||atlas_customer.commerce_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(v)),'')||'}'
 WHEN 'array' THEN '['||COALESCE((SELECT string_agg(atlas_customer.commerce_canonical(value),',' ORDER BY ord) FROM jsonb_array_elements(v) WITH ORDINALITY e(value,ord)),'')||']'
 ELSE v::text END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_hash(v jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT encode(sha256(convert_to(atlas_customer.commerce_canonical(v),'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_payment_projection(pid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT to_jsonb(p)||jsonb_build_object('quote',q.snapshot,'order',(SELECT atlas_customer.commerce_call('commerce_order',o."accountId",jsonb_build_object('orderId',o.id)) FROM atlas_customer."CommerceOrder" o WHERE o."paymentId"=p.id))
 FROM atlas_customer."CommercePayment" p JOIN atlas_customer."CommerceQuote" q ON q.id=p."quoteId" WHERE p.id=pid
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_cards(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_agg(atlas_customer.commerce_public_fields(value,ARRAY['id','cardId','revision','unitCents'])||jsonb_build_object(
 'identity',atlas_customer.commerce_public_fields(value->'identity',ARRAY['category','title','playerName','year','manufacturer','setName','cardNumber','parallel','insert'])) ORDER BY ord),'[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_checkout(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('version','atlas-commerce-checkout-v1','draftId',v->'draftId','revision',v->'revision','channel',v->'channel',
 'cards',atlas_customer.commerce_public_cards(CASE WHEN v->'activePayment'->>'state'='PAID' THEN v->'activePayment'->'order'->'receipt'->'cards' ELSE v->'cards' END),
 'location',atlas_customer.commerce_public_location(CASE WHEN v->'activePayment'->>'state'='PAID' THEN v->'activePayment'->'order'->'receipt'->'location' ELSE v->'location' END),
 'terms',atlas_customer.commerce_public_fields(v->'terms',ARRAY['shippingPayment']),
 'activePayment',atlas_customer.commerce_public_payment(v->'activePayment'),
 'unitCents',CASE WHEN v->>'channel'='KIOSK' THEN 5000 ELSE 4000 END,'turnaroundDays',CASE WHEN v->>'channel'='KIOSK' THEN 7 ELSE 14 END,
 'shippingOptions',atlas_customer.commerce_public_rows(v->'shippingPlans',ARRAY['packingPresetId','shippingServiceCode','label','packaging','carrierLabel','serviceLabel','inboundPackaging']),'blockers','[]'::jsonb)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_fields(v jsonb, keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(v)='object' THEN v ELSE '{}'::jsonb END)
 WHERE key=ANY(keys) AND jsonb_typeof(value) IN ('string','number','boolean','null')
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_location(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.commerce_public_fields(v,ARRAY['id','name','revision'])||jsonb_build_object(
 'address',atlas_customer.commerce_public_fields(v->'address',ARRAY['line1','city','region','postalCode','country']),
 'schedule',atlas_customer.commerce_public_fields(v->'schedule',ARRAY['timeZone','nextCollectionAt','projectedReturnAt','cutoffAt'])||jsonb_build_object(
 'pickups',atlas_customer.commerce_public_rows(v->'schedule'->'pickups',ARRAY['weekday','time','cutoff']),
 'returns',atlas_customer.commerce_public_rows(v->'schedule'->'returns',ARRAY['weekday','time']),
 'exceptions',atlas_customer.commerce_public_rows(v->'schedule'->'exceptions',ARRAY['date','kind','cancelled','time','cutoff','reason']))) END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_order(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.commerce_public_fields(v,ARRAY['id','reference','paidAt'])||jsonb_build_object('receipt',atlas_customer.commerce_public_quote(v->'receipt'),
 'shippingPayment',CASE WHEN jsonb_typeof(v->'shippingPayment')='object' THEN atlas_customer.commerce_public_fields(v->'shippingPayment',ARRAY['state','labelReadyEmailEnabled'])||jsonb_build_object('activePayment',atlas_customer.commerce_public_fields(v->'shippingPayment'->'activePayment',ARRAY['attemptId','state','channel','paymentFlow']),'receipt',CASE WHEN jsonb_typeof(v->'shippingPayment'->'receipt')='object' THEN atlas_customer.commerce_public_quote(v->'shippingPayment'->'receipt') ELSE NULL END) ELSE NULL END,
 'effects',COALESCE((SELECT jsonb_agg(atlas_customer.commerce_public_fields(value,ARRAY['id','kind','state','trackingNumber','deliveryStatus','artifactState','carrierName','serviceName']) ORDER BY ord)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v->'effects')='array' THEN v->'effects' ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
 WHERE value->>'kind' IN ('EMAIL_RECEIPT','EMAIL_SHIPPING_RECEIPT','EMAIL_LABEL_READY','SMS_RECEIPT','FEDEX_LABEL','SHIPSTATION_LABEL','PACKAGE_LABEL')),'[]'::jsonb)) END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_payment(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.commerce_public_fields(v,ARRAY['state','channel','paymentFlow'])||jsonb_build_object('attemptId',COALESCE(v->'id',v->'attemptId'))
 ||CASE WHEN v->>'state'='PAID' THEN jsonb_build_object('order',atlas_customer.commerce_public_order(v->'order')) ELSE '{}'::jsonb END END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_quote(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT atlas_customer.commerce_public_fields(v,ARRAY['id','orderId','purpose','shippingStatus','draftId','draftRevision','channel','currency','subtotalCents','shippingCents','taxCents','totalCents','createdAt','expiresAt'])||jsonb_build_object(
 'inboundPackage',CASE WHEN v ? 'inboundPackage' THEN jsonb_build_object('weight',atlas_customer.commerce_public_fields(v->'inboundPackage'->'weight',ARRAY['unit','value']),'dimensions',atlas_customer.commerce_public_fields(v->'inboundPackage'->'dimensions',ARRAY['unit','length','width','height'])) ELSE NULL END,'cards',atlas_customer.commerce_public_cards(v->'cards'),'location',atlas_customer.commerce_public_location(v->'location'),
 'terms',atlas_customer.commerce_public_fields(v->'terms',ARRAY['days','clockStart','mailChargedLegs','paymentFlow','shippingPayment']),
 'shipping',atlas_customer.commerce_public_rows(v->'shipping',ARRAY['leg','amountCents','currency','expiresAt','provider','carrierName','serviceName']))
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_rows(v jsonb, keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_agg(atlas_customer.commerce_public_fields(value,keys) ORDER BY ord),'[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_receipt_email_valid(value text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(length(value) BETWEEN 3 AND 254 AND value !~ '[[:cntrl:][:space:]]'
  AND value ~ '^[^@]+@[^@]+\.[^@]+$',false)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_return_ready(oid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM atlas_dealer.order_card WHERE order_id=oid)
 AND NOT EXISTS(SELECT 1 FROM atlas_dealer.order_card c WHERE c.order_id=oid AND (
  (SELECT kind FROM atlas_dealer.custody_event WHERE card_id=c.card_id AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED') ORDER BY sequence DESC LIMIT 1) IS DISTINCT FROM 'ATLAS_RECEIVED'
  OR NOT EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link l JOIN atlas_manual.approval a ON a.card_id=l.manual_card_id WHERE l.card_id=c.card_id)))
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_payment_projection(pid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT to_jsonb(p)||jsonb_build_object('quote',q.snapshot,'order',CASE WHEN p.state='PAID' THEN atlas_customer.commerce_call('commerce_order',p."accountId",jsonb_build_object('orderId',p."orderId")) ELSE NULL END)
 FROM atlas_customer."CommerceShippingPayment" p JOIN atlas_customer."CommerceShippingQuote" q ON q.id=p."quoteId" WHERE p.id=pid
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_public_state(oid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN o.receipt->'terms'->>'shippingPayment' IS DISTINCT FROM 'SEPARATE_PAYMENT' THEN NULL ELSE
 jsonb_build_object('state',CASE WHEN p.state='PAID' THEN 'PAID' WHEN p.state='DISPATCHED' THEN 'PROCESSING' ELSE COALESCE(p.state,'UNQUOTED_UNPAID') END,
 'labelReadyEmailEnabled',true,
 'activePayment',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('attemptId',p.id,'state',p.state,'channel','MAIL_IN','paymentFlow','CUSTOMER_PHONE') ELSE NULL END,
 'receipt',CASE WHEN r.id IS NOT NULL THEN atlas_customer.commerce_public_quote(r.receipt) ELSE NULL END) END
 FROM atlas_customer."CommerceOrder" o LEFT JOIN atlas_customer."CommerceShippingPayment" p ON p."orderId"=o.id AND p.state<>'CANCELED'
 LEFT JOIN atlas_customer."CommerceShippingReceipt" r ON r."orderId"=o.id WHERE o.id=oid
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_request(plan jsonb, leg text, quoted_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN plan->>'version'='atlas-measured-shipstation-plan-v1'
  THEN jsonb_set(plan->'legs'->leg,'{shipment,ship_date}',to_jsonb(to_char(quoted_at AT TIME ZONE (plan->'legs'->leg->>'shipDateTimeZone'),'YYYY-MM-DD')))
 WHEN plan->>'version'='atlas-measured-print-return-plan-v2'
  THEN jsonb_set(plan->'legs'->leg,'{requestedShipment,shipDatestamp}',to_jsonb(to_char(quoted_at AT TIME ZONE (plan->'legs'->leg->>'shipDateTimeZone'),'YYYY-MM-DD')))
 ELSE plan->'legs'->leg END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_source(oid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT q.snapshot||jsonb_build_object('revision',q."draftRevision",'cards',(SELECT jsonb_agg((line-'cardId')||jsonb_build_object('id',line->'cardId') ORDER BY ord) FROM jsonb_array_elements(q.snapshot->'cards') WITH ORDINALITY e(line,ord)),
 'shippingPlans',COALESCE((SELECT jsonb_agg(plan) FROM atlas_customer."CommerceControl" c CROSS JOIN LATERAL jsonb_array_elements(c."shippingPlans") plan WHERE c.id='active' AND atlas_customer.commerce_shipping_plan_valid(plan,jsonb_array_length(q.snapshot->'cards'),c.terms->>'mailChargedLegs')),'[]'::jsonb),
 'activePayment',(SELECT atlas_customer.commerce_shipping_payment_projection(id) FROM atlas_customer."CommerceShippingPayment" WHERE "orderId"=o.id AND state<>'CANCELED'),
 'order',atlas_customer.commerce_call('commerce_order',o."accountId",jsonb_build_object('orderId',o.id)))
 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommerceQuote" q ON q.id=o."quoteId" WHERE o.id=oid
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipstation_customer(profile jsonb, phone text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('name',profile->>'name','phone',phone,'address_line1',profile->>'address1','city_locality',profile->>'city',
 'state_province',profile->>'region','postal_code',profile->>'postalCode','country_code',profile->>'country','address_residential_indicator','unknown')
 ||CASE WHEN COALESCE(profile->>'address2','')<>'' THEN jsonb_build_object('address_line2',profile->>'address2') ELSE '{}'::jsonb END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_source(did uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT jsonb_build_object('draftId',d.id,'revision',d.revision,'accountId',d."accountId",'profile',d."profileSnapshot",'profileRevision',d.revision,'phone',a.phone,'emailVerified',atlas_customer.email_verified(a.id,d."profileSnapshot"->>'email'),
 'channel',CASE WHEN d."intakeMethod"='MAIL_IN' THEN 'MAIL_IN' ELSE 'KIOSK' END,'location',CASE WHEN d."kioskId" IS NOT NULL THEN atlas_customer.intake_location(d."kioskId") ELSE NULL END,
 'terms',(SELECT terms FROM atlas_customer."CommerceControl" WHERE id='active'),
 'activePayment',(SELECT atlas_customer.commerce_payment_projection(p.id) FROM atlas_customer."CommercePayment" p WHERE p."draftId"=d.id AND p.state<>'CANCELED'),
 'shippingPlans',COALESCE((SELECT jsonb_agg(plan) FROM atlas_customer."CommerceControl" ctl CROSS JOIN LATERAL jsonb_array_elements(ctl."shippingPlans") plan
 WHERE ctl.id='active' AND atlas_customer.commerce_shipping_plan_valid(plan,(SELECT count(*)::integer FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),ctl.terms->>'mailChargedLegs')),'[]'::jsonb),
 'cards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'identity',c.identity,'photoPairHash',atlas_customer.commerce_hash(
 (SELECT jsonb_agg(jsonb_build_object('side',u.side,'plan',u.plan,'verification',u.verification) ORDER BY u.side) FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=c.id))) ORDER BY c."createdAt",c.id)
 FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),'[]'::jsonb))
 FROM atlas_customer."CustomerIntakeDraft" d JOIN atlas_customer."CustomerAccount" a ON a.id=d."accountId" WHERE d.id=did
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.current_account(sh text, bh text, rev integer)
 RETURNS atlas_customer."CustomerAccount"
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT a.* FROM atlas_customer."CustomerSession" s
 JOIN atlas_customer."CustomerBrowser" b ON b."tokenHash"=s."browserHash"
 JOIN atlas_customer."CustomerAccount" a ON a.id=s."accountId"
 WHERE s."tokenHash"=sh AND s."browserHash"=bh AND s."revokedAt" IS NULL AND a."revokedAt" IS NULL
   AND s."accessVersion"=a."accessVersion" AND s."controlRevision"=rev AND b."controlRevision"=rev
   AND s."createdAt"<=clock_timestamp() AND s."expiresAt">clock_timestamp() AND b."expiresAt">clock_timestamp()
 FOR SHARE OF a,s,b
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.email_verified(aid uuid, email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM atlas_customer."CustomerVerifiedEmail" e
  WHERE e."accountId"=$1 AND e.email=atlas_customer.canonical_email($2))
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_draft_projection(did uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'intakeMethod',d."intakeMethod",'channel',CASE WHEN d."intakeMethod"='MAIL_IN' THEN 'MAIL_IN' ELSE 'KIOSK' END,
 'kioskId',d."kioskId",'locationSnapshot',atlas_customer.intake_public_location(d."locationSnapshot"),'state',d.state,'profileSnapshot',d."profileSnapshot",'createdAt',d."createdAt",'cards',COALESCE((
 SELECT jsonb_agg(jsonb_build_object('id',c.id,'pairId',c."pairId",'revision',c.revision,'identityState',c."identityState",'identity',c.identity,'identitySource',c."identitySource",
 'warnings',COALESCE(c."identityResult"->'warnings','[]'::jsonb),'uploads',(SELECT jsonb_object_agg(u.side,jsonb_build_object('id',u.id,'state',CASE WHEN u.verification IS NULL THEN 'PENDING' ELSE 'VERIFIED' END)) FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=c.id)) ORDER BY c."createdAt",c.id)
 FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),'[]'::jsonb)) FROM atlas_customer."CustomerIntakeDraft" d WHERE d.id=did
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_editable(did uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT NOT EXISTS (SELECT 1 FROM atlas_customer."CommercePayment" WHERE "draftId"=did AND state<>'CANCELED')
 AND NOT EXISTS (SELECT 1 FROM atlas_customer."CommerceOrder" WHERE "draftId"=did)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_identity_valid(v jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_typeof(v)='object' AND v ?& ARRAY['category','title','playerName','year','manufacturer','setName','cardNumber','parallel','insert']
 AND (v-ARRAY['category','title','playerName','year','manufacturer','setName','cardNumber','parallel','insert'])='{}'::jsonb
 AND v->>'category' IN ('SPORTS','POKEMON') AND length(v->>'title') BETWEEN 1 AND 180
 AND NOT EXISTS (SELECT 1 FROM jsonb_each(v) e WHERE jsonb_typeof(e.value)<>'string' OR length(v->>e.key)>180
 OR v->>e.key<>btrim(v->>e.key) OR (v->>e.key) ~ '[[:cntrl:]]'),false)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_location(kid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('id',id,'dealerId',dealer_id,'revision',revision,'name',name,'address',address,
 'terminalId',terminal_id,'terminalLocationId',terminal_location_id,'packagePrinterId',package_printer_id,
 'schedule',schedule||jsonb_build_object('nextCollectionAt',atlas_dealer.projection(schedule,clock_timestamp())->'nextCollection','projectedReturnAt',atlas_dealer.projection(schedule,clock_timestamp())->'projectedReturn','cutoffAt',atlas_dealer.next_cutoff(schedule,clock_timestamp())), 'timeZone',schedule->>'timeZone','position',jsonb_build_object('lat',latitude,'lng',longitude))
 FROM atlas_dealer.location WHERE id=kid AND enabled AND authorized_until>clock_timestamp() AND atlas_dealer.projection(schedule,clock_timestamp())->>'projectedReturn' IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_public_fields(v jsonb, keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(v)='object' THEN v ELSE '{}'::jsonb END)
 WHERE key=ANY(keys) AND jsonb_typeof(value) IN ('string','number','boolean','null')
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_public_location(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.intake_public_fields(v,ARRAY['id','name','revision'])||jsonb_build_object(
 'address',atlas_customer.intake_public_fields(v->'address',ARRAY['line1','city','region','postalCode','country']),
 'schedule',atlas_customer.intake_public_fields(v->'schedule',ARRAY['timeZone','nextCollectionAt','projectedReturnAt','cutoffAt'])||jsonb_build_object(
 'pickups',atlas_customer.intake_public_rows(v->'schedule'->'pickups',ARRAY['weekday','time','cutoff']),
 'returns',atlas_customer.intake_public_rows(v->'schedule'->'returns',ARRAY['weekday','time']),
 'exceptions',atlas_customer.intake_public_rows(v->'schedule'->'exceptions',ARRAY['date','kind','cancelled','time','cutoff','reason']))) END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_public_rows(v jsonb, keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_agg(atlas_customer.intake_public_fields(value,keys) ORDER BY ord),'[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.intake_upload_projection(uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT jsonb_build_object('accountId',d."accountId",'draftId',d.id,'cardId',c.id,'pairId',c."pairId",'side',u.side,'plan',u.plan,'verification',u.verification,'prepared',u.prepared)
 FROM atlas_customer."CustomerIntakeUpload" u JOIN atlas_customer."CustomerIntakeCard" c ON c.id=u."cardId" JOIN atlas_customer."CustomerIntakeDraft" d ON d.id=c."draftId" WHERE u.id=uid
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.problem(s integer, c text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('error',jsonb_build_object('status',s,'code',c))
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_preferences(aid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('revision',COALESCE(p.revision,0),'email',COALESCE(p.email,false),'sms',COALESCE(p.sms,false),
 'deliveryChannels',jsonb_build_array('EMAIL'),'deliveryEnabled',COALESCE((SELECT enabled FROM atlas_customer."ProgressNotificationControl" WHERE id='active'),false))
 FROM (SELECT aid id) a LEFT JOIN atlas_customer."ProgressPreference" p ON p."accountId"=a.id
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_source_current(e atlas_customer."ProgressNotification")
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE e.source->>'type'
 WHEN 'CUSTODY' THEN EXISTS(SELECT 1 FROM atlas_dealer.custody_event c WHERE c.id::text=e.source->>'id' AND c.card_id=e."cardId" AND c.kind=e."eventKind"
   AND NOT EXISTS(SELECT 1 FROM atlas_dealer.custody_event newer WHERE newer.card_id=c.card_id AND newer.sequence>c.sequence))
 WHEN 'HANDOFF' THEN EXISTS(SELECT 1 FROM atlas_dealer.handoff_receipt r WHERE r.id::text=e.source->>'id' AND e."cardId"=ANY(r.card_ids))
 WHEN 'GRADING' THEN EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link l WHERE l.card_id=e."cardId" AND l.manual_card_id::text=e.source->>'cardId'
  AND NOT EXISTS(SELECT 1 FROM atlas_manual.approval a WHERE a.card_id=l.manual_card_id)
  AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=l.manual_card_id))
 WHEN 'PUBLICATION' THEN EXISTS(SELECT 1 FROM atlas_manual.publication p JOIN atlas_dealer.manual_card_link l ON l.manual_card_id=p.card_id
  WHERE l.card_id=e."cardId" AND p.card_id::text=e.source->>'cardId' AND p.action_id::text=e.source->>'actionId' AND p.state='PUBLISHED' AND p.mode='PRODUCTION'
  AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)
  AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication newer WHERE newer.card_id=p.card_id AND newer.state='PUBLISHED' AND newer.version>p.version))
 ELSE false END
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.valid_contact_profile(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(jsonb_typeof(p)='object' AND p ? 'name'
  AND p-ARRAY['name','email']='{}'::jsonb
  AND jsonb_typeof(p->'name')='string' AND length(p->>'name') BETWEEN 1 AND 120
  AND (p->>'name')=btrim(p->>'name') AND (p->>'name') !~ '[[:cntrl:]]'
  AND (NOT p ? 'email' OR (jsonb_typeof(p->'email')='string'
   AND length(p->>'email')<=254 AND (p->>'email')=btrim(p->>'email')
   AND ((p->>'email')='' OR ((p->>'email') !~ '[[:cntrl:][:space:]]'
    AND (p->>'email') ~ '^[^@]+@[^@]+\.[^@]+$')))),false)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.valid_intake_profile(p jsonb, method text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE(atlas_customer.canonical_email(p->>'email') IS NOT NULL AND
  CASE method WHEN 'DEALER_DROP_OFF' THEN atlas_customer.valid_shop_profile(p)
  WHEN 'MAIL_IN' THEN atlas_customer.valid_profile(p) ELSE false END,false)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.valid_profile(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT atlas_customer.valid_profile_legacy(p-'email') AND (NOT p ? 'email' OR
  (jsonb_typeof(p->'email')='string' AND length(p->>'email') BETWEEN 3 AND 254
   AND (p->>'email')=btrim(p->>'email') AND (p->>'email') !~ '[[:cntrl:][:space:]]'
   AND (p->>'email') ~ '^[^@]+@[^@]+\.[^@]+$'))
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.valid_profile_legacy(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT COALESCE(jsonb_typeof(p)='object' AND
    p ?& ARRAY['name','address1','address2','city','region','postalCode','country'] AND
    (p-ARRAY['name','address1','address2','city','region','postalCode','country'])='{}'::jsonb AND
    NOT EXISTS (SELECT 1 FROM jsonb_each(p) e WHERE jsonb_typeof(e.value)<>'string'
      OR length(p->>e.key)>CASE e.key WHEN 'name' THEN 120 WHEN 'address1' THEN 200 WHEN 'address2' THEN 200 WHEN 'postalCode' THEN 30 WHEN 'country' THEN 2 ELSE 100 END OR (p->>e.key) ~ '[[:cntrl:]]'
      OR (p->>e.key)<>btrim(p->>e.key)
      OR (e.key NOT IN ('address2','region') AND length(p->>e.key)=0)) AND
    (p->>'country') ~ '^[A-Z]{2}$', false)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.valid_shop_profile(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'atlas_customer'
AS $function$
 SELECT atlas_customer.valid_contact_profile(p) OR atlas_customer.valid_profile(p)
$function$;

CREATE OR REPLACE FUNCTION atlas_customer.weekly_capacity_week(instant timestamp with time zone)
 RETURNS TABLE("weekStartsAt" timestamp with time zone, "resetsAt" timestamp with time zone)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT start_local AT TIME ZONE 'America/Los_Angeles', (start_local+interval '7 days') AT TIME ZONE 'America/Los_Angeles'
 FROM (SELECT date_trunc('week',(instant AT TIME ZONE 'America/Los_Angeles')-interval '1 minute')+interval '1 minute' start_local) s
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.card_tracking(cid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('cardId',c.card_id,'identity',c.paid_line->'identity','channel',c.channel,
 'originalSchedule',c.location_snapshot->'schedule','originalLocation',c.location_snapshot->>'name',
 'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'occurredAt',e.occurred_at,'recordedAt',e.recorded_at,
   'note',CASE WHEN e.kind IN ('DELAY_REPORTED','DELAY_RESOLVED') THEN e.evidence->>'note' END,
   'expectedReturnAt',CASE WHEN e.kind='DELAY_REPORTED' THEN e.evidence->>'expectedReturnAt' END) ORDER BY e.sequence)
   FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id),'[]'::jsonb),
 'grading',CASE WHEN a.approved_at IS NOT NULL THEN 'HUMAN_APPROVED' WHEN l.manual_card_id IS NOT NULL THEN 'IN_GRADING' ELSE 'NOT_STARTED' END,
 'approvedAt',a.approved_at,'reportUrl',(SELECT '/reports/'||i.public_token||'?v='||p.version FROM atlas_manual.public_report_identity i JOIN atlas_manual.publication p ON p.card_id=i.card_id WHERE i.card_id=l.manual_card_id AND p.action_id=a.action_id AND p.state='PUBLISHED' LIMIT 1),
 'collectedAt',col.occurred_at,
 'turnaroundTarget',CASE WHEN col.occurred_at IS NOT NULL THEN ((col.occurred_at AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone'))+interval '7 days') AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone') END,
 'currentSchedule',CASE WHEN c.channel='KIOSK' THEN loc.schedule END,
 'currentProjection',CASE WHEN c.channel='KIOSK' AND col.occurred_at IS NULL THEN atlas_dealer.projection(loc.schedule,clock_timestamp())
 WHEN c.channel='KIOSK' THEN jsonb_build_object('nextCollection',NULL,'projectedReturn',atlas_dealer.next_slot(loc.schedule,'returns',((col.occurred_at AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone'))+interval '7 days') AT TIME ZONE (c.location_snapshot->'schedule'->>'timeZone'),false)) END,
 'scheduleChanged',CASE WHEN c.channel='KIOSK' THEN loc.revision<>(c.location_snapshot->>'revision')::integer ELSE false END)
 FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.location loc ON loc.id=c.location_id
 LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id
 LEFT JOIN LATERAL(SELECT approved_at,action_id FROM atlas_manual.approval WHERE card_id=l.manual_card_id ORDER BY approved_at DESC LIMIT 1) a ON true
 LEFT JOIN LATERAL(SELECT occurred_at FROM atlas_dealer.custody_event WHERE card_id=c.card_id AND kind='COLLECTED' ORDER BY sequence LIMIT 1) col ON true
 WHERE c.card_id=cid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.card_tracking_with_handoff(cid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT atlas_dealer.card_tracking(cid) || CASE WHEN r.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('dealerReceivedAt',r.received_at,
 'events',(SELECT jsonb_agg(e ORDER BY (e->>'occurredAt')::timestamptz,e->>'id') FROM jsonb_array_elements(
   COALESCE(atlas_dealer.card_tracking(cid)->'events','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',r.id,'kind','DEALER_RECEIVED','occurredAt',r.received_at,'recordedAt',r.received_at))) e)) END
 FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.handoff h ON h.order_id=c.order_id
 LEFT JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id AND cid=ANY(r.card_ids) WHERE c.card_id=cid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.customer_tracking(account_id uuid, oid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('orderId',o.id,'reference',o.reference,'cards',COALESCE((SELECT jsonb_agg(atlas_dealer.card_tracking_with_handoff(c.card_id) ORDER BY c.card_id)
 FROM atlas_dealer.order_card c WHERE c.order_id=o.id),'[]'::jsonb),'handoff',(SELECT atlas_dealer.handoff_projection(h.id) FROM atlas_dealer.handoff h WHERE h.order_id=o.id))
 FROM atlas_customer."CommerceOrder" o WHERE o.id=oid AND o."accountId"=account_id
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.directory(at_time timestamp with time zone, entry text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('locations',COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'address',address,'revision',revision,
 'position',jsonb_build_object('lat',latitude,'lng',longitude),'timeZone',schedule->>'timeZone','schedule',schedule,
 'priceCents',5000,'shippingCents',0,'turnaroundDays',7,'clockStart','ATLAS_COLLECTION','entryUrl','/account/submit?kiosk='||entry_token,'directionsUrl','https://www.google.com/maps/dir/?api=1&destination='||latitude||','||longitude,'mapEmbedUrl','https://maps.google.com/maps?q='||latitude||','||longitude||'&z=14&output=embed')
 ||atlas_dealer.projection(schedule,at_time) ORDER BY name,id),'[]'::jsonb),
 'resolvedLocationId',max(CASE WHEN entry_token=entry THEN id::text END))
 FROM atlas_dealer.location WHERE enabled AND authorized_until>at_time AND atlas_dealer.projection(schedule,at_time)->>'projectedReturn' IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.handoff_projection(hid uuid, include_cards boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('id',h.id,'orderId',h.order_id,'reference',o.reference,
  'location',jsonb_build_object('id',h.location_id,'name',l.name),'cardCount',cardinality(h.card_ids),
  'status',CASE WHEN r.id IS NULL THEN 'AWAITING_SHOP_RECEIPT' ELSE 'RECEIVED' END,
  'receipt',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'receivedAt',r.received_at,'cardCount',cardinality(r.card_ids)) END)
  ||CASE WHEN include_cards THEN jsonb_build_object('cards',(SELECT jsonb_agg(jsonb_build_object('cardId',c.card_id,'identity',c.paid_line->'identity') ORDER BY c.card_id)
    FROM atlas_dealer.order_card c WHERE c.order_id=h.order_id AND c.card_id=ANY(h.card_ids))) ELSE '{}'::jsonb END
 FROM atlas_dealer.handoff h JOIN atlas_customer."CommerceOrder" o ON o.id=h.order_id
 JOIN atlas_dealer.location l ON l.id=h.location_id LEFT JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id WHERE h.id=hid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_card_state(cid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 WITH facts AS (
 SELECT c.card_id,c.channel,l.manual_card_id,cu.kind custody,a.action_id,a.approved_at,b.state batch_state,b.stage batch_stage,b.code batch_code,
 EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=l.manual_card_id) discarded,
 (SELECT e.kind='DELAY_REPORTED' FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id AND e.kind IN ('DELAY_REPORTED','DELAY_RESOLVED') ORDER BY e.sequence DESC LIMIT 1) delayed
 FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id
 LEFT JOIN atlas_manual.card m ON m.id=l.manual_card_id
 LEFT JOIN LATERAL(SELECT kind FROM atlas_dealer.custody_event WHERE card_id=c.card_id AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED') ORDER BY sequence DESC LIMIT 1) cu ON true
 LEFT JOIN LATERAL(SELECT action_id,approved_at FROM atlas_manual.approval WHERE card_id=l.manual_card_id ORDER BY approved_at DESC,action_id DESC LIMIT 1) a ON true
 LEFT JOIN LATERAL(SELECT state,stage,code FROM atlas_manual_connected.batch_grading WHERE card_id=l.manual_card_id AND source_hash=m.content::jsonb#>>'{source,sourceHash}' ORDER BY created_at DESC,key LIMIT 1) b ON true
 WHERE c.card_id=cid), progress AS (
 SELECT *,CASE WHEN custody IN ('CUSTOMER_DELIVERED','CUSTOMER_COLLECTED') THEN 'COMPLETE'
 WHEN custody IN ('RETURN_DISPATCHED','RETURNED_TO_KIOSK','MAIL_DISPATCHED') THEN 'RETURNING'
 WHEN custody IS DISTINCT FROM 'ATLAS_RECEIVED' THEN 'WAITING_FOR_ARRIVAL'
 WHEN action_id IS NOT NULL THEN 'FINISHING'
 WHEN manual_card_id IS NULL THEN 'RECEIVED'
 WHEN batch_state='REVIEW' THEN 'HUMAN_REVIEW' ELSE 'GRADING' END progress_stage FROM facts)
 SELECT jsonb_build_object('stage',CASE WHEN discarded OR (batch_state='NEEDS_ATTENTION' AND progress_stage NOT IN ('FINISHING','RETURNING','COMPLETE')) THEN 'ATTENTION' ELSE progress_stage END,
 'progressStage',progress_stage,'attention',COALESCE(delayed,false) OR discarded OR COALESCE(batch_state='NEEDS_ATTENTION',false),
 'custody',custody,'manualCardId',manual_card_id,'approvedAt',approved_at,'approvalActionId',action_id,
 'grading',jsonb_build_object('state',CASE WHEN action_id IS NOT NULL THEN 'HUMAN_APPROVED' WHEN manual_card_id IS NULL THEN 'NOT_STARTED' WHEN batch_state='REVIEW' THEN 'HUMAN_REVIEW' ELSE 'IN_GRADING' END,
 'batchState',batch_state,'batchStage',batch_stage,'code',batch_code,'discarded',discarded)) FROM progress
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_detail(oid uuid, actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT atlas_dealer.order_desk_summary(o.id)||jsonb_build_object(
 'customer',jsonb_build_object('name',o.receipt->'profile'->>'name','email',o.receipt->'profile'->>'email','phone',q.snapshot->>'phone',
 'returnAddress',atlas_customer.commerce_public_fields(o.receipt->'profile',ARRAY['name','address1','address2','city','region','postalCode','country'])),
 'payments',jsonb_build_object('grading',jsonb_build_object('state','PAID','paidAt',o."paidAt",'receipt',atlas_customer.commerce_public_quote(o.receipt)),
 'shipping',jsonb_build_object('state',atlas_dealer.order_desk_summary(o.id)->'shippingPayment'->>'state','paidAt',sr."paidAt",'receipt',CASE WHEN sr.id IS NULL THEN NULL ELSE atlas_customer.commerce_public_quote(sr.receipt) END)),
 'shipping',jsonb_build_object('inbound',atlas_dealer.order_desk_shipping(o.id,'INBOUND'),'return',atlas_dealer.order_desk_shipping(o.id,'RETURN')),
 'returnShipping',atlas_dealer.order_desk_shipping(o.id,'RETURN'),
 'cards',COALESCE((SELECT jsonb_agg(atlas_dealer.card_tracking_with_handoff(c.card_id)||atlas_dealer.order_desk_card_state(c.card_id)||jsonb_build_object(
 'orderId',c.order_id,'locationId',c.location_id,'identitySource',ic."identitySource",'photos',atlas_dealer.order_desk_photos(c.card_id),
 'staffEvidence',jsonb_build_object('manualCardId',l.manual_card_id,'provenance','STAFF_GRADING_CAPTURE'),
 'finishing',jsonb_build_object('label','NOT_RECORDED','assembly','NOT_RECORDED','welding','NOT_RECORDED','packing','NOT_RECORDED',
 'nfc',CASE WHEN EXISTS(SELECT 1 FROM atlas_manual_connected.station_arm arm JOIN atlas_manual_connected.station_receipt r USING(intent_id)
 WHERE arm.card_id=l.manual_card_id AND arm.approval_action_id=(atlas_dealer.order_desk_card_state(c.card_id)->>'approvalActionId')::uuid
 AND r.kind='WRITE' AND r.receipt::jsonb->>'readbackVerified'='true' AND r.receipt::jsonb->>'lockVerified'='true') THEN 'VERIFIED' ELSE 'NOT_RECORDED' END),
 'custodyEvents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'requestId',e.request_id,'kind',e.kind,'occurredAt',e.occurred_at,'recordedAt',e.recorded_at,'evidence',e.evidence,'actorId',e.actor_id) ORDER BY e.sequence) FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id),'[]'::jsonb)) ORDER BY c.card_id)
 FROM atlas_dealer.order_card c JOIN atlas_customer."CustomerIntakeCard" ic ON ic.id=c.card_id LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id WHERE c.order_id=o.id),'[]'::jsonb),
 'manualCards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'revision',m.revision) ORDER BY m.updated_at DESC,m.id) FROM
 (SELECT id,revision,updated_at FROM atlas_manual.card c WHERE (owner_id=actor OR actor=ANY(editors))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=c.id)
 AND NOT EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link WHERE manual_card_id=c.id) ORDER BY updated_at DESC,id LIMIT 100)m),'[]'::jsonb),
 'history',COALESCE((SELECT jsonb_agg(e ORDER BY e->>'occurredAt',e->>'id') FROM (
 SELECT jsonb_build_object('id','payment:'||o.id,'kind','GRADING_PAYMENT_CONFIRMED','occurredAt',o."paidAt",'recordedAt',o."paidAt",'cardId',NULL,'actor',NULL,'note',NULL) e
 UNION ALL SELECT jsonb_build_object('id','shipping:'||sr.id,'kind','SHIPPING_PAYMENT_CONFIRMED','occurredAt',sr."paidAt",'recordedAt',sr."paidAt",'cardId',NULL,'actor',NULL,'note',NULL) WHERE sr.id IS NOT NULL
 UNION ALL SELECT jsonb_build_object('id','ack:'||ak.order_id,'kind','ORDER_ACKNOWLEDGED','occurredAt',ak.acknowledged_at,'recordedAt',ak.acknowledged_at,'cardId',NULL,'actor',atlas_dealer.order_inbox_acknowledgment_projection(o.id)->'acknowledgedBy','note',NULL) FROM atlas_dealer.order_inbox_acknowledgment ak WHERE ak.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id',ce.id,'kind',ce.kind,'occurredAt',ce.occurred_at,'recordedAt',ce.recorded_at,'cardId',ce.card_id,'actor',CASE WHEN si.id IS NULL THEN NULL ELSE jsonb_build_object('id',si.id,'name',si.name) END,'note',ce.evidence->>'note')
 FROM atlas_dealer.custody_event ce JOIN atlas_dealer.order_card c ON c.card_id=ce.card_id LEFT JOIN atlas_staff."StaffIdentity" si ON si.id=ce.actor_id WHERE c.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id','link:'||l.card_id,'kind','GRADING_CARD_LINKED','occurredAt',l.linked_at,'recordedAt',l.linked_at,'cardId',l.card_id,'actor',jsonb_build_object('id',si.id,'name',si.name),'note',l.evidence_ref)
 FROM atlas_dealer.manual_card_link l JOIN atlas_dealer.order_card c ON c.card_id=l.card_id JOIN atlas_staff."StaffIdentity" si ON si.id=l.actor_id WHERE c.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id','approval:'||a.action_id,'kind','REPORT_HUMAN_APPROVED','occurredAt',a.approved_at,'recordedAt',a.approved_at,'cardId',l.card_id,'actor',jsonb_build_object('id',si.id,'name',si.name),'note',NULL)
 FROM atlas_dealer.manual_card_link l JOIN atlas_dealer.order_card c ON c.card_id=l.card_id JOIN atlas_manual.approval a ON a.card_id=l.manual_card_id JOIN atlas_staff."StaffIdentity" si ON si.id=a.actor_id WHERE c.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id','handoff:'||r.id,'kind','DEALER_RECEIVED','occurredAt',r.received_at,'recordedAt',r.received_at,'cardId',NULL,'actor',NULL,'note',NULL)
 FROM atlas_dealer.handoff h JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id WHERE h.order_id=o.id
 ) history),'[]'::jsonb))
 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommerceQuote" q ON q.id=o."quoteId" LEFT JOIN atlas_customer."CommerceShippingReceipt" sr ON sr."orderId"=o.id WHERE o.id=oid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_group(stages jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'='WAITING_FOR_ARRIVAL') THEN 'ARRIVAL'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'='RECEIVED') THEN 'RECEIVED'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage' IN ('GRADING','HUMAN_REVIEW')) THEN 'GRADING_REVIEW'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage' IN ('FINISHING','READY_FOR_RETURN')) THEN 'FINISHING_PACKING'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'='RETURNING') THEN 'RETURNING'
 WHEN jsonb_array_length(stages)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'<>'COMPLETE') THEN 'COMPLETE' ELSE 'ARRIVAL' END
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_paid(oid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId"
 WHERE o.id=oid AND p.state='PAID' AND COALESCE(btrim(p."providerId"),'')<>''
 AND (p."accountId",p."draftId",p."quoteId")=(o."accountId",o."draftId",o."quoteId"))
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_pair_hash(cid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT atlas_customer.commerce_hash(jsonb_agg(jsonb_build_object('side',u.side,'plan',u.plan,'verification',u.verification) ORDER BY u.side))
 FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=cid HAVING count(*)=2 AND count(u.verification)=2
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_photos(cid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_object_agg(s.side,jsonb_build_object('state',CASE WHEN u.id IS NOT NULL AND u.verification IS NOT NULL AND u.prepared IS NOT NULL
 AND atlas_dealer.order_desk_pair_hash(c.card_id)=c.paid_line->>'photoPairHash' THEN 'READY' ELSE 'UNAVAILABLE' END,
 'uploadId',u.id,'provenance','CUSTOMER_SUBMISSION',
 'thumbnailUrl',CASE WHEN u.id IS NOT NULL AND u.verification IS NOT NULL AND u.prepared IS NOT NULL AND atlas_dealer.order_desk_pair_hash(c.card_id)=c.paid_line->>'photoPairHash'
 THEN '/api/staff/manual-connected/order-desk/orders/'||c.order_id||'/cards/'||c.card_id||'/photos/'||s.side||'?size=thumbnail' END,
 'detailUrl',CASE WHEN u.id IS NOT NULL AND u.verification IS NOT NULL AND u.prepared IS NOT NULL AND atlas_dealer.order_desk_pair_hash(c.card_id)=c.paid_line->>'photoPairHash'
 THEN '/api/staff/manual-connected/order-desk/orders/'||c.order_id||'/cards/'||c.card_id||'/photos/'||s.side||'?size=detail' END))
 FROM atlas_dealer.order_card c CROSS JOIN (VALUES('FRONT'),('BACK')) s(side)
 LEFT JOIN atlas_customer."CustomerIntakeUpload" u ON u."cardId"=c.card_id AND u.side=s.side WHERE c.card_id=cid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_shipping(oid uuid, leg text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT COALESCE((SELECT jsonb_build_object('state',e.state,'artifactState',CASE WHEN atlas_dealer.order_desk_label_valid(e) THEN 'READY' ELSE 'PENDING' END,
 'trackingNumber',CASE WHEN atlas_dealer.order_desk_label_valid(e) THEN e.result->>'trackingNumber' END,
 'carrierName',e.result->>'carrierName','serviceName',e.result->>'serviceName',
 'prepared',e.fulfillment IS NOT NULL,'preparedRequestId',e.fulfillment->>'requestId',
 'canPrepare',leg='RETURN' AND e.kind='SHIPSTATION_LABEL' AND e.state='PENDING' AND e.fulfillment IS NULL AND atlas_customer.commerce_return_ready(oid),
 'labelUrl',CASE WHEN atlas_dealer.order_desk_label_valid(e) THEN CASE WHEN leg='RETURN' THEN '/api/staff/manual-connected/dealer-operations/orders/'||oid||'/return-label'
 ELSE '/api/staff/manual-connected/order-desk/orders/'||oid||'/labels/INBOUND' END END)
 FROM atlas_customer."CommerceEffect" e WHERE e."orderId"=oid AND e.kind IN ('FEDEX_LABEL','SHIPSTATION_LABEL') AND e.request->>'leg'=leg
 AND e.id=oid::text||CASE WHEN e.kind='SHIPSTATION_LABEL' THEN ':shipstation:' ELSE ':fedex:' END||leg||':v1' ORDER BY e."createdAt" DESC,e.id LIMIT 1),
 jsonb_build_object('state','NOT_REQUESTED','artifactState','PENDING','trackingNumber',NULL,'prepared',false,'preparedRequestId',NULL,'canPrepare',false,'labelUrl',NULL))
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_desk_summary(oid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 WITH facts AS (SELECT COALESCE(jsonb_agg(atlas_dealer.order_desk_card_state(card_id) ORDER BY card_id),'[]'::jsonb) states,count(*) n FROM atlas_dealer.order_card WHERE order_id=oid)
 SELECT jsonb_build_object('id',o.id,'reference',o.reference,'paidAt',o."paidAt",'channel',o.receipt->>'channel',
 'customer',jsonb_build_object('name',o.receipt->'profile'->>'name','email',o.receipt->'profile'->>'email','phone',q.snapshot->>'phone'),
 'cardCount',f.n,'stage',CASE WHEN f.n=0 THEN 'ATTENTION' WHEN (SELECT count(DISTINCT e->>'stage') FROM jsonb_array_elements(f.states) e)>1 THEN 'MIXED' ELSE f.states->0->>'stage' END,
 'mixedStages',(SELECT count(DISTINCT e->>'stage') FROM jsonb_array_elements(f.states) e)>1,'group',atlas_dealer.order_desk_group(f.states),
 'attentionCount',(SELECT count(*) FROM jsonb_array_elements(f.states) e WHERE e->>'attention'='true'),
 'stageCounts',COALESCE((SELECT jsonb_object_agg(stage,n) FROM (SELECT e->>'stage' stage,count(*) n FROM jsonb_array_elements(f.states) e GROUP BY e->>'stage') c),'{}'::jsonb),
 'acknowledgment',atlas_dealer.order_inbox_acknowledgment_projection(o.id),
 'gradingPayment',jsonb_build_object('state','PAID','currency',o.receipt->>'currency','totalCents',o.receipt->'totalCents'),
 'shippingPayment',jsonb_build_object('state',CASE WHEN o.receipt->>'channel'='KIOSK' THEN 'NOT_APPLICABLE'
 WHEN o.receipt->'terms'->>'shippingPayment'='SEPARATE_PAYMENT' THEN COALESCE(atlas_customer.commerce_shipping_public_state(o.id)->>'state','UNQUOTED_UNPAID')
 WHEN jsonb_array_length(COALESCE(o.receipt->'shipping','[]'::jsonb))>0 THEN 'INCLUDED_IN_GRADING_PAYMENT' ELSE 'NOT_RECORDED' END))
 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommerceQuote" q ON q.id=o."quoteId" CROSS JOIN facts f WHERE o.id=oid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.order_inbox_acknowledgment_projection(oid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('requestId',a.request_id,'acknowledgedAt',a.acknowledged_at,
  'acknowledgedBy',jsonb_build_object('id',a.actor_id,'name',i.name))
 FROM atlas_dealer.order_inbox_acknowledgment a
 JOIN atlas_staff."StaffIdentity" i ON i.id=a.actor_id WHERE a.order_id=oid
$function$;

CREATE OR REPLACE FUNCTION atlas_dealer.with_shop_receipts(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN NOT p ? 'location' THEN p ELSE p||jsonb_build_object('orders',COALESCE((
 SELECT jsonb_agg(o.value||jsonb_build_object('cards',(SELECT jsonb_agg(c.value||CASE WHEN r.id IS NULL THEN '{}'::jsonb ELSE
 jsonb_build_object('dealerReceivedAt',r.received_at)||CASE WHEN c.value->>'custody' IS NULL OR c.value->>'custody'='DEPOSIT_DECLARED'
 THEN jsonb_build_object('custody','DEALER_RECEIVED','occurredAt',r.received_at) ELSE '{}'::jsonb END END ORDER BY c.n)
 FROM jsonb_array_elements(o.value->'cards') WITH ORDINALITY c(value,n)
 LEFT JOIN atlas_dealer.order_card oc ON oc.card_id=(c.value->>'cardId')::uuid AND oc.location_id=(p->'location'->>'id')::uuid
 LEFT JOIN atlas_dealer.handoff h ON h.order_id=oc.order_id LEFT JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id AND oc.card_id=ANY(r.card_ids))) ORDER BY o.n)
 FROM jsonb_array_elements(p->'orders') WITH ORDINALITY o(value,n)),'[]'::jsonb)) END
$function$;

CREATE OR REPLACE FUNCTION atlas_manual.defect_memory_design(identity jsonb, profile text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  WITH normalized AS (SELECT key, NULLIF(lower(trim(regexp_replace(normalize(value,NFKC),'\s+',' ','g'))),'') AS value
    FROM jsonb_each_text(identity))
  SELECT jsonb_build_object('version','atlas-defect-design-v1','category',profile,
    'year',(SELECT value FROM normalized WHERE key='year'),
    'manufacturer',CASE WHEN profile='SPORTS' THEN (SELECT value FROM normalized WHERE key='manufacturer') END,
    'productSet',(SELECT value FROM normalized WHERE key='productSet'),
    'parallel',(SELECT value FROM normalized WHERE key='parallel'),
    'insert',CASE WHEN profile='SPORTS' THEN (SELECT value FROM normalized WHERE key='insert') END,
    'layoutType',CASE WHEN profile='POKEMON' THEN (SELECT value FROM normalized WHERE key='layoutType') END);
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.claim_early_geometry(engine text, claim uuid)
 RETURNS SETOF atlas_manual_connected.early_geometry
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
 SELECT * FROM atlas_manual_connected.claim_early_geometry(engine,claim,2);
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.display_owner_current(owner uuid, version integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM atlas_staff."StaffIdentity" a WHERE a.id=owner
   AND a."accessVersion"=version AND a."revokedAt" IS NULL AND a.role='REVIEWER');
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.display_owner_version(owner uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT a."accessVersion" FROM atlas_staff."StaffIdentity" a WHERE a.id=owner
   AND a."revokedAt" IS NULL AND a.role='REVIEWER';
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.geometry_side_settings(details jsonb, selected_side text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN selected_side IN ('FRONT','BACK') THEN jsonb_build_object(
   'matColor',COALESCE(details->>(CASE selected_side WHEN 'FRONT' THEN 'frontMatColor' ELSE 'backMatColor' END),details->>'matColor','BLACK'),
   'cornerShape',COALESCE(details->>'cornerShape','ROUNDED_3_18_MM')) ELSE NULL END;
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.pending_early_geometry(engine text, after_created timestamp with time zone, after_upload uuid)
 RETURNS TABLE(card_id uuid, upload_id uuid, side text, plan text, verification text, source text, settings jsonb, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
 SELECT c.id,u.id,u.side,u.plan,u.verification,u.source,
 atlas_manual_connected.geometry_side_settings(d.content::jsonb,u.side),i.created_at
 FROM atlas_manual_connected.early_geometry_intent i
 JOIN atlas_manual_intake.card c ON c.id=i.card_id AND c.owner_id=i.actor_id
 JOIN atlas_manual_intake.upload u ON u.id=i.upload_id AND u.card_id=c.id AND u.source IS NOT NULL
 JOIN atlas_staff."StaffIdentity" a ON a.id=i.actor_id AND a."accessVersion"=i.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 LEFT JOIN atlas_manual_connected.details d ON d.card_id=c.id
 WHERE NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 AND u.id=CASE u.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND (after_created IS NULL OR (i.created_at,u.id)>(after_created,after_upload))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.early_geometry j WHERE j.upload_id=u.id AND j.engine_hash=engine
 AND j.input::jsonb->'settings'=atlas_manual_connected.geometry_side_settings(d.content::jsonb,u.side))
 ORDER BY i.created_at,u.id LIMIT 2;
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.read_geometry_model(job text)
 RETURNS SETOF atlas_manual_connected.geometry_model_action
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_manual_connected'
AS $function$
 SELECT * FROM atlas_manual_connected.geometry_model_action WHERE job_key=job ORDER BY attempt DESC LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION atlas_manual_connected.read_grading_photo(p_card uuid, p_upload uuid, p_side text, p_mode text)
 RETURNS TABLE(key text, state text, result text, result_hash text, source_hash text, recipe_hash text, bound_original_sha256 text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT j.key,j.state,j.result,j.result_hash,j.source_hash,j.recipe_hash,b.original_sha256
 FROM atlas_manual_connected.card_image_binding b
 JOIN atlas_manual_connected.report_image_job j ON j.key=b.job_key
 JOIN atlas_manual_intake.card c ON c.id=b.card_id
 JOIN atlas_manual_intake.upload u ON u.card_id=c.id AND u.id=b.upload_id AND u.side=b.side
 WHERE b.card_id=p_card AND b.upload_id=p_upload AND b.side=p_side AND j.mode=p_mode
 AND b.upload_id=CASE WHEN b.side='FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND b.original_sha256=u.plan::jsonb->'expected'->>'sha256'
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)
$function$;

CREATE OR REPLACE FUNCTION atlas_staff.lock_control()
 RETURNS SETOF atlas_staff."StaffControl"
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas_staff'
AS $function$SELECT * FROM atlas_staff."StaffControl" WHERE id = 'active' FOR SHARE$function$;

REVOKE ALL ON SCHEMA "atlas_customer" FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA "atlas_customer" FROM PUBLIC;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA "atlas_customer" FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "atlas_customer" FROM PUBLIC;

REVOKE ALL ON SCHEMA "atlas_dealer" FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA "atlas_dealer" FROM PUBLIC;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA "atlas_dealer" FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "atlas_dealer" FROM PUBLIC;

REVOKE ALL ON SCHEMA "atlas_defect_analysis" FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA "atlas_defect_analysis" FROM PUBLIC;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA "atlas_defect_analysis" FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "atlas_defect_analysis" FROM PUBLIC;

REVOKE ALL ON SCHEMA "atlas_manual" FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA "atlas_manual" FROM PUBLIC;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA "atlas_manual" FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "atlas_manual" FROM PUBLIC;

REVOKE ALL ON SCHEMA "atlas_manual_connected" FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA "atlas_manual_connected" FROM PUBLIC;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA "atlas_manual_connected" FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "atlas_manual_connected" FROM PUBLIC;

REVOKE ALL ON SCHEMA "atlas_manual_intake" FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA "atlas_manual_intake" FROM PUBLIC;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA "atlas_manual_intake" FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "atlas_manual_intake" FROM PUBLIC;

REVOKE ALL ON SCHEMA "atlas_staff" FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA "atlas_staff" FROM PUBLIC;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA "atlas_staff" FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "atlas_staff" FROM PUBLIC;
