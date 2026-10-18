package postgres

import (
	"context"
	"encoding/json"
	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/planning"
	"inkloom/internal/domain/style"
	"strings"
)

func (s *Store) BookArchive(ctx context.Context, scope string) (app.BookArchive, error) {
	out := app.BookArchive{Scope: scope, Characters: map[string]string{}, InitialFacts: []planning.WorldFactProposal{}, Chapters: []app.PublishedChapter{}}
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(context.Background())
	state, err := readPlanning(ctx, tx, scope)
	if err != nil {
		return out, err
	}
	if core := state.CoreSelection; core != nil {
		for _, c := range core.Content.Characters {
			if core.Decisions[c.ID] == planning.CoreConfirmed {
				out.Characters[c.ID] = c.Name
			}
		}
		for _, f := range core.Content.WorldFacts {
			if core.Decisions[f.ID] == planning.CoreConfirmed {
				out.InitialFacts = append(out.InitialFacts, f)
			}
		}
	}
	if state.OutlineSelection == nil {
		return out, nil
	}
	rows, err := tx.Query(ctx, `SELECT DISTINCT ON (chapter_id) record FROM chapter_publications WHERE scope=$1 ORDER BY chapter_id,version DESC`, scope)
	if err != nil {
		return out, err
	}
	pubs := map[string]app.ChapterPublication{}
	for rows.Next() {
		var raw []byte
		var pub app.ChapterPublication
		if err = rows.Scan(&raw); err != nil {
			rows.Close()
			return out, err
		}
		if err = json.Unmarshal(raw, &pub); err != nil {
			rows.Close()
			return out, err
		}
		pubs[pub.ChapterID] = pub
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	for i, ch := range state.OutlineSelection.Content.Chapters {
		p, ok := pubs[ch.ID]
		if !ok {
			continue
		}
		status, e := decoratePublication(ctx, tx, p)
		if e != nil {
			return out, e
		}
		c := app.PublishedChapter{Number: i + 1, ChapterID: ch.ID, Title: p.Assembly.Title, PublicationID: p.ID, Version: p.Version, Current: status.Current, Reason: status.Reason, Facts: []app.ConfirmedChapterFact{}, Findings: []app.ChapterFinding{}, KeptFindings: []string{}, ReviewID: p.Review.ID}
		parts := []string{}
		for _, part := range p.Assembly.Parts {
			for _, segment := range part.Segments {
				parts = append(parts, segment.Text)
			}
		}
		c.Text = strings.Join(parts, "\n\n")
		c.Statistics = style.Analyze([]manuscript.Segment{{ID: p.ID, Text: c.Text}}, nil)[0]
		if p.FactSelection != nil {
			c.Facts = p.FactSelection.Package.Facts
		}
		if p.Review.Output != nil {
			for _, critic := range p.Review.Output.Critics {
				c.Findings = append(c.Findings, critic.Findings...)
			}
		}
		if p.Review.Decision != nil {
			c.KeptFindings = p.Review.Decision.KeptFindings
		}
		out.Chapters = append(out.Chapters, c)
	}
	return out, nil
}
