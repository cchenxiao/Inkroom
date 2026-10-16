CREATE TABLE chapter_review_jobs (
 id text PRIMARY KEY,
 scope text NOT NULL REFERENCES planning_heads(scope),
 assembly_id text NOT NULL REFERENCES chapter_assemblies(id),
 status text NOT NULL,
 record jsonb NOT NULL,
 sequence bigserial UNIQUE
);
CREATE UNIQUE INDEX chapter_review_one_active ON chapter_review_jobs(scope) WHERE status='running';
CREATE INDEX chapter_review_history ON chapter_review_jobs(assembly_id,sequence DESC);
CREATE TABLE chapter_review_calls (
 job_id text NOT NULL REFERENCES chapter_review_jobs(id) ON DELETE CASCADE,
 number integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(job_id,number)
);
CREATE TABLE chapter_review_decisions (
 request_id text PRIMARY KEY,
 job_id text NOT NULL UNIQUE REFERENCES chapter_review_jobs(id) ON DELETE CASCADE,
 record jsonb NOT NULL
);
