package orchestration

import (
	"context"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"reflect"
	"testing"
)

func TestOptionalContinuityRunsInsideReviewAndPreservesDraftOnFailure(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		for _, truncated := range []bool{false, true} {
			segments := []manuscript.Segment{{ID: "a", Text: "袋子放进柜里。", ChapterID: "c", SceneID: "scene", BeatID: "beat"}, {ID: "b", Text: "袋子在桌上。", ChapterID: "c", SceneID: "scene", BeatID: "beat"}}
			before := append([]manuscript.Segment{}, segments...)
			state := ChapterState{DraftVersion: 1, Segments: segments, Context: manuscript.ContextBundle{ChapterID: "c", Beat: manuscript.Beat{ID: "beat", SceneID: "scene"}, WritingTask: &manuscript.WritingTask{ExperimentalContinuity: enabled}}}
			steps := []model.Step{{Role: "hard_consistency", Content: `{"findings":[]}`}, {Role: "ai_taste", Content: `{"findings":[]}`}}
			if enabled {
				finish := model.Complete
				if truncated {
					finish = model.Truncated
				}
				steps = append(steps, model.Step{Role: "hard_consistency", FinishReason: finish, Content: `{"checked":["a","b"],"issues":[{"earlier":"p1","later":"p2","reason":"物件位置冲突","suggestion":"核对是否取回","needsAuthor":false}]}`})
			}
			result, _, err := reviewTogether(context.Background(), model.NewFake(steps), state)
			if !reflect.DeepEqual(state.Segments, before) {
				t.Fatal("review changed prose")
			}
			if enabled && truncated {
				if err == nil || result[0].FailureCode != "model_truncated" || len(result[0].Findings) != 0 {
					t.Fatal("failed check passed", result, err)
				}
				continue
			}
			if err != nil {
				t.Fatal(err)
			}
			want := 0
			if enabled {
				want = 1
			}
			if len(result[0].Findings) != want {
				t.Fatal(result)
			}
			if enabled {
				report, e := review.Aggregate(result[0].Findings, segments, 1)
				if e != nil {
					t.Fatal(e)
				}
				decision := review.Route(report, segments, state.Context, true, true)
				if !decision.NeedsHuman {
					t.Fatal("experimental finding auto-revised", decision)
				}
			}
		}
	}
}
