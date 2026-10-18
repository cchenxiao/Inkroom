package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/planning"
	"reflect"
	"strings"
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
	// Explicit per-request opt-in takes precedence over server experiment defaults.
	cfg.ExperimentalContinuity = req.EnhancedContinuity
	target := req.BeatID
	if req.Mode == "chapter" {
		target = p.Content.Brief.SelectedBeatID
	}
	history, err := chapterHistory(ctx, tx, scope, p)
	if err != nil {
		return r, false, err
	}
	frozen, err := app.PreparePlannedContextWithHistory(cfg, scope, req.RequestID, req.DraftVersion, p, history, target)
	if err != nil {
		return r, false, fmt.Errorf("%w: %v", app.ErrPlanningNotReady, err)
	}
	current, err := planningKnowledgeHead(ctx, tx, scope)
	if err != nil {
		return r, false, err
	}
	if !publishedForPlan(current, p) {
		return r, false, fmt.Errorf("%w: 请先在知识快照页发布当前已确认设定", app.ErrPlanningNotReady)
	}
	frozen, err = app.FreezePublishedKnowledge(frozen, current.Snapshot)
	if err != nil {
		return r, false, fmt.Errorf("%w: %v", app.ErrPlanningNotReady, err)
	}
	if req.Mode == "chapter" {
		frozen, err = app.PrepareChapterWriting(cfg, scope, req.RequestID, req.DraftVersion, p, current.Snapshot, history...)
		if err == nil && !req.Recheck {
			// Each batch has its own draft head. A later partial batch must never
			// erase segments belonging to a previous batch or an adopted version.
			if req.DraftVersion != 0 {
				return r, false, app.ErrVersionMismatch
			}
			frozen.Bundle.ChapterID = app.PlannedDraftID(scope, p.ChapterID, "batch/"+req.RequestID)
			targets := []manuscript.ContextBundle{}
			preserved := []manuscript.Passage{}
			for _, t := range frozen.Bundle.Targets {
				adopted, e := adoptedPassage(ctx, tx, scope, p.ChapterID, t.Beat.ID)
				if e != nil {
					return r, false, e
				}
				working, e := workingPassage(ctx, tx, scope, p.ChapterID, t.Beat.ID)
				if e != nil {
					return r, false, e
				}
				if len(adopted.Segments) > 0 || (req.Remaining && len(working.Segments) > 0) {
					working.Title = t.Beat.Title
					if len(adopted.Segments) > 0 {
						working = adopted
						working.Title = t.Beat.Title
					}
					preserved = append(preserved, working)
				} else {
					targets = append(targets, t)
				}
			}
			if len(targets) == 0 {
				return r, false, fmt.Errorf("%w: 没有需要生成的段落，已有正文已保留，请继续审核或定稿", app.ErrPlanningNotReady)
			}
			setBatchTargets(&frozen.Bundle, targets, preserved, p)
		}
	} else {
		frozen.Bundle.Neighbors, err = freezeNeighbors(ctx, tx, scope, p, frozen.Bundle.Beat.ID)
	}
	if err == nil && req.FromRunID != "" {
		var raw []byte
		err = tx.QueryRow(ctx, "SELECT payload FROM runs WHERE id=$1", req.FromRunID).Scan(&raw)
		var origin app.Run
		if err == nil {
			err = json.Unmarshal(raw, &origin)
		}
		if err == nil && (origin.Planning == nil || origin.Planning.Scope != scope || origin.Planning.ChapterID != p.ChapterID || origin.Result == nil || origin.Dismissed || origin.DraftVersion != req.SourceVersion || origin.Status == "running") {
			err = app.ErrVersionMismatch
		}
		if err == nil && req.Mode == "chapter" {
			if len(origin.Planning.TargetBeatIDs) > 0 {
				wanted := map[string]bool{}
				for _, id := range origin.Planning.TargetBeatIDs {
					wanted[id] = true
				}
				targets := []manuscript.ContextBundle{}
				for _, t := range frozen.Bundle.Targets {
					if wanted[t.Beat.ID] {
						targets = append(targets, t)
					}
				}
				frozen.Bundle.Targets = targets
				frozen.Bundle.ChapterID = origin.ChapterID
				// Refresh the preserved context while retaining this batch's exact output scope.
				for _, prior := range origin.Planning.Neighbors {
					neighbor, e := workingPassage(ctx, tx, scope, p.ChapterID, prior.BeatID)
					if e != nil {
						return r, false, e
					}
					neighbor.Title = prior.Title
					frozen.Bundle.Neighbors = append(frozen.Bundle.Neighbors, neighbor)
				}
				setBatchTargets(&frozen.Bundle, frozen.Bundle.Targets, frozen.Bundle.Neighbors, p)
			}
			err = app.ValidateChapterRecheck(frozen.Bundle, origin)
			if req.SourceVersion != req.DraftVersion {
				err = app.ErrVersionMismatch
			}
		}
		if err == nil {
			for _, s := range origin.Result.Segments {
				if req.Mode == "chapter" || s.BeatID == frozen.Bundle.Beat.ID {
					s.ChapterID = frozen.Bundle.ChapterID
					frozen.Bundle.Original = append(frozen.Bundle.Original, s)
				}
			}
			if len(frozen.Bundle.Original) == 0 {
				err = app.ErrVersionMismatch
			}
			if req.Rewrite != nil {
				if e := req.Rewrite.Validate(frozen.Bundle.Original); e != nil {
					err = app.ActionValidationError{Reason: e.Error()}
				}
			}
			if len(req.Edits) > 0 {
				if _, e := manuscript.ApplyManualEdits(frozen.Bundle.Original, req.Edits); e != nil {
					return r, false, app.ActionValidationError{Reason: e.Error()}
				}
				frozen.Bundle.ManualEdits = req.Edits
				frozen.Bundle.ManualSourceVersion = req.SourceVersion
			}
			frozen.Bundle.Rewrite = req.Rewrite
			if req.Recheck {
				previous := origin.Result.RewriteRequest()
				for _, segment := range frozen.Bundle.Original {
					if previous != nil && previous.SegmentID == segment.ID {
						frozen.Bundle.RevisionRequest = previous
					}
				}
			}
		}
	}
	if err == nil {
		frozen, err = app.ReassemblePlanned(frozen)
		if err != nil {
			err = fmt.Errorf("%w: 正文与前后文超过材料限制或无法校验，请调整上下文预算后重试：%v", app.ErrPlanningNotReady, err)
		}
	}
	if err != nil {
		return r, false, err
	}
	source := &app.PlannedRunSource{Publications: frozen.Bundle.WritingTask.Publications, EnhancedContinuity: req.EnhancedContinuity, NeighborPolicy: "working-v1", Mode: req.Mode, Neighbors: frozen.Bundle.Neighbors, Knowledge: frozen.Bundle.WritingTask.Knowledge, Scope: scope, ChapterID: p.ChapterID, BeatID: frozen.Bundle.Beat.ID, Expected: versions, PlanVersion: p.Version}
	source.FromRunID, source.SourceVersion = req.FromRunID, req.SourceVersion
	source.ManualEdits = req.Edits
	source.Remaining = req.Remaining
	if req.Mode == "chapter" {
		for _, t := range frozen.Bundle.Targets {
			source.TargetBeatIDs = append(source.TargetBeatIDs, t.Beat.ID)
		}
	}
	baselineTargets := []string{frozen.Bundle.Beat.ID}
	if req.Mode == "chapter" {
		baselineTargets = nil
		for _, t := range frozen.Bundle.Targets {
			baselineTargets = append(baselineTargets, t.Beat.ID)
		}
	}
	for _, beat := range baselineTargets {
		prior, e := adoptedPassage(ctx, tx, scope, p.ChapterID, beat)
		if e != nil {
			return r, false, e
		}
		prior.BeatID = beat
		// Concurrency guard needs identity and digest, not a second copy of prose.
		prior.Segments = nil
		source.Baseline = append(source.Baseline, prior)
	}
	if req.Mode == "chapter" {
		source.BeatID = app.ChapterBeatID
	}
	if req.Mode == "chapter" {
		cfg = cfg.ChapterLimits()
	}
	r = app.Run{Planning: source, ID: req.RequestID, ChapterID: frozen.Bundle.ChapterID, BranchID: "main", BaseDraftVersion: req.DraftVersion, DraftVersion: req.DraftVersion, Status: "running", CurrentNode: "context_assemble", Scenario: "normal", InputDigest: frozen.Manifest.Digest, AutoRevise: req.AutoRevise, MaxRounds: 2, MaxCalls: cfg.MaxCalls, MaxTokens: cfg.MaxTokens, Provider: cfg.Model, Model: cfg.ModelName, Nodes: []any{}, ActiveRoles: []string{}}
	if err = createRunTx(ctx, tx, r, &frozen, &frozen); err != nil {
		return r, false, err
	}
	raw, err = json.Marshal(app.PlannedRunBinding{Scope: scope, Request: req, Selection: p})
	if err != nil {
		return r, false, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO planning_run_inputs VALUES($1,$2,$3,$4)", r.ID, scope, p.ChapterID, raw); err != nil {
		return r, false, err
	}
	if err = appendEvent(ctx, tx, r.ID, "context.preparing"); err != nil {
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
	if p.Knowledge != nil {
		project, branch, _ := strings.Cut(p.Scope, "/")
		var version int
		var digest string
		err = q.QueryRow(ctx, "SELECT version,digest FROM knowledge_heads WHERE project_id=$1 AND branch_id=$2", project, branch).Scan(&version, &digest)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if version != p.Knowledge.Version || digest != p.Knowledge.Digest {
			return false, nil
		}
	}
	for _, pub := range p.Publications {
		var id string
		err = q.QueryRow(ctx, "SELECT id FROM chapter_publications WHERE scope=$1 AND chapter_id=$2 ORDER BY version DESC LIMIT 1", p.Scope, pub.ChapterID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if id != pub.ID {
			return false, nil
		}
	}
	baselineOK, err := baselineCurrent(ctx, q, p)
	if err != nil {
		return false, err
	}
	return baselineOK && confirmed && pv == p.PlanVersion && p.Expected == (planning.ChapterPlanVersions{Planning: planning.PlanningVersions{Input: iv, Direction: dv, Style: sv, Core: cv}, Outline: ov, Bindings: bv}), nil
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
	if err := tx.QueryRow(ctx, "SELECT scope FROM planning_heads WHERE scope=$1 FOR UPDATE", r.Planning.Scope).Scan(&scope); err != nil {
		return err
	}
	if r.Planning.Knowledge != nil {
		if _, err := planningKnowledgeHead(ctx, tx, r.Planning.Scope); err != nil {
			return err
		}
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
func (s *Store) PlannedRunReadiness(ctx context.Context, scope, chapter string, cfg config.Config, target ...string) (app.PlannedRunReadiness, error) {
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
		out.BeatID = p.Content.Brief.SelectedBeatID
		if len(target) > 0 && target[0] != "" {
			out.BeatID = target[0]
		}
		if len(target) > 1 && target[1] == "chapter" {
			out.BeatID = app.ChapterBeatID
		}
		out.DraftID = app.PlannedDraftID(scope, chapter, out.BeatID)
		draft, e := s.Draft(ctx, out.DraftID, "main", 0)
		if e != nil {
			return out, e
		}
		out.DraftVersion = draft.DraftVersion
		if out.BeatID == app.ChapterBeatID {
			out.DraftVersion = 0
		}
		out.MissingBeatIDs, out.UnadoptedBeatIDs = []string{}, []string{}
		for _, scene := range p.Content.Scenes {
			for _, beat := range scene.Beats {
				working, e := workingPassage(ctx, s.pool, scope, chapter, beat.ID)
				if e != nil {
					return out, e
				}
				adopted, e := adoptedPassage(ctx, s.pool, scope, chapter, beat.ID)
				if e != nil {
					return out, e
				}
				if len(working.Segments) == 0 {
					out.MissingBeatIDs = append(out.MissingBeatIDs, beat.ID)
				}
				if len(adopted.Segments) == 0 {
					out.UnadoptedBeatIDs = append(out.UnadoptedBeatIDs, beat.ID)
				}
			}
		}
		current := state.OutlineSelection != nil && state.OutlineSelection.Confirmed && p.Versions == (planning.ChapterPlanVersions{Planning: planning.PlanningVersions{Input: state.Input.Version, Direction: state.DirectionVersion, Style: state.StyleVersion, Core: state.CoreVersion}, Outline: state.OutlineVersion, Bindings: state.OutlineSelection.BindingsVersion})
		if !current {
			out.Reason = "规划输入已变化，请先复核细纲"
		} else {
			previewBeat := out.BeatID
			if previewBeat == app.ChapterBeatID {
				previewBeat = p.Content.Brief.SelectedBeatID
			}
			history, historyErr := chapterHistory(ctx, s.pool, scope, *p)
			e = historyErr
			if e == nil {
				_, e = app.PreparePlannedContextWithHistory(cfg, scope, "preview", out.DraftVersion, *p, history, previewBeat)
			}
			if e != nil {
				out.Reason = e.Error()
			} else {
				project, branch, _ := strings.Cut(scope, "/")
				current, readErr := s.GetKnowledge(ctx, project, branch, 0)
				if readErr != nil && !errors.Is(readErr, app.ErrNotFound) {
					return out, readErr
				}
				if !publishedForPlan(current, *p) {
					out.Reason = "请先在知识快照页发布当前已确认设定"
				} else {
					prepared, prepErr := app.PreparePlannedContextWithHistory(cfg, scope, "preview", out.DraftVersion, *p, history, previewBeat)
					if prepErr == nil {
						_, prepErr = app.FreezePublishedKnowledge(prepared, current.Snapshot)
					}
					if prepErr == nil && out.BeatID == app.ChapterBeatID {
						_, prepErr = app.PrepareChapterWriting(cfg, scope, "preview", out.DraftVersion, *p, current.Snapshot, history...)
					}
					if prepErr != nil {
						out.Reason = prepErr.Error()
					} else {
						out.Ready = true
						out.Reason = ""
					}
				}
			}
		}
	}
	if out.BeatID != "" && out.BeatID != app.ChapterBeatID {
		working, e := workingPassage(ctx, s.pool, scope, chapter, out.BeatID)
		if e != nil {
			return out, e
		}
		if working.Version > 0 {
			adopted, err := adoptedPassage(ctx, s.pool, scope, chapter, out.BeatID)
			if err != nil {
				return out, err
			}
			if adopted.Version > 0 {
				out.Adopted = &app.AdoptedPassageStatus{Version: adopted.Version, MatchesWorking: sameNarrative(adopted, working)}
				if out.Adopted.MatchesWorking {
					working.State = "adopted"
				}
			}
			out.Working = &working
		}
	}
	rows, err := s.pool.Query(ctx, "SELECT r.id FROM runs r JOIN planning_run_inputs p ON p.run_id=r.id WHERE p.scope=$1 AND p.chapter_id=$2 AND (r.payload->'planning'->>'beatId'=$3 OR (r.payload->'planning'->>'mode'='chapter' AND (NOT (r.payload->'planning' ? 'targetBeatIds') OR r.payload->'planning'->'targetBeatIds' ? $3))) ORDER BY r.created_at DESC,r.id DESC LIMIT 10", scope, chapter, out.BeatID)
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

// Each target sees preserved prose in its actual before/after position.
func setBatchTargets(b *manuscript.ContextBundle, targets []manuscript.ContextBundle, preserved []manuscript.Passage, p planning.ChapterPlanSelection) {
	order := map[string]int{}
	for _, scene := range p.Content.Scenes {
		for _, beat := range scene.Beats {
			order[beat.ID] = len(order)
		}
	}
	keptWords := 0
	for _, passage := range preserved {
		for _, segment := range passage.Segments {
			keptWords += manuscript.TextLength(segment.Text)
		}
	}
	for i := range targets {
		if targets[i].WritingTask != nil {
			task := *targets[i].WritingTask
			task.PreservedWords = keptWords
			remaining := max(0, task.ChapterTargetWords-keptWords)
			if remaining > 0 {
				task.BeatTargetWords = remaining / len(targets)
				if i < remaining%len(targets) {
					task.BeatTargetWords++
				}
			}
			targets[i].WritingTask = &task
		}
		targets[i].Neighbors = append([]manuscript.Passage{}, preserved...)
		for j := range targets[i].Neighbors {
			n := &targets[i].Neighbors[j]
			n.Position = "before"
			if order[n.BeatID] > order[targets[i].Beat.ID] {
				n.Position = "after"
			}
		}
	}
	if len(targets) == 0 {
		return
	}
	draftID, original := b.ChapterID, b.Original
	*b = targets[0]
	b.ChapterID, b.Original, b.Targets = draftID, original, targets
	b.CompactTargets = true
}
