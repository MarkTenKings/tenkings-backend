-- Additive Shanghai Feiju iPhone-assisted static-link profile.
-- This migration does not add Feiju APDUs, UID storage, or PC-reader support.

ALTER TYPE "AiGraderNfcChipType" ADD VALUE 'FEIJU_PROPRIETARY_ISODEP';
ALTER TYPE "AiGraderNfcSecurityMode" ADD VALUE 'manual_ios_locked_static_url_v1';
