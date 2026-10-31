ALTER TABLE documents
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX documents_tags_idx
  ON documents USING GIN (tags);
