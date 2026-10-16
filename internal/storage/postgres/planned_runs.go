package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"reflect"
)

func (s *Store) StartPlannedRun(ctx context.Context, scope string, req app.PlannedRunRequest, cfg config.Config) (app.Run, bool, error) {
	var r app.Run
	if !app.ValidPlannedRequest(req) {
		return r, false, app.ErrInvalidWrite
	}
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return r, false, err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_run_inputs WHERE run_id=$1 AND scope=$2", req.RequestID, scope).Scan(&raw)
	if err == nil {
		var old app.PlannedRunBinding
		if err = json.Unmarshal(raw, &old); err != nil {
			return r, false, err
		}
		if !reflect.DeepEqual(old.Request, req) {
			return r, false, app.ErrActionMismatch
		}
		r, err = snapshot(ctx, tx, req.RequestID)
		return r, false, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return r, false, err
	}
	versions, err := chapterPlanHeads(ctx, tx, scope, iv, dv)
	if err != nil {
		return r, false, err
	}
	if versions != req.Expected {
		return r, false, app.ErrVersionMismatch
	}
	var p planning.ChapterPlanSelection
	err = tx.QueryRow(ctx, "SELECT record FROM planning_chapter_plan_selections WHERE scope=$1 AND chapter_id=$2 ORDER BY version DESC LIMIT 1", scope, req.ChapterID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, false, app.ErrNotFound
	}
	if err != nil {
		return r, false, err
	}
	if err = json.Unmarshal(raw, &p); err != nil {
		return r, false, err
	}
	if p.Version != req.PlanVersion || p.Versions != versions {
		return r, false, app.ErrVersionMismatch
	}
	// 再校验当前章纲的确认状态及整条上游链，不能仅信客户端或旧选择。
	if _, err = currentChapterPlanInput(ctx, tx, scope, versions, req.ChapterID, "冻结当前 Beat 写作材料"); err != nil {
		return r, false, err
	}
	frozen, err := app.PreparePlannedContext(cfg, scope, req.RequestID, req.DraftVersion, p)
	if err != nil {
		return r, false, fmt.Errorf("%w: %v", app.ErrPlanningNotReady, err)
	}
	source := &app.PlannedRunSource{Scope: scope, ChapterID: p.ChapterID, BeatID: frozen.Bundle.Beat.ID, Expected: versions, PlanVersion: p.Version}
	r = app.Run{Planning: source, ID: req.RequestID, ChapterID: frozen.Bundle.ChapterID, BranchID: "main", BaseDraftVersion: req.DraftVersion, DraftVersion: req.DraftVersion, Status: "running", CurrentNode: "draft", Scenario: "normal", InputDigest: frozen.Manifest.Digest, AutoRevise: req.AutoRevise, MaxRounds: 2, MaxCalls: cfg.MaxCalls, MaxTokens: cfg.MaxTokens, Provider: cfg.Model, Model: cfg.ModelName, Nodes: []any{}, ActiveRoles: []string{}}
	if err = createRunTx(ctx, tx, r, &frozen, nil); err != nil {
		return r, false, err
	}
	raw, err = json.Marshal(app.PlannedRunBinding{Scope: scope, Request: req, Selection: p})
	if err != nil {
		return r, false, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO planning_run_inputs VALUES($1,$2,$3,$4)", r.ID, scope, p.ChapterID, raw); err != nil {
		return r, false, err
	}
	if err = appendEvent(ctx, tx, r.ID, "context.ready"); err != nil {
		return r, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return r, false, err
	}
	r, err = s.GetRun(ctx, r.ID)
	return r, true, err
}

// planningRunCurrent 可在快照中只读；批准/提交时在锁内再次检查。
func planningRunCurrent(ctx context.Context, q queryRow, p *app.PlannedRunSource) (bool, error) {
	if p == nil {
		return true, nil
	}
	var iv, dv, sv, cv, ov, bv, pv int
	var confirmed bool
	err := q.QueryRow(ctx, `SELECT h.input_version,h.direction_version,h.style_version,h.core_version,h.outline_version,
 COALESCE((o.record->>'bindingsVersion')::int,0),COALESCE(c.version,0),COALESCE((c.record->>'confirmed')::boolean,false)
 FROM planning_heads h LEFT JOIN planning_outline_selections o ON o.scope=h.scope AND o.version=h.outline_version
 LEFT JOIN LATERAL(SELECT version,record FROM planning_chapter_plan_selections WHERE scope=h.scope AND chapter_id=$2 ORDER BY version DESC LIMIT 1)c ON true WHERE h.scope=$1`, p.Scope, p.ChapterID).Scan(&iv, &dv, &sv, &cv, &ov, &bv, &pv, &confirmed)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return confirmed && pv == p.PlanVersion && p.Expected == (planning.ChapterPlanVersions{Planning: planning.PlanningVersions{Input: iv, Direction: dv, Style: sv, Core: cv}, Outline: ov, Bindings: bv}), nil
}

// 锁顺序：规划头 → 候选章 → run，避免启动与审批形成锁环。
func lockPlanningRun(ctx context.Context, tx pgx.Tx, id string) error {
	var raw []byte
	if err := tx.QueryRow(ctx, "SELECT payload FROM runs WHERE id=$1", id).Scan(&raw); err != nil {
		return err
	}
	var r app.Run
	if err := json.Unmarshal(raw, &r); err != nil {
		return err
	}
	if r.Planning == nil {
		return nil
	}
	var scope string
	if err := tx.QueryRow(ctx, "SELECT scope FROM planning_heads WHERE scope=$1 FOR SHARE", r.Planning.Scope).Scan(&scope); err != nil {
		return err
	}
	ok, err := planningRunCurrent(ctx, tx, r.Planning)
	if err != nil {
		return err
	}
	if !ok {
		return app.ErrVersionMismatch
	}
	return nil
}
func (s *Store) PlannedRunReadiness(ctx context.Context, scope, chapter string, cfg config.Config) (app.PlannedRunReadiness, error) {
	out := app.PlannedRunReadiness{Reason: "请先确认当前章节的细纲与 Brief", Runs: []app.Run{}}
	state, err := s.GetPlanning(ctx, scope)
	if err != nil {
		return out, err
	}
	var p *planning.ChapterPlanSelection
	for i := range state.ChapterPlans {
		if state.ChapterPlans[i].ChapterID == chapter {
			p = &state.ChapterPlans[i]
		}
	}
	if p != nil {
		out.PlanVersion = p.Version
		out.Expected = p.Versions
		out.DraftID = app.PlannedDraftID(scope, chapter, p.Content.Brief.SelectedBeatID)
		draft, e := s.Draft(ctx, out.DraftID, "main", 0)
		if e != nil {
			return out, e
		}
		out.DraftVersion = draft.DraftVersion
		current := state.OutlineSelection != nil && state.OutlineSelection.Confirmed && p.Versions == (planning.ChapterPlanVersions{Planning: planning.PlanningVersions{Input: state.Input.Version, Direction: state.DirectionVersion, Style: state.StyleVersion, Core: state.CoreVersion}, Outline: state.OutlineVersion, Bindings: state.OutlineSelection.BindingsVersion})
		if !current {
			out.Reason = "规划输入已变化，请先复核细纲"
		} else {
			_, e = app.PreparePlannedContext(cfg, scope, "preview", out.DraftVersion, *p)
			if e != nil {
				out.Reason = e.Error()
			} else {
				out.Ready = true
				out.Reason = ""
			}
		}
	}
	rows, err := s.pool.Query(ctx, "SELECT r.id FROM runs r JOIN planning_run_inputs p ON p.run_id=r.id WHERE p.scope=$1 AND p.chapter_id=$2 ORDER BY r.created_at DESC,r.id DESC LIMIT 10", scope, chapter)
	if err != nil {
		return out, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return out, err
	}
	for _, id := range ids {
		r, e := s.GetRun(ctx, id)
		if e != nil {
			return out, e
		}
		out.Runs = append(out.Runs, r)
		if r.Status == "running" {
			out.Ready = false
			out.Reason = "本章候选仍在生成，请等待完成"
		}
	}
	return out, nil
}
