CREATE TABLE planning_chapter_plan_jobs (
 id text PRIMARY KEY,
 scope text NOT NULL REFERENCES planning_heads(scope),
 status text NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
 record jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX planning_chapter_plan_one_running ON planning_chapter_plan_jobs(scope) WHERE status='running';
CREATE INDEX planning_chapter_plan_jobs_scope ON planning_chapter_plan_jobs(scope,created_at DESC);
CREATE TABLE planning_chapter_plan_calls (
 job_id text NOT NULL REFERENCES planning_chapter_plan_jobs(id),
 number integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(job_id,number)
);
CREATE TABLE planning_chapter_plan_selections (
 scope text NOT NULL REFERENCES planning_heads(scope),
 chapter_id text NOT NULL,
 version integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(scope,chapter_id,version)
);
