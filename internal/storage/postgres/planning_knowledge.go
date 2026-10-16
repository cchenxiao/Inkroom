package postgres

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/planning"
	"strings"
)

func planningKnowledgeHead(ctx context.Context, tx pgx.Tx, scope string) (StoredKnowledge, error) {
	project, branch, _ := strings.Cut(scope, "/")
	// Prevent an external publisher from replacing the head during run creation/approval.
	var version int
	err := tx.QueryRow(ctx, "SELECT version FROM knowledge_heads WHERE project_id=$1 AND branch_id=$2 FOR SHARE", project, branch).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return StoredKnowledge{}, nil
	}
	if err != nil {
		return StoredKnowledge{}, err
	}
	return readKnowledge(ctx, tx, project, branch, version)
}
func knowledgePublishBlock(ctx context.Context, tx pgx.Tx, scope string, current StoredKnowledge) (string, error) {
	if current.Snapshot.Version > 0 && current.Origin != "teaching_seed" && current.Snapshot.Planning == nil {
		return "已有正式知识，不能通过初始化入口覆盖；请走变更裁决", nil
	}
	var exists bool
	project, branch, _ := strings.Cut(scope, "/")
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM manuscript_commits WHERE payload->>'projectId'=$1 AND branch_id=$2)`, project, branch).Scan(&exists)
	if err != nil {
		return "", err
	}
	if exists {
		return "已有正文提交，设定变更需要影响分析；当前只支持开工前发布", nil
	}
	return "", nil
}
func (s *Store) PlanningKnowledgePreview(ctx context.Context, scope string) (app.KnowledgePreview, error) {
	out := app.KnowledgePreview{Excluded: []app.KnowledgeExclusion{}}
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(context.Background())
	versions, _, err := outlineHeads(ctx, tx, scope, iv, dv)
	if err != nil {
		return out, err
	}
	out.Expected = versions
	current, err := planningKnowledgeHead(ctx, tx, scope)
	if err != nil {
		return out, err
	}
	out.ExpectedVersion = current.Snapshot.Version
	out.CurrentVersion = current.Snapshot.Version
	out.ReplacesTeaching = current.Origin == "teaching_seed"
	in, err := currentOutlineInput(ctx, tx, scope, versions, "发布已确认初始设定", 2)
	if err != nil {
		if errors.Is(err, app.ErrVersionMismatch) || errors.Is(err, app.ErrInvalidWrite) || errors.Is(err, pgx.ErrNoRows) {
			out.Reason = "请先确认有效的方向、风格与核心设定"
			return out, nil
		}
		return out, err
	}
	snapshot, excluded, err := app.BuildPlanningKnowledge(scope, in, out.ExpectedVersion+1)
	out.Excluded = excluded
	if err != nil {
		out.Reason = err.Error()
		return out, nil
	}
	out.Snapshot = &snapshot
	out.PreviewDigest, err = manuscript.ContentDigest(snapshot)
	if err != nil {
		return out, err
	}
	publishedCandidate := snapshot
	publishedCandidate.Version = current.Snapshot.Version
	publishedDigest, _ := manuscript.ContentDigest(publishedCandidate)
	if current.Origin == "human" && current.Digest == publishedDigest {
		out.Current = true
		out.Reason = "当前设定已经发布"
		return out, nil
	}
	out.Reason, err = knowledgePublishBlock(ctx, tx, scope, current)
	out.Ready = out.Reason == "" && err == nil
	return out, err
}
func (s *Store) PublishPlanningKnowledge(ctx context.Context, scope string, req app.KnowledgePublishRequest) (StoredKnowledge, error) {
	if !req.Confirm || req.ExpectedVersion < 0 || len(req.PreviewDigest) != 64 || strings.TrimSpace(req.Reason) == "" || len(req.Reason) > 2000 {
		return StoredKnowledge{}, app.ErrInvalidWrite
	}
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return StoredKnowledge{}, err
	}
	defer tx.Rollback(context.Background())
	versions, _, err := outlineHeads(ctx, tx, scope, iv, dv)
	if err != nil {
		return StoredKnowledge{}, err
	}
	if versions != req.Expected {
		return StoredKnowledge{}, app.ErrVersionMismatch
	}
	in, err := currentOutlineInput(ctx, tx, scope, versions, "发布已确认初始设定", 2)
	if err != nil {
		return StoredKnowledge{}, err
	}
	snapshot, _, err := app.BuildPlanningKnowledge(scope, in, req.ExpectedVersion+1)
	if err != nil {
		return StoredKnowledge{}, fmt.Errorf("%w: %v", app.ErrPlanningNotReady, err)
	}
	digest, err := manuscript.ContentDigest(snapshot)
	if err != nil {
		return StoredKnowledge{}, err
	}
	if digest != req.PreviewDigest {
		return StoredKnowledge{}, app.ErrVersionMismatch
	}
	// Shared lock then exclusive upgrade would deadlock concurrent CLI publishers; take advisory first.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "knowledge/"+scope); err != nil {
		return StoredKnowledge{}, err
	}
	current, err := planningKnowledgeHead(ctx, tx, scope)
	if err != nil {
		return StoredKnowledge{}, err
	}
	if current.Digest == digest && current.Origin == "human" && current.Reason == req.Reason {
		return current, nil
	}
	if current.Snapshot.Version != req.ExpectedVersion {
		return StoredKnowledge{}, app.ErrVersionMismatch
	}
	reason, err := knowledgePublishBlock(ctx, tx, scope, current)
	if err != nil {
		return StoredKnowledge{}, err
	}
	if reason != "" {
		return StoredKnowledge{}, fmt.Errorf("%w: %s", app.ErrPlanningNotReady, reason)
	}
	saved, err := publishKnowledgeTx(ctx, tx, KnowledgePublication{ExpectedVersion: req.ExpectedVersion, ConfirmFacts: true, Reason: req.Reason, Snapshot: snapshot}, "human")
	if err != nil {
		return StoredKnowledge{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return StoredKnowledge{}, err
	}
	return saved, nil
}

func publishedForPlan(current StoredKnowledge, p planning.ChapterPlanSelection) bool {
	source := current.Snapshot.Planning
	if source == nil || current.Origin != "human" {
		return false
	}
	v := p.Versions.Planning
	digest, err := manuscript.ContentDigest(p.Input.Base.Core)
	if err != nil || source.Input != v.Input || source.Direction != v.Direction || source.Style != v.Style || source.Core != v.Core || source.CoreDigest != digest {
		return false
	}
	expected, _, err := app.BuildPlanningKnowledge(current.Snapshot.ProjectID+"/"+current.Snapshot.BranchID, p.Input.Base, current.Snapshot.Version)
	if err != nil {
		return false
	}
	expectedDigest, err := manuscript.ContentDigest(expected)
	return err == nil && expectedDigest == current.Digest
}
