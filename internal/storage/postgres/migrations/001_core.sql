-- 章节/分支的唯一版本头，是所有正文写入的并发锁边界。
CREATE TABLE chapters (
 id text NOT NULL,
 branch_id text NOT NULL,
 draft_version integer NOT NULL DEFAULT 0 CHECK (draft_version >= 0),
 PRIMARY KEY (id, branch_id)
);
CREATE TABLE runs (
 id text PRIMARY KEY,
 chapter_id text NOT NULL,
 branch_id text NOT NULL,
 status text NOT NULL,
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (chapter_id,branch_id) REFERENCES chapters(id,branch_id)
);
CREATE UNIQUE INDEX one_active_chapter_run ON runs(chapter_id,branch_id) WHERE status='running';
CREATE INDEX latest_runs ON runs(created_at DESC,id DESC);
-- 保存完整稿本快照；正文只追加，复检结果存在 reviews，不回写历史正文。
CREATE TABLE chapter_versions (
 chapter_id text NOT NULL,
 branch_id text NOT NULL,
 draft_version integer NOT NULL CHECK (draft_version>0),
 segments jsonb NOT NULL,
 origin text NOT NULL CHECK (origin IN ('agent','human_inline')),
 run_id text REFERENCES runs(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(chapter_id,branch_id,draft_version),
 FOREIGN KEY(chapter_id,branch_id) REFERENCES chapters(id,branch_id)
);
CREATE TABLE segment_versions (
 chapter_id text NOT NULL,
 branch_id text NOT NULL,
 segment_id text NOT NULL,
 version integer NOT NULL CHECK(version>0),
 payload jsonb NOT NULL,
 PRIMARY KEY(chapter_id,branch_id,segment_id,version),
 FOREIGN KEY(chapter_id,branch_id) REFERENCES chapters(id,branch_id)
);
CREATE TABLE reviews (
 run_id text NOT NULL REFERENCES runs(id),
 draft_version integer NOT NULL,
 report jsonb NOT NULL,
 PRIMARY KEY(run_id,draft_version)
);
CREATE TABLE llm_calls (
 run_id text NOT NULL REFERENCES runs(id),
 call_number integer NOT NULL,
 phase text NOT NULL CHECK(phase IN ('started','finished','unknown')),
 record jsonb NOT NULL,
 PRIMARY KEY(run_id,call_number)
);
