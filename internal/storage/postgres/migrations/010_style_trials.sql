ALTER TABLE planning_heads ADD COLUMN style_version integer NOT NULL DEFAULT 0;
CREATE TABLE planning_style_jobs (
 id text PRIMARY KEY,
 scope text NOT NULL REFERENCES planning_heads(scope),
 status text NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
 record jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX planning_style_one_running ON planning_style_jobs(scope) WHERE status='running';
CREATE INDEX planning_style_jobs_scope ON planning_style_jobs(scope,created_at DESC);
CREATE TABLE planning_style_calls (
 job_id text NOT NULL REFERENCES planning_style_jobs(id),
 number integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(job_id,number)
);
CREATE TABLE planning_style_selections (
 scope text NOT NULL REFERENCES planning_heads(scope),
 version integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(scope,version)
);
