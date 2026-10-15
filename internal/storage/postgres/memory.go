package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/domain/memory"
	"inkloom/internal/retrieval"
)

var _ retrieval.Repository = (*Store)(nil)

type MemoryPublication struct {
	CommitID        string        `json:"commitId"`
	ExpectedVersion int           `json:"expectedVersion"`
	Record          memory.Record `json:"record"`
}

// PublishMemory 由作者提供知情元数据，正文只能来自真正的冻结提交，不接受改写/摘要当原文。
func (s *Store) PublishMemory(ctx context.Context, in MemoryPublication) error {
	c, err := s.GetCommit(ctx, in.CommitID)
	if err != nil {
		return err
	}
	r := in.Record
	if r.ProjectID != c.ProjectID || r.BranchID != c.BranchID || r.ChapterID != c.ChapterID || r.Kind != memory.Passage || r.Status != memory.Confirmed || r.Version != in.ExpectedVersion+1 {
		return app.ErrInvalidWrite
	}
	found := false
	for _, seg := range c.Segments {
		if seg.ID == r.SegmentID {
			if r.Text != "" && r.Text != seg.Text {
				return app.ErrInvalidWrite
			}
			r.Text = seg.Text
			found = true
			break
		}
	}
	if !found {
		return app.ErrInvalidWrite
	}
	r.ID = c.ID + "/" + r.SegmentID
	return s.putMemory(ctx, r, "commit", c.ID, in.ExpectedVersion)
}

// SeedMemory 仅供明确执行的教学命令使用；启动服务绝不自动导入这批记录。
func (s *Store) SeedMemory(ctx context.Context, records []memory.Record) error {
	for _, r := range records {
		if r.Status != memory.Confirmed {
			continue
		}
		if !strings.HasPrefix(r.ID, "seed-") {
			return app.ErrInvalidWrite
		}
		if err := s.putMemory(ctx, r, "teaching_seed", "", 0); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) putMemory(ctx context.Context, r memory.Record, origin, commit string, expected int) error {
	if r.At == nil || r.At.Chapter < 1 || r.At.StoryTime < 0 || r.ID == "" || r.ProjectID == "" || r.BranchID == "" || r.Version < 1 || r.ChapterID == "" || strings.TrimSpace(r.Text) == "" || len(r.Text) > 16000 || r.Status != memory.Confirmed {
		return app.ErrInvalidWrite
	}
	if r.Kind != memory.Plan && r.Kind != memory.Fact && r.Kind != memory.Passage {
		return app.ErrInvalidWrite
	}
	if r.Kind != memory.Plan && r.SegmentID == "" {
		return app.ErrInvalidWrite
	}
	for _, k := range r.KnownBy {
		if k.CharacterID == "" || k.Since == nil || k.Since.Chapter < 1 || k.Since.StoryTime < 0 {
			return app.ErrInvalidWrite
		}
	}
	digest := memory.Digest(r)
	raw, _ := json.Marshal(r)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	// 记录还不存在时也能串行化同一来源的并发发布，不让“最后写入者获胜”。
	_, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", r.ProjectID+"/"+r.BranchID+"/"+r.ID)
	if err != nil {
		return err
	}
	var current string
	var version int
	err = tx.QueryRow(ctx, `SELECT h.digest,r.version FROM memory_heads h JOIN memory_records r USING(digest) WHERE h.project_id=$1 AND h.branch_id=$2 AND h.id=$3 FOR UPDATE OF h`, r.ProjectID, r.BranchID, r.ID).Scan(&current, &version)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if current == digest {
		return nil
	}
	if version != expected || r.Version <= version {
		return app.ErrVersionMismatch
	}
	var source any
	if commit != "" {
		source = commit
	}
	_, err = tx.Exec(ctx, `INSERT INTO memory_records VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, digest, r.ProjectID, r.BranchID, r.ID, r.Version, raw, origin, source)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO memory_heads VALUES($1,$2,$3,$4) ON CONFLICT(project_id,branch_id,id) DO UPDATE SET digest=EXCLUDED.digest`, r.ProjectID, r.BranchID, r.ID, digest)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// MemorySnapshot 在一个 SQL 快照内读版本目录和内容。较新定稿存在时，不再召回旧定稿。
func (s *Store) MemorySnapshot(ctx context.Context, v memory.View) (retrieval.Snapshot, error) {
	out := retrieval.Snapshot{Records: []memory.Record{}, Pins: map[string]memory.Pin{}, Origins: map[string]retrieval.Origin{}}
	rows, err := s.pool.Query(ctx, `SELECT r.record,h.digest,r.version,r.origin,COALESCE(r.source_commit_id,'') FROM memory_heads h JOIN memory_records r USING(digest)
 WHERE h.project_id=$1 AND h.branch_id=$2 AND (r.source_commit_id IS NULL OR r.source_commit_id=(
 SELECT c.id FROM manuscript_commits c WHERE c.chapter_id=r.record->>'chapterId' AND c.branch_id=$2 AND c.payload->>'projectId'=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT 1)) ORDER BY h.id LIMIT 1025`, v.ProjectID, v.BranchID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		var digest, origin, commit string
		var version int
		if err = rows.Scan(&raw, &digest, &version, &origin, &commit); err != nil {
			return out, err
		}
		var r memory.Record
		if err = json.Unmarshal(raw, &r); err != nil {
			return out, err
		}
		if len(out.Records) >= 1024 {
			return out, fmt.Errorf("memory corpus exceeds learning-stage limit (1024); narrow scope before indexing")
		}
		out.Records = append(out.Records, r)
		out.Pins[r.ID] = memory.Pin{Version: version, Digest: digest}
		out.Origins[r.ID] = retrieval.Origin{Kind: origin, CommitID: commit}
	}
	return out, rows.Err()
}
