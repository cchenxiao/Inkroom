CREATE TABLE chapter_assemblies (
 id text PRIMARY KEY,
 scope text NOT NULL REFERENCES planning_heads(scope),
 chapter_id text NOT NULL,
 version integer NOT NULL CHECK(version > 0),
 request jsonb NOT NULL,
 record jsonb NOT NULL,
 UNIQUE(scope, chapter_id, version)
);
CREATE TABLE chapter_assembly_sources (
 assembly_id text NOT NULL REFERENCES chapter_assemblies(id) ON DELETE CASCADE,
 beat_id text NOT NULL,
 commit_id text NOT NULL REFERENCES manuscript_commits(id),
 PRIMARY KEY(assembly_id,beat_id)
);
