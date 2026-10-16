-- Append-only chapter publications. Neither Beat commits nor knowledge heads change here.
CREATE TABLE chapter_publications (
 id text PRIMARY KEY,
 scope text NOT NULL REFERENCES planning_heads(scope),
 chapter_id text NOT NULL,
 review_id text NOT NULL UNIQUE REFERENCES chapter_review_jobs(id),
 assembly_id text NOT NULL REFERENCES chapter_assemblies(id),
 approval_id text NOT NULL REFERENCES chapter_review_decisions(request_id),
 version integer NOT NULL CHECK (version > 0),
 record jsonb NOT NULL,
 UNIQUE(scope, chapter_id, version)
);
CREATE INDEX chapter_publication_latest ON chapter_publications(scope,chapter_id,version DESC);
