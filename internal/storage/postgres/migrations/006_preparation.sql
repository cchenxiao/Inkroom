-- 准备输入与最终 Writer 输入各存一份不可变快照；工具轨迹随 run 事件持久化。
CREATE TABLE run_preparations (
 run_id text PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
 input jsonb NOT NULL
);
