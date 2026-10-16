CREATE TABLE planning_style_analyses (
 id text PRIMARY KEY,
 scope text NOT NULL REFERENCES planning_heads(scope),
 status text NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
 record jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX planning_analysis_one_running ON planning_style_analyses(scope) WHERE status='running';
CREATE INDEX planning_analysis_scope ON planning_style_analyses(scope,created_at DESC);
CREATE TABLE planning_analysis_calls (
 job_id text NOT NULL REFERENCES planning_style_analyses(id),
 number integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(job_id,number)
);
