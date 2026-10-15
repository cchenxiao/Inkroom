CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE memory_records (
 digest text PRIMARY KEY,
 project_id text NOT NULL,
 branch_id text NOT NULL,
 id text NOT NULL,
 version integer NOT NULL CHECK(version>0),
 record jsonb NOT NULL,
 origin text NOT NULL CHECK(origin IN ('commit','teaching_seed')),
 source_commit_id text REFERENCES manuscript_commits(id),
 CHECK ((origin='commit')=(source_commit_id IS NOT NULL)),
 UNIQUE(project_id,branch_id,id,version)
);
CREATE TABLE memory_heads (
 project_id text NOT NULL,
 branch_id text NOT NULL,
 id text NOT NULL,
 digest text NOT NULL REFERENCES memory_records(digest),
 PRIMARY KEY(project_id,branch_id,id)
);
CREATE TABLE memory_embeddings (
 digest text NOT NULL REFERENCES memory_records(digest) ON DELETE CASCADE,
 model text NOT NULL,
 dimensions integer NOT NULL CHECK(dimensions BETWEEN 1 AND 4096),
 embedding vector NOT NULL,
 CHECK(vector_dims(embedding)=dimensions),
 PRIMARY KEY(digest,model)
);
