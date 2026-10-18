package postgres

import (
	"context"
	"encoding/json"
	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/style"
	"strings"
	"unicode"
)

// Report actual current prose, not the teaching fixture or a sum of candidate history.
func (s *Store) BookQuality(ctx context.Context, scope string) (app.BookQuality, error) {
	out := app.BookQuality{Scope: scope, Chapters: []app.QualityChapter{}, Runs: []app.QualityRun{}}
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(context.Background())
	state, err := readPlanning(ctx, tx, scope)
	if err != nil {
		return out, err
	}
	if state.OutlineSelection == nil {
		return out, nil
	}
	for _, ch := range state.OutlineSelection.Content.Chapters {
		c := app.QualityChapter{ChapterID: ch.ID, Title: ch.Title, Findings: []app.QualityFinding{}}
		texts := []string{}
		for _, plan := range state.ChapterPlans {
			if plan.ChapterID != ch.ID {
				continue
			}
			for _, scene := range plan.Content.Scenes {
				for _, beat := range scene.Beats {
					p, e := workingPassage(ctx, tx, scope, ch.ID, beat.ID)
					if e != nil {
						return out, e
					}
					if len(p.Segments) == 0 {
						continue
					}
					for _, seg := range p.Segments {
						texts = append(texts, seg.Text)
					}
					var raw []byte
					if e = tx.QueryRow(ctx, "SELECT payload FROM runs WHERE id=$1", p.RunID).Scan(&raw); e != nil {
						return out, e
					}
					var run app.Run
					if e = json.Unmarshal(raw, &run); e != nil {
						return out, e
					}
					// Do not label old findings as current when a saved edit has not been reviewed.
					if run.Result == nil || run.DraftVersion != p.Version || run.Result.ReviewPending {
						continue
					}
					for _, f := range run.Result.Report.Findings {
						for _, seg := range p.Segments {
							if f.SegmentID == seg.ID && strings.Contains(seg.Text, f.Quote) {
								kept := false
								for _, d := range run.Result.FindingDecisions {
									if d.FindingID == f.ID && d.Decision == "keep" {
										kept = true
									}
								}
								c.Findings = append(c.Findings, app.QualityFinding{Finding: f, BeatID: beat.ID, RunID: run.ID, Kept: kept})
							}
						}
					}
				}
			}
		}
		text := strings.Join(texts, "\n\n")
		for _, r := range text {
			if !unicode.IsSpace(r) {
				c.Words++
			}
		}
		c.Statistics = style.Analyze([]manuscript.Segment{{ID: ch.ID, Text: text}}, nil)[0]
		out.Chapters = append(out.Chapters, c)
	}
	rows, err := tx.Query(ctx, `SELECT r.payload FROM runs r JOIN planning_run_inputs p ON p.run_id=r.id WHERE p.scope=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 100`, scope)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			return out, err
		}
		var r app.Run
		if err = json.Unmarshal(raw, &r); err != nil {
			return out, err
		}
		out.Runs = append(out.Runs, app.QualityRun{ID: r.ID, ChapterID: r.Planning.ChapterID, BeatID: r.Planning.BeatID, Status: r.Status, Mode: r.Planning.Mode, Model: r.Model, Error: r.Error, Tokens: r.Usage.InputTokens + r.Usage.OutputTokens, TokensKnown: r.Usage.Known, ReviseRound: r.ReviseRound, AutoRevise: r.AutoRevise, Lookup: r.Lookup != nil, CreatedAt: r.CreatedAt})
	}
	return out, rows.Err()
}
