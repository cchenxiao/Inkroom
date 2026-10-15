CREATE TABLE knowledge_snapshots (
 digest text PRIMARY KEY,
 project_id text NOT NULL,
 branch_id text NOT NULL,
 version integer NOT NULL CHECK (version > 0),
 snapshot jsonb NOT NULL,
 origin text NOT NULL CHECK (origin IN ('human','teaching_seed')),
 reason text NOT NULL CHECK (length(trim(reason)) > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,branch_id,version),
 UNIQUE(project_id,branch_id,version,digest)
);
CREATE TABLE knowledge_heads (
 project_id text NOT NULL,
 branch_id text NOT NULL,
 version integer NOT NULL,
 digest text NOT NULL,
 PRIMARY KEY(project_id,branch_id),
 FOREIGN KEY(project_id,branch_id,version,digest) REFERENCES knowledge_snapshots(project_id,branch_id,version,digest)
);
ALTER TABLE memory_records DROP CONSTRAINT memory_records_origin_check;
ALTER TABLE memory_records ADD CONSTRAINT memory_records_origin_check CHECK(origin IN ('commit','teaching_seed','knowledge'));
ALTER TABLE memory_records ADD COLUMN knowledge_digest text;
ALTER TABLE memory_records ADD FOREIGN KEY(project_id,branch_id,version,knowledge_digest) REFERENCES knowledge_snapshots(project_id,branch_id,version,digest);
ALTER TABLE memory_records ADD CONSTRAINT memory_knowledge_provenance CHECK (
 (knowledge_digest IS NULL AND NOT (record ? 'knowledge') AND origin <> 'knowledge') OR
 (knowledge_digest IS NOT NULL AND origin IN ('knowledge','teaching_seed') AND id LIKE 'knowledge/%'
  AND record->'knowledge'->>'digest' = knowledge_digest
  AND (record->'knowledge'->>'version')::integer = version)
);
