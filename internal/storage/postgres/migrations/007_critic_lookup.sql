-- 评审查证与写作输入分开；中间轨迹和已完成证据均可追溯。
CREATE TABLE critic_lookups (
 run_id text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
 draft_version integer NOT NULL,
 payload jsonb NOT NULL,
 PRIMARY KEY(run_id,draft_version)
);
