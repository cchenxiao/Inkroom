-- 运行开始前保存输入。不能在审批/定稿时读取新的 fixture 冒充当时材料。
CREATE TABLE run_contexts (
 run_id text PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
 input jsonb NOT NULL
);
CREATE TABLE manuscript_commits (
 id text PRIMARY KEY,
 run_id text NOT NULL UNIQUE REFERENCES runs(id),
 chapter_id text NOT NULL,
 branch_id text NOT NULL,
 draft_version integer NOT NULL,
 parent_commit text REFERENCES manuscript_commits(id),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(chapter_id,branch_id,draft_version) REFERENCES chapter_versions(chapter_id,branch_id,draft_version)
);
CREATE INDEX commits_history ON manuscript_commits(chapter_id,branch_id,created_at DESC);
CREATE TABLE commit_refs (
 commit_id text NOT NULL REFERENCES manuscript_commits(id) ON DELETE CASCADE,
 kind text NOT NULL,
 object_id text NOT NULL,
 version integer NOT NULL,
 digest text NOT NULL,
 payload jsonb NOT NULL,
 PRIMARY KEY(commit_id,kind,object_id)
);
