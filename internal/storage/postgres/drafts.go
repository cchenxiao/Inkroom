package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

func (s *Store) Draft(ctx context.Context, chapter, branch string, version int) (app.Draft, error) {
	// 一条查询的快照同时读取 head、正文和本版报告，避免分开读取造成混版。
	var raw, report []byte
	d := app.Draft{ChapterID: chapter, BranchID: branch, Segments: []manuscript.Segment{}, Findings: []review.Finding{}}
	err := s.pool.QueryRow(ctx, `SELECT v.draft_version,v.segments,v.origin,v.created_at,
 (SELECT rev.report FROM reviews rev JOIN runs r ON r.id=rev.run_id
 WHERE r.chapter_id=v.chapter_id AND r.branch_id=v.branch_id AND rev.draft_version=v.draft_version ORDER BY r.created_at DESC LIMIT 1)
 FROM chapters c JOIN chapter_versions v ON v.chapter_id=c.id AND v.branch_id=c.branch_id
 AND v.draft_version=CASE WHEN $3=0 THEN c.draft_version ELSE $3 END WHERE c.id=$1 AND c.branch_id=$2`, chapter, branch, version).Scan(&d.DraftVersion, &raw, &d.Origin, &d.CreatedAt, &report)
	if errors.Is(err, pgx.ErrNoRows) {
		if version == 0 {
			return d, nil
		}
		return d, app.ErrNotFound
	}
	if err != nil {
		return d, err
	}
	if err = json.Unmarshal(raw, &d.Segments); err != nil {
		return d, err
	}
	if report != nil {
		var r review.Report
		if err = json.Unmarshal(report, &r); err != nil {
			return d, err
		}
		d.Findings = r.Findings
		d.Reviewed = true
	}
	return d, nil
}
func (s *Store) Versions(ctx context.Context, chapter, branch string) ([]app.VersionInfo, error) {
	rows, err := s.pool.Query(ctx, "SELECT draft_version,origin,created_at FROM chapter_versions WHERE chapter_id=$1 AND branch_id=$2 ORDER BY draft_version DESC LIMIT 100", chapter, branch)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.VersionInfo{}
	for rows.Next() {
		var v app.VersionInfo
		if err = rows.Scan(&v.DraftVersion, &v.Origin, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) EditSegment(ctx context.Context, chapter, branch, id string, expected int, text string) (app.Draft, error) {
	if expected < 1 || strings.TrimSpace(text) == "" || utf8.RuneCountInString(text) > 20000 {
		return app.Draft{}, app.ErrInvalidWrite
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return app.Draft{}, err
	}
	defer tx.Rollback(context.Background())
	var current int
	err = tx.QueryRow(ctx, "SELECT draft_version FROM chapters WHERE id=$1 AND branch_id=$2 FOR UPDATE", chapter, branch).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Draft{}, app.ErrNotFound
	}
	if err != nil {
		return app.Draft{}, err
	}
	if current != expected {
		return app.Draft{}, app.ErrVersionMismatch
	}
	var raw []byte
	if err = tx.QueryRow(ctx, "SELECT segments FROM chapter_versions WHERE chapter_id=$1 AND branch_id=$2 AND draft_version=$3", chapter, branch, current).Scan(&raw); err != nil {
		return app.Draft{}, err
	}
	var segments []manuscript.Segment
	if err = json.Unmarshal(raw, &segments); err != nil {
		return app.Draft{}, err
	}
	found := false
	for i := range segments {
		if segments[i].ID == id {
			if segments[i].Text == text {
				return app.Draft{}, app.ErrInvalidWrite
			}
			segments[i].Text = text
			segments[i].Version = current + 1
			found = true
		}
	}
	if !found {
		return app.Draft{}, app.ErrNotFound
	}
	if err = writeVersion(ctx, tx, chapter, branch, current, segments, "human_inline", ""); err != nil {
		return app.Draft{}, err
	}
	// 与人稿落库同事务作废本章所有旧运行结果；正在返回的 Agent 会在 CAS 处被拦截。
	if _, err = tx.Exec(ctx, `UPDATE runs SET status='stale',
 payload=jsonb_set(jsonb_set(payload,'{status}','"stale"'),'{error}','"稿本已被作者更新，旧评审与候选修订失效"'),updated_at=now()
 WHERE chapter_id=$1 AND branch_id=$2 AND status NOT IN ('stale','interrupted','failed')`, chapter, branch); err != nil {
		return app.Draft{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return app.Draft{}, err
	}
	// 返回本次实际写入的版本，避免另一个窗口抢先保存后将它的新版本当成本次结果。
	return s.Draft(ctx, chapter, branch, current+1)
}

func writeVersion(ctx context.Context, tx pgx.Tx, chapter, branch string, expected int, segments []manuscript.Segment, origin, runID string) error {
	if len(segments) == 0 {
		return app.ErrInvalidWrite
	}
	seen := map[string]bool{}
	for _, seg := range segments {
		if seg.ID == "" || seg.ChapterID != chapter || seg.SceneID == "" || seg.BeatID == "" || seg.Version < 1 || seg.Version > expected+1 || strings.TrimSpace(seg.Text) == "" || seen[seg.ID] {
			return app.ErrInvalidWrite
		}
		seen[seg.ID] = true
		raw, err := json.Marshal(seg)
		if err != nil {
			return err
		}
		// 已有的段落版本必须逐字段相等，不能给新内容贴旧版本号。
		var previous []byte
		err = tx.QueryRow(ctx, "SELECT payload FROM segment_versions WHERE chapter_id=$1 AND branch_id=$2 AND segment_id=$3 AND version=$4", chapter, branch, seg.ID, seg.Version).Scan(&previous)
		if err == nil {
			var old manuscript.Segment
			if err = json.Unmarshal(previous, &old); err != nil {
				return err
			}
			if !reflect.DeepEqual(old, seg) {
				return app.ErrInvalidWrite
			}
		} else if errors.Is(err, pgx.ErrNoRows) {
			if seg.Version != expected+1 {
				return app.ErrInvalidWrite
			}
			if _, err = tx.Exec(ctx, "INSERT INTO segment_versions VALUES($1,$2,$3,$4,$5)", chapter, branch, seg.ID, seg.Version, raw); err != nil {
				return err
			}
		} else {
			return err
		}
	}
	raw, err := json.Marshal(segments)
	if err != nil {
		return err
	}
	var source any
	if runID != "" {
		source = runID
	}
	if _, err = tx.Exec(ctx, "INSERT INTO chapter_versions(chapter_id,branch_id,draft_version,segments,origin,run_id) VALUES($1,$2,$3,$4,$5,$6)", chapter, branch, expected+1, raw, origin, source); err != nil {
		return err
	}
	// CAS：expected 不匹配时事务回滚，连同上面的快照与段历史一起撤销。
	tag, err := tx.Exec(ctx, "UPDATE chapters SET draft_version=draft_version+1 WHERE id=$1 AND branch_id=$2 AND draft_version=$3", chapter, branch, expected)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return app.ErrVersionMismatch
	}
	return nil
}
