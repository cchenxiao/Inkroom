CREATE TABLE planning_run_inputs (
 run_id text PRIMARY KEY REFERENCES runs(id),
 scope text NOT NULL REFERENCES planning_heads(scope),
 chapter_id text NOT NULL,
 record jsonb NOT NULL
);
CREATE INDEX planning_run_inputs_chapter ON planning_run_inputs(scope,chapter_id);
