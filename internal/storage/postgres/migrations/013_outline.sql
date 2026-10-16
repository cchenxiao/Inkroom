ALTER TABLE planning_heads ADD COLUMN outline_version integer NOT NULL DEFAULT 0;
CREATE TABLE planning_outline_jobs (
 id text PRIMARY KEY,
 scope text NOT NULL REFERENCES planning_heads(scope),
 status text NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
 record jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX planning_outline_one_running ON planning_outline_jobs(scope) WHERE status='running';
CREATE INDEX planning_outline_jobs_scope ON planning_outline_jobs(scope,created_at DESC);
CREATE TABLE planning_outline_calls (
 job_id text NOT NULL REFERENCES planning_outline_jobs(id),
 number integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(job_id,number)
);
CREATE TABLE planning_outline_selections (
 scope text NOT NULL REFERENCES planning_heads(scope),
 version integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(scope,version)
);
CREATE TABLE planning_outline_bindings (
 scope text NOT NULL,
 version integer NOT NULL,
 outline_version integer NOT NULL,
 style_version integer NOT NULL,
 core_version integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(scope,version),
 FOREIGN KEY(scope,outline_version) REFERENCES planning_outline_selections(scope,version)
);
