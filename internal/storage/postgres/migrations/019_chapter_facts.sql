CREATE TABLE chapter_fact_jobs (
 id text PRIMARY KEY,
 scope text NOT NULL REFERENCES planning_heads(scope),
 review_id text NOT NULL REFERENCES chapter_review_jobs(id),
 status text NOT NULL,
 record jsonb NOT NULL,
 sequence bigserial UNIQUE
);
CREATE UNIQUE INDEX chapter_facts_one_active ON chapter_fact_jobs(scope) WHERE status='running';
CREATE INDEX chapter_facts_latest ON chapter_fact_jobs(review_id,sequence DESC);
CREATE TABLE chapter_fact_calls (
 job_id text NOT NULL REFERENCES chapter_fact_jobs(id) ON DELETE CASCADE,
 number integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(job_id,number)
);
CREATE TABLE chapter_fact_selections (
 request_id text PRIMARY KEY,
 job_id text NOT NULL REFERENCES chapter_fact_jobs(id) ON DELETE CASCADE,
 version integer NOT NULL,
 record jsonb NOT NULL,
 UNIQUE(job_id,version)
);
