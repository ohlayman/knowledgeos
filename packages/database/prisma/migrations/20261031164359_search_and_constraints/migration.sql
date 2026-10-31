-- Search indexes, partial unique indexes, and integrity triggers.
-- Prisma cannot express generated columns, partial indexes, or triggers, so
-- this migration is applied with `prisma migrate deploy`.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE chunks
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED;

CREATE INDEX chunks_search_vector_idx
  ON chunks USING GIN (search_vector);

CREATE INDEX chunks_search_text_trgm_idx
  ON chunks USING GIN (search_text gin_trgm_ops);

CREATE INDEX documents_title_trgm_idx
  ON documents USING GIN (title gin_trgm_ops);

-- One current version per document.
CREATE UNIQUE INDEX document_versions_one_current_idx
  ON document_versions (document_id)
  WHERE is_current = true;

-- One active processing job per version.
CREATE UNIQUE INDEX processing_jobs_one_active_idx
  ON processing_jobs (version_id)
  WHERE status IN ('queued', 'running');

-- One active provider config per kind.
CREATE UNIQUE INDEX provider_configs_one_active_idx
  ON provider_configs (kind)
  WHERE is_active = true;

-- One active relation per entity pair and type.
CREATE UNIQUE INDEX relations_one_active_idx
  ON relations (from_entity_id, to_entity_id, type)
  WHERE status = 'active';

-- One active entity per type and normalized name.
CREATE UNIQUE INDEX entities_active_unique_idx
  ON entities (type, normalized_name)
  WHERE status = 'active';

-- A chunk's document_id must match its version's document_id.
CREATE OR REPLACE FUNCTION assert_chunk_document_match()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM document_versions v
    WHERE v.id = NEW.version_id AND v.document_id = NEW.document_id
  ) THEN
    RAISE EXCEPTION 'chunk.document_id % does not match version %', NEW.document_id, NEW.version_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chunks_document_match_trg
  BEFORE INSERT OR UPDATE ON chunks
  FOR EACH ROW EXECUTE FUNCTION assert_chunk_document_match();

-- Active entities and relations must carry at least one source chunk.
ALTER TABLE entities
  ADD CONSTRAINT entities_source_chunks_not_empty
  CHECK (status <> 'active' OR cardinality(source_chunk_ids) > 0);

ALTER TABLE relations
  ADD CONSTRAINT relations_evidence_not_empty
  CHECK (status <> 'active' OR cardinality(evidence_chunk_ids) > 0);
