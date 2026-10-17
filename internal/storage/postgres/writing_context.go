package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/planning"
	"reflect"
)

// Chosen prose is an immutable adopted version, separate from POV knowledge.
func adoptedPassage(ctx context.Context, q queryRow, scope, chapter, beat string) (manuscript.Passage, error) {
	var raw []byte
	err := q.QueryRow(ctx, `SELECT c.payload FROM manuscript_commits c JOIN runs r ON r.id=c.run_id
 JOIN planning_run_inputs p ON p.run_id=r.id WHERE p.scope=$1 AND p.chapter_id=$2
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.payload->'segments') s WHERE s->>'beatId'=$3)
 ORDER BY c.created_at DESC,c.id DESC LIMIT 1`, scope, chapter, beat).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return manuscript.Passage{}, nil
	}
	if err != nil {
		return manuscript.Passage{}, err
	}
	var c app.FinalCommit
	if err = json.Unmarshal(raw, &c); err != nil {
		return manuscript.Passage{}, err
	}
	p := manuscript.Passage{BeatID: beat, DraftID: c.ChapterID, RunID: c.RunID, Version: c.DraftVersion}
	for _, s := range c.Segments {
		if s.BeatID == beat {
			p.Segments = append(p.Segments, s)
		}
	}
	p.Digest, err = manuscript.ContentDigest(p.Segments)
	return p, err
}
func freezeNeighbors(ctx context.Context, tx pgx.Tx, scope string, p planning.ChapterPlanSelection, beat string) ([]manuscript.Passage, error) {
	beats := []planning.PlannedBeat{}
	for _, s := range p.Content.Scenes {
		beats = append(beats, s.Beats...)
	}
	out := []manuscript.Passage{}
	for i, b := range beats {
		if b.ID != beat {
			continue
		}
		for _, offset := range []int{-1, 1} {
			n := i + offset
			if n < 0 || n >= len(beats) {
				continue
			}
			passage, err := workingPassage(ctx, tx, scope, p.ChapterID, beats[n].ID)
			if err != nil {
				return nil, err
			}
			passage.BeatID = beats[n].ID
			passage.Title = beats[n].Title
			passage.Position = "before"
			if offset > 0 {
				passage.Position = "after"
			}
			out = append(out, passage)
		}
	}
	return out, nil
}

// Working prose uses saved manuscript heads, including unapproved candidates and direct edits.
// Never read partially streamed model output or unsaved browser buffers.
// Rank each head by this beat's last narrative change, not the whole draft save time:
// saving a different beat in a chapter must not resurrect its older sibling text.
// Explicit adoption is also author intent and supersedes older unadopted candidates.
func workingPassage(ctx context.Context, q queryRow, scope, chapter, beat string) (manuscript.Passage, error) {
	var p manuscript.Passage
	var raw []byte
	var adopted bool
	err := q.QueryRow(ctx, `SELECT v.chapter_id,COALESCE(v.run_id,owner.id),v.draft_version,v.segments,
        EXISTS(SELECT 1 FROM manuscript_commits c WHERE c.chapter_id=v.chapter_id AND c.branch_id=v.branch_id AND c.draft_version=v.draft_version)
        FROM chapters h JOIN chapter_versions v ON v.chapter_id=h.id AND v.branch_id=h.branch_id AND v.draft_version=h.draft_version
        JOIN LATERAL(SELECT r.id FROM runs r JOIN planning_run_inputs b ON b.run_id=r.id
          WHERE r.chapter_id=h.id AND r.branch_id=h.branch_id AND b.scope=$1 AND b.chapter_id=$2
          ORDER BY r.created_at DESC,r.id DESC LIMIT 1) owner ON true
        JOIN LATERAL (
          SELECT max(changed.created_at) AS modified_at FROM (
            SELECT history.created_at, history.narrative,
                   lag(history.narrative) OVER (ORDER BY history.draft_version) AS previous
            FROM (
              SELECT prior.draft_version, prior.created_at,
                COALESCE((SELECT jsonb_agg(part - 'version' - 'chapterId' - 'order' ORDER BY ordinal)
                  FROM jsonb_array_elements(prior.segments) WITH ORDINALITY AS pieces(part,ordinal)
                  WHERE part->>'beatId'=$3),'[]'::jsonb) AS narrative
              FROM chapter_versions prior
              WHERE prior.chapter_id=v.chapter_id AND prior.branch_id=v.branch_id
                AND prior.draft_version<=v.draft_version
            ) history
          ) changed WHERE changed.narrative IS DISTINCT FROM changed.previous
        ) freshness ON true
        LEFT JOIN LATERAL (
          SELECT max(c.created_at) AS adopted_at FROM manuscript_commits c
          WHERE c.chapter_id=v.chapter_id AND c.branch_id=v.branch_id AND c.draft_version<=v.draft_version
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.payload->'segments') s WHERE s->>'beatId'=$3)
        ) adoption ON true
        WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(v.segments) s WHERE s->>'beatId'=$3)
        ORDER BY GREATEST(freshness.modified_at,adoption.adopted_at) DESC,v.created_at DESC,v.chapter_id DESC LIMIT 1`, scope, chapter, beat).Scan(&p.DraftID, &p.RunID, &p.Version, &raw, &adopted)
	if errors.Is(err, pgx.ErrNoRows) {
		return adoptedPassage(ctx, q, scope, chapter, beat)
	}
	if err != nil {
		return p, err
	}
	var segments []manuscript.Segment
	if err = json.Unmarshal(raw, &segments); err != nil {
		return p, err
	}
	p.BeatID, p.State = beat, "candidate"
	if adopted {
		p.State = "adopted"
	}
	for _, s := range segments {
		if s.BeatID == beat {
			p.Segments = append(p.Segments, s)
		}
	}
	p.Digest, err = manuscript.ContentDigest(p.Segments)
	return p, err
}

// Rechecking unchanged prose or adopting it must not invalidate the adjacent draft in a loop.
// Frozen versions remain auditable; only changes to the narrative content need another review.
func sameNarrative(a, b manuscript.Passage) bool {
	type text struct{ ID, Beat, Scene, POV, Text string }
	project := func(p manuscript.Passage) []text {
		out := []text{}
		for _, s := range p.Segments {
			out = append(out, text{s.ID, s.BeatID, s.SceneID, s.POV, s.Text})
		}
		return out
	}
	return reflect.DeepEqual(project(a), project(b))
}
func neighborsCurrent(ctx context.Context, q queryRow, p *app.PlannedRunSource) (bool, error) {
	for _, source := range p.Neighbors {
		if p.NeighborPolicy == "working-v1" {
			current, err := workingPassage(ctx, q, p.Scope, p.ChapterID, source.BeatID)
			if err != nil {
				return false, err
			}
			if !sameNarrative(source, current) {
				return false, nil
			}
		} else {
			current, err := adoptedPassage(ctx, q, p.Scope, p.ChapterID, source.BeatID)
			if err != nil {
				return false, err
			}
			if current.RunID != source.RunID || current.Version != source.Version || current.Digest != source.Digest {
				return false, nil
			}
		}
	}
	return true, nil
}

// Adoption of this target is a concurrency boundary; neighboring prose is review evidence.
func baselineCurrent(ctx context.Context, q queryRow, p *app.PlannedRunSource) (bool, error) {
	for _, source := range p.Baseline {
		current, err := adoptedPassage(ctx, q, p.Scope, p.ChapterID, source.BeatID)
		if err != nil {
			return false, err
		}
		if current.RunID != source.RunID || current.Version != source.Version || current.Digest != source.Digest {
			return false, nil
		}
	}
	return true, nil
}

// All saved working-prose writes share the lock used by neighbor snapshots and approvals.
func lockDraftPlanning(ctx context.Context, tx pgx.Tx, chapter, branch string) error {
	var scope string
	err := tx.QueryRow(ctx, `SELECT b.scope FROM planning_run_inputs b JOIN runs r ON r.id=b.run_id
        WHERE r.chapter_id=$1 AND r.branch_id=$2 ORDER BY r.created_at DESC,r.id DESC LIMIT 1`, chapter, branch).Scan(&scope)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return tx.QueryRow(ctx, "SELECT scope FROM planning_heads WHERE scope=$1 FOR UPDATE", scope).Scan(&scope)
}
