package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/domain/planning"
)

func chapterHistory(ctx context.Context, q queryRow, scope string, p planning.ChapterPlanSelection) ([]app.ChapterPublication, error) {
	history := []app.ChapterPublication{}
	for i, ch := range p.Input.Outline.Content.Chapters {
		if ch.ID == p.ChapterID {
			return history, nil
		}
		var raw []byte
		err := q.QueryRow(ctx, "SELECT record FROM chapter_publications WHERE scope=$1 AND chapter_id=$2 ORDER BY version DESC LIMIT 1", scope, ch.ID).Scan(&raw)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: 请先完成第 %d 章「%s」的整章定稿", app.ErrPlanningNotReady, i+1, ch.Title)
		}
		if err != nil {
			return nil, err
		}
		var pub app.ChapterPublication
		if err = json.Unmarshal(raw, &pub); err != nil {
			return nil, err
		}
		history = append(history, pub)
	}
	return nil, app.ErrVersionMismatch
}
