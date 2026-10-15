ALTER TABLE runs ADD COLUMN event_sequence bigint NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN event_floor bigint NOT NULL DEFAULT 0;
CREATE TABLE run_events (
 run_id text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
 sequence bigint NOT NULL,
 type text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 payload jsonb NOT NULL,
 PRIMARY KEY(run_id,sequence)
);
-- event 正文只追加；投递状态独立记录。bigserial 只标识 outbox，不用作重放游标。
CREATE TABLE run_outbox (
 id bigserial PRIMARY KEY,
 run_id text NOT NULL,
 sequence bigint NOT NULL,
 FOREIGN KEY(run_id,sequence) REFERENCES run_events(run_id,sequence) ON DELETE CASCADE
);
CREATE INDEX run_outbox_run ON run_outbox(run_id,sequence);
