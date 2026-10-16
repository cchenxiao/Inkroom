package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/planning"
)

func (s *Store) PreviewChapterAssembly(ctx context.Context, scope string, req app.AssemblyPreviewRequest) (app.AssemblyPreview, error) {
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return app.AssemblyPreview{}, err
	}
	defer tx.Rollback(context.Background())
	return assemblyPreview(ctx, tx, scope, req)
}

// 调用者已锁规划头，和规划写入/启动/审批共享锁顺序。保存时在同一事务重新装配。
func assemblyPreview(ctx context.Context, tx pgx.Tx, scope string, req app.AssemblyPreviewRequest) (app.AssemblyPreview, error) {
	out := app.AssemblyPreview{Slots: []app.AssemblySlot{}, History: []app.ChapterAssembly{}, Reason: "请先确认本章细纲"}
	if strings.TrimSpace(req.ChapterID) == "" || len(req.ChapterID) > 80 || len(req.Choices) > 64 {
		return out, app.ErrInvalidWrite
	}
	rows, err := tx.Query(ctx, "SELECT record FROM chapter_assemblies WHERE scope=$1 AND chapter_id=$2 ORDER BY version DESC LIMIT 20", scope, req.ChapterID)
	if err != nil {
		return out, err
	}
	out.History, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (app.ChapterAssembly, error) {
		var a app.ChapterAssembly
		var raw []byte
		e := row.Scan(&raw)
		if e == nil {
			e = json.Unmarshal(raw, &a)
		}
		return a, e
	})
	if err != nil {
		return out, err
	}
	if len(out.History) > 0 {
		out.ExpectedVersion = out.History[0].Version
	}
	var raw []byte
	var p planning.ChapterPlanSelection
	err = tx.QueryRow(ctx, "SELECT record FROM planning_chapter_plan_selections WHERE scope=$1 AND chapter_id=$2 ORDER BY version DESC LIMIT 1", scope, req.ChapterID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if err = json.Unmarshal(raw, &p); err != nil {
		return out, err
	}
	if !p.Confirmed {
		return out, nil
	}
	current, err := planningRunCurrent(ctx, tx, &app.PlannedRunSource{Scope: scope, ChapterID: p.ChapterID, PlanVersion: p.Version, Expected: p.Versions})
	if err != nil {
		return out, err
	}
	if !current {
		out.Reason = "细纲来源已变化，请重新确认"
		return out, nil
	}
	if _, err = currentChapterPlanInput(ctx, tx, scope, p.Versions, p.ChapterID, "组装已审核段落"); err != nil {
		return out, err
	}
	knowledge, err := planningKnowledgeHead(ctx, tx, scope)
	if err != nil {
		return out, err
	}
	if !publishedForPlan(knowledge, p) {
		out.Reason = "请先发布当前已确认设定"
		return out, nil
	}
	ch, _ := p.Input.Chapter()
	k := &memory.KnowledgeRef{Version: knowledge.Snapshot.Version, Digest: knowledge.Digest}
	out.Draft = app.ChapterAssembly{Scope: scope, ChapterID: p.ChapterID, Title: ch.Title, Version: out.ExpectedVersion + 1, Status: "awaiting_chapter_review", Expected: p.Versions, PlanVersion: p.Version, Knowledge: k, Parts: []app.AssemblyPart{}}
	validBeats := map[string]bool{}
	out.Ready = true
	out.Reason = ""
	for _, scene := range p.Content.Scenes {
		for _, beat := range scene.Beats {
			validBeats[beat.ID] = true
			slot, err := assemblySlot(ctx, tx, scope, p, scene, beat, k, req.Choices)
			if err != nil {
				return out, err
			}
			out.Slots = append(out.Slots, slot)
			if slot.Reason != "" {
				out.Ready = false
				out.Reason = "有缺失或过期的段落，请先完成各 Beat 的审核提交"
			} else {
				out.Draft.Parts = append(out.Draft.Parts, slot.Part)
			}
		}
	}
	for beat := range req.Choices {
		if !validBeats[beat] {
			return out, app.ErrInvalidWrite
		}
	}
	if out.Ready {
		out.PreviewDigest, err = manuscript.ContentDigest(out.Draft)
	}
	return out, err
}

func assemblySlot(ctx context.Context, tx pgx.Tx, scope string, p planning.ChapterPlanSelection, scene planning.PlannedScene, beat planning.PlannedBeat, k *memory.KnowledgeRef, choices map[string]string) (app.AssemblySlot, error) {
	slot := app.AssemblySlot{Part: app.AssemblyPart{SceneID: scene.ID, SceneTitle: scene.Title, BeatID: beat.ID, BeatTitle: beat.Title, Segments: []manuscript.Segment{}}, Choices: []app.AssemblyChoice{}, Reason: "尚无本 Beat 的审核提交"}
	draftID := app.PlannedDraftID(scope, p.ChapterID, beat.ID)
	var version int
	err := tx.QueryRow(ctx, "SELECT draft_version FROM chapters WHERE id=$1 AND branch_id='main' FOR SHARE", draftID).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return slot, nil
	}
	if err != nil {
		return slot, err
	}
	var running bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM runs WHERE chapter_id=$1 AND branch_id='main' AND status='running')", draftID).Scan(&running); err != nil {
		return slot, err
	}
	rows, err := tx.Query(ctx, `SELECT c.payload,r.payload FROM manuscript_commits c JOIN runs r ON r.id=c.run_id JOIN planning_run_inputs b ON b.run_id=r.id WHERE b.scope=$1 AND b.chapter_id=$2 AND c.chapter_id=$3 AND c.branch_id='main' ORDER BY c.created_at DESC,c.id DESC`, scope, p.ChapterID, draftID)
	if err != nil {
		return slot, err
	}
	type source struct {
		commit app.FinalCommit
		run    app.Run
	}
	sources, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (source, error) {
		var x source
		var c, r []byte
		e := row.Scan(&c, &r)
		if e == nil {
			e = json.Unmarshal(c, &x.commit)
		}
		if e == nil {
			e = json.Unmarshal(r, &x.run)
		}
		return x, e
	})
	if err != nil {
		return slot, err
	}
	chosen, explicit := choices[beat.ID]
	for _, x := range sources {
		reason := ""
		source := x.run.Planning
		if source == nil || source.Scope != scope || source.ChapterID != p.ChapterID || source.BeatID != beat.ID || source.PlanVersion != p.Version || source.Expected != p.Versions || !reflect.DeepEqual(source.Knowledge, k) {
			reason = "规划或知识版本已变化"
		} else if running {
			reason = "本 Beat 正在生成新稿"
		} else if x.commit.DraftVersion != version {
			reason = "正文已有更新，需重新审核提交"
		}
		option := app.AssemblyChoice{CommitID: x.commit.ID, DraftVersion: x.commit.DraftVersion, CreatedAt: x.commit.CreatedAt, Eligible: reason == "", Reason: reason}
		slot.Choices = append(slot.Choices, option)
		if (!explicit && slot.Part.CommitID == "" && option.Eligible) || (explicit && chosen == x.commit.ID) {
			if reason != "" {
				slot.Reason = reason
				continue
			}
			slot.Part.CommitID = x.commit.ID
			slot.Part.DraftVersion = x.commit.DraftVersion
			slot.Part.Segments = x.commit.Segments
			slot.Reason = ""
		}
	}
	if running {
		slot.Reason = "本 Beat 正在生成新稿"
	} else if slot.Part.CommitID == "" && len(sources) > 0 {
		slot.Reason = "所选提交不存在或已过期，请先审核当前稿本"
	}
	return slot, nil
}

func (s *Store) SaveChapterAssembly(ctx context.Context, scope string, req app.AssemblySaveRequest) (app.ChapterAssembly, error) {
	var empty app.ChapterAssembly
	if !req.Confirm || strings.TrimSpace(req.RequestID) == "" || len(req.RequestID) > 80 || len(req.PreviewDigest) != 64 || req.ExpectedVersion < 0 {
		return empty, app.ErrInvalidWrite
	}
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(context.Background())
	var oldRequest, raw []byte
	var oldScope string
	err = tx.QueryRow(ctx, "SELECT scope,request,record FROM chapter_assemblies WHERE id=$1", req.RequestID).Scan(&oldScope, &oldRequest, &raw)
	if err == nil {
		var old app.AssemblySaveRequest
		if err = json.Unmarshal(oldRequest, &old); err != nil {
			return empty, err
		}
		if oldScope != scope || !reflect.DeepEqual(old, req) {
			return empty, app.ErrActionMismatch
		}
		err = json.Unmarshal(raw, &empty)
		return empty, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return empty, err
	}
	preview, err := assemblyPreview(ctx, tx, scope, app.AssemblyPreviewRequest{ChapterID: req.ChapterID, Choices: req.Choices})
	if err != nil {
		return empty, err
	}
	if !preview.Ready || preview.ExpectedVersion != req.ExpectedVersion || preview.PreviewDigest != req.PreviewDigest {
		return empty, app.ErrVersionMismatch
	}
	if len(req.Choices) != len(preview.Draft.Parts) {
		return empty, app.ErrInvalidWrite
	}
	for _, part := range preview.Draft.Parts {
		if req.Choices[part.BeatID] != part.CommitID {
			return empty, app.ErrInvalidWrite
		}
	}
	saved := preview.Draft
	saved.ID = req.RequestID
	saved.Digest = preview.PreviewDigest
	saved.CreatedAt = time.Now().UTC()
	raw, err = json.Marshal(saved)
	if err != nil {
		return empty, err
	}
	request, err := json.Marshal(req)
	if err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO chapter_assemblies VALUES($1,$2,$3,$4,$5,$6)", saved.ID, scope, saved.ChapterID, saved.Version, request, raw); err != nil {
		return empty, err
	}
	for _, part := range saved.Parts {
		if _, err = tx.Exec(ctx, "INSERT INTO chapter_assembly_sources VALUES($1,$2,$3)", saved.ID, part.BeatID, part.CommitID); err != nil {
			return empty, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, err
	}
	return saved, nil
}
