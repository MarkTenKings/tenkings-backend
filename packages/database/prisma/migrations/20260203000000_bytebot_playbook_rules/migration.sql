-- Bytebot playbook rules for teach mode

CREATE TABLE IF NOT EXISTS "BytebotPlaybookRule" (
  "id" TEXT PRIMARY KEY,
  "source" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "selector" TEXT NOT NULL,
  "urlContains" TEXT,
  "label" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BytebotPlaybookRule_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "BytebotPlaybookRule_source_enabled_priority_idx"
  ON "BytebotPlaybookRule" ("source", "enabled", "priority");
CREATE INDEX IF NOT EXISTS "BytebotPlaybookRule_createdById_idx"
  ON "BytebotPlaybookRule" ("createdById");

-- ensure updatedAt auto-maintains via trigger
CREATE OR REPLACE FUNCTION update_bytebot_playbook_rule_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bytebot_playbook_rule_updated_at ON "BytebotPlaybookRule";
CREATE TRIGGER bytebot_playbook_rule_updated_at
  BEFORE UPDATE ON "BytebotPlaybookRule"
  FOR EACH ROW
  EXECUTE FUNCTION update_bytebot_playbook_rule_updated_at();
