-- Add FEIJU F8215 as a separately committed PostgreSQL enum value.
-- PostgreSQL requires this commit boundary before a later migration may use
-- the new value in table constraints.

ALTER TYPE "AiGraderNfcChipType" ADD VALUE 'FEIJU_F8215' BEFORE 'NTAG424_DNA';
