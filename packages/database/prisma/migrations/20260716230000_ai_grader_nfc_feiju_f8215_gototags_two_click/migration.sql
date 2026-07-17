-- Additive FEIJU F8215 / GoToTags manual-start profile.
-- REVIEWED MIGRATION CANDIDATE: do not apply to production from this branch.
-- Existing NTAG215 rows and exact v1 workstation evidence remain valid.

CREATE TYPE "AiGraderNfcProgrammingProfile" AS ENUM (
  'ntag215_direct_pcsc_v1',
  'gototags_manual_start_v1',
  'ntag424_dna_unimplemented'
);

ALTER TABLE "AiGraderNfcTag"
  ADD COLUMN "programmingProfile" "AiGraderNfcProgrammingProfile" NOT NULL
  DEFAULT 'ntag215_direct_pcsc_v1';

ALTER TABLE "AiGraderNfcTag"
  DROP CONSTRAINT "AiGraderNfcTag_strategy_pair";

ALTER TABLE "AiGraderNfcTag"
  ADD CONSTRAINT "AiGraderNfcTag_strategy_pair" CHECK (
    ("chipType" = 'NTAG215' AND
     "securityMode" = 'static_url_v1' AND
     "programmingProfile" = 'ntag215_direct_pcsc_v1') OR
    ("chipType" = 'FEIJU_F8215' AND
     "securityMode" = 'static_url_v1' AND
     "programmingProfile" = 'gototags_manual_start_v1') OR
    ("chipType" = 'NTAG424_DNA' AND
     "securityMode" = 'ntag424_sun_v1' AND
     "programmingProfile" = 'ntag424_dna_unimplemented')
  );

ALTER TABLE "AiGraderNfcProgrammingAttempt"
  DROP CONSTRAINT "AiGraderNfcProgrammingAttempt_attestation_evidence";

ALTER TABLE "AiGraderNfcProgrammingAttempt"
  ADD CONSTRAINT "AiGraderNfcProgrammingAttempt_attestation_evidence" CHECK (
    "readbackEvidence" IS NULL OR (
      jsonb_typeof("readbackEvidence") = 'object' AND (
        (
          "readbackEvidence" = jsonb_build_object(
            'schemaVersion', 'ai-grader-nfc-helper-attestation-v1',
            'workstationKeyId', "completedWorkstationKeyId",
            'algorithm', "expectedAttestationAlgorithm",
            'statementSha256', "readbackEvidence"->>'statementSha256',
            'signature', "readbackEvidence"->>'signature',
            'observedAt', "readbackEvidence"->>'observedAt',
            'helperProtocolVersion', 'tenkings-ai-grader-nfc-loopback-v2',
            'readerResultCode', "readbackEvidence"->>'readerResultCode',
            'cryptographicTagAuthentication', false,
            'workstationOperationalAttestation', true
          ) AND
          "readbackEvidence"->>'schemaVersion' = 'ai-grader-nfc-helper-attestation-v1' AND
          "readbackEvidence"->>'readerResultCode' IN ('write_verified_pcsc_readback', 'already_programmed_exact')
        ) OR
        (
          "readbackEvidence" = jsonb_build_object(
            'schemaVersion', 'ai-grader-nfc-helper-attestation-v2',
            'workstationKeyId', "completedWorkstationKeyId",
            'algorithm', "expectedAttestationAlgorithm",
            'statementSha256', "readbackEvidence"->>'statementSha256',
            'signature', "readbackEvidence"->>'signature',
            'observedAt', "readbackEvidence"->>'observedAt',
            'helperProtocolVersion', 'tenkings-ai-grader-nfc-loopback-v2',
            'readerResultCode', 'write_locked_verified_gototags_readback',
            'chipType', 'FEIJU_F8215',
            'securityMode', 'static_url_v1',
            'programmingProfile', 'gototags_manual_start_v1',
            'adapterIdentity', 'gototags_desktop',
            'adapterVersion', '4.37.0.1',
            'uidFingerprintSha256', "readbackEvidence"->>'uidFingerprintSha256',
            'readbackPayloadSha256', "readbackEvidence"->>'readbackPayloadSha256',
            'writeProtectionState', 'permanently_read_only_verified',
            'cryptographicTagAuthentication', false,
            'workstationOperationalAttestation', true
          ) AND
          "readbackEvidence"->>'schemaVersion' = 'ai-grader-nfc-helper-attestation-v2'
        )
      ) AND
      "readbackEvidence"->>'workstationKeyId' = "completedWorkstationKeyId" AND
      "readbackEvidence"->>'algorithm' = "expectedAttestationAlgorithm" AND
      "readbackEvidence"->>'statementSha256' ~ '^[a-f0-9]{64}$' AND
      "readbackEvidence"->>'signature' ~ '^[A-Za-z0-9_-]{86}$' AND
      "readbackEvidence"->>'observedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' AND
      "readbackEvidence"->>'helperProtocolVersion' = 'tenkings-ai-grader-nfc-loopback-v2' AND
      "readbackEvidence"->'cryptographicTagAuthentication' = 'false'::jsonb AND
      "readbackEvidence"->'workstationOperationalAttestation' = 'true'::jsonb AND
      (
        "readbackEvidence"->>'schemaVersion' <> 'ai-grader-nfc-helper-attestation-v2' OR
        (
          "readbackEvidence"->>'uidFingerprintSha256' ~ '^[a-f0-9]{64}$' AND
          "readbackEvidence"->>'readbackPayloadSha256' ~ '^[a-f0-9]{64}$'
        )
      )
    )
  );
