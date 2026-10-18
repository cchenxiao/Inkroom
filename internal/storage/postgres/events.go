package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/orchestration"
)

var _ app.LiveRepository = (*Store)(nil)

// 一条 SQL 同时读取版本、事件序号、用量和 checkpoint，避免快照与游标混版。
const snapshotSQL = `SELECT r.payload,r.event_sequence,
 EXISTS(SELECT 1 FROM run_checkpoints cp WHERE cp.run_id=r.id AND cp.workflow_version=$2),
 COALESCE((SELECT sum((record->'usage'->>'inputTokens')::bigint) FROM llm_calls WHERE run_id=r.id),0),
 COALESCE((SELECT sum((record->'usage'->>'outputTokens')::bigint) FROM llm_calls WHERE run_id=r.id),0),
 COALESCE((SELECT bool_and(phase='finished' AND (record->'usage'->>'known')::boolean) FROM llm_calls WHERE run_id=r.id),true),
 ARRAY(SELECT record->>'role' FROM llm_calls WHERE run_id=r.id AND phase='started' ORDER BY call_number),
 COALESCE((SELECT jsonb_agg(record ORDER BY call_number) FROM llm_calls WHERE run_id=r.id AND phase='started'),'[]'::jsonb),
 COALESCE((SELECT jsonb_agg(payload ORDER BY draft_version) FROM critic_lookups WHERE run_id=r.id),'[]'::jsonb)
 FROM runs r WHERE r.id=$1`

type queryRow interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func snapshot(ctx context.Context, q queryRow, id string) (app.Run, error) {
	var raw, checks, calls []byte
	var r app.Run
	err := q.QueryRow(ctx, snapshotSQL, id, orchestration.HumanWorkflowVersion).Scan(&raw, &r.EventSequence, &r.CanResume, &r.Usage.InputTokens, &r.Usage.OutputTokens, &r.Usage.Known, &r.ActiveRoles, &calls, &checks)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, app.ErrNotFound
	}
	if err != nil {
		return r, err
	}
	stored, err := decodeRun(raw)
	if err != nil {
		return r, err
	}
	// Older direct-save code marked committed runs stale when a shared draft changed.
	// Restore the immutable adoption in the read model; the current candidate stays separate.
	if stored.CommitID != "" && stored.Status == "stale" {
		stored.Status, stored.Error = "committed", ""
	}
	stored.EventSequence, stored.CanResume, stored.Usage, stored.ActiveRoles = r.EventSequence, r.CanResume, r.Usage, r.ActiveRoles
	if err = json.Unmarshal(calls, &stored.ActiveCalls); err != nil {
		return r, err
	}
	if err = json.Unmarshal(checks, &stored.CriticLookups); err != nil {
		return r, err
	}
	stored.Tokens = r.Usage.InputTokens + r.Usage.OutputTokens
	if stored.Result != nil {
		stored.Result.Usage = r.Usage
		stored.ApprovalBlock = orchestration.ApprovalReason(*stored.Result)
		stored.InstructionBlock = orchestration.InstructionReason(*stored.Result)
	}
	if current, e := planningRunCurrent(ctx, q, stored.Planning); e != nil {
		return stored, e
	} else if !current && stored.Status != "committed" {
		stored.ApprovalBlock = "本段采用版本或创作设定已更新，请核对当前稿后复检"
		stored.InstructionBlock = stored.ApprovalBlock
		stored.CanResume = false
		if stored.Status != "running" && stored.Status != "committed" {
			stored.Status = "stale"
		}
	}

	stored.NeighborsChanged = false
	if stored.Planning != nil {
		current, e := neighborsCurrent(ctx, q, stored.Planning)
		if e != nil {
			return stored, e
		}
		stored.NeighborsChanged = !current
	}
	stored.CanDismiss, err = canDismissCandidate(ctx, q, stored)
	if err != nil {
		return stored, err
	}
	if stored.Dismissed {
		stored.Status = "stale"
		stored.CanResume = false
		stored.ApprovalBlock = "此候选已放弃，当前继续使用已采用稿"
		stored.InstructionBlock = stored.ApprovalBlock
	}
	stored.ActionBlocks = app.HumanActionBlocks(stored)
	return stored, nil
}

// appendEvent 必须在业务事务内调用。run 行锁序列化并行 Critic 的事件：
// 不会出现序号 12 已提交可见，序号 11 仍未提交而被重放游标跳过的情况。
func appendEvent(ctx context.Context, tx pgx.Tx, id, kind string) error {
	if _, err := tx.Exec(ctx, "UPDATE runs SET event_sequence=event_sequence+1 WHERE id=$1", id); err != nil {
		return err
	}
	r, err := snapshot(ctx, tx, id)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO run_events(run_id,sequence,type,payload) VALUES($1,$2,$3,$4)", id, r.EventSequence, kind, raw); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "INSERT INTO run_outbox(run_id,sequence) VALUES($1,$2)", id, r.EventSequence)
	return err
}
func stateEvent(r app.Run) string {
	switch r.Status {
	case "stale":
		return "version.stale"
	case "failed", "interrupted":
		return "run.failed"
	case "approved", "completed", "committed":
		return "run.finished"
	case "waiting_human":
		return "gate.waiting"
	}
	if r.Result != nil && r.Result.NodePhase != "" {
		return "node." + r.Result.NodePhase
	}
	return "run.updated"
}

func (s *Store) Events(ctx context.Context, id string, after int64) (app.EventPage, error) {
	page := app.EventPage{Events: []app.RunEvent{}}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return page, err
	}
	defer tx.Rollback(context.Background())
	var floor int64
	err = tx.QueryRow(ctx, "SELECT event_floor,event_sequence FROM runs WHERE id=$1", id).Scan(&floor, &page.Head)
	if errors.Is(err, pgx.ErrNoRows) {
		return page, app.ErrNotFound
	}
	if err != nil {
		return page, err
	}
	if after < floor {
		return page, app.ErrCursorExpired
	}
	if after < 0 || after > page.Head {
		return page, app.ErrInvalidCursor
	}
	rows, err := tx.Query(ctx, "SELECT sequence,type,created_at,payload FROM run_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 100", id, after)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		e := app.RunEvent{RunID: id}
		var raw []byte
		if err = rows.Scan(&e.Sequence, &e.Type, &e.CreatedAt, &raw); err != nil {
			return page, err
		}
		if err = json.Unmarshal(raw, &e.Run); err != nil {
			return page, err
		}
		page.Events = append(page.Events, e)
	}
	return page, rows.Err()
}
func (s *Store) PendingEvents(ctx context.Context) ([]app.OutboxEntry, error) {
	rows, err := s.pool.Query(ctx, "SELECT id,run_id FROM run_outbox ORDER BY id LIMIT 100")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.OutboxEntry{}
	for rows.Next() {
		var e app.OutboxEntry
		if err = rows.Scan(&e.ID, &e.RunID); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
func (s *Store) DeliverEvent(ctx context.Context, id int64) error {
	// 仅移除投递任务，历史仍在 run_events；重启时剩下的任务继续投递。
	_, err := s.pool.Exec(ctx, "DELETE FROM run_outbox WHERE id=$1", id)
	return err
}

// PruneEvents 是显式维护入口，默认保留全部历史。只能裁去已投递的连续前缀。
// floor 与删除同事务；过期客户端必须重取快照，不能静默跳到最新。
func (s *Store) PruneEvents(ctx context.Context, id string, through int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var floor, head int64
	if err = tx.QueryRow(ctx, "SELECT event_floor,event_sequence FROM runs WHERE id=$1 FOR UPDATE", id).Scan(&floor, &head); err != nil {
		return err
	}
	if through < floor || through > head {
		return app.ErrInvalidCursor
	}
	var pending bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM run_outbox WHERE run_id=$1 AND sequence<=$2)", id, through).Scan(&pending); err != nil {
		return err
	}
	if pending {
		return app.ErrRunBusy
	}
	if _, err = tx.Exec(ctx, "DELETE FROM run_events WHERE run_id=$1 AND sequence<=$2", id, through); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE runs SET event_floor=$2 WHERE id=$1", id, through); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
