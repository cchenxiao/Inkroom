-- Checkpoint 由 Eino 序列化；版本号锁定图结构及序列化契约。
CREATE TABLE run_checkpoints (
 run_id text PRIMARY KEY REFERENCES runs(id),
 workflow_version text NOT NULL,
 payload bytea NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- 一次人工决定只有一个稳定键；同键不同内容拒绝。
CREATE TABLE run_actions (
 run_id text NOT NULL REFERENCES runs(id),
 action_id text NOT NULL,
 request jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','completed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,action_id)
);
CREATE UNIQUE INDEX one_pending_action ON run_actions(run_id) WHERE status='pending';
-- 业务产物与正文同事务提交。Checkpoint 落后时可复用产物，不重复改稿。
CREATE TABLE run_artifacts (
 run_id text NOT NULL REFERENCES runs(id),
 operation_key text NOT NULL,
 state jsonb NOT NULL,
 PRIMARY KEY(run_id,operation_key)
);
