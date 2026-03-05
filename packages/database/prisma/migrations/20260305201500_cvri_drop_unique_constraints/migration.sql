-- Remove DB-level dedupe constraints for reference images.
-- Keep primary key intact.
DO $$
DECLARE
  table_oid oid;
  rec record;
BEGIN
  table_oid := to_regclass('"CardVariantReferenceImage"');
  IF table_oid IS NULL THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = table_oid
      AND contype = 'u'
  LOOP
    EXECUTE format(
      'ALTER TABLE "CardVariantReferenceImage" DROP CONSTRAINT IF EXISTS %I',
      rec.conname
    );
  END LOOP;

  FOR rec IN
    SELECT idx.relname AS index_name
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    WHERE i.indrelid = table_oid
      AND i.indisunique = true
      AND i.indisprimary = false
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', rec.index_name);
  END LOOP;
END $$;
