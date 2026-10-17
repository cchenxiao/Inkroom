package app

import (
	"context"
	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/orchestration"
	"reflect"
	"testing"
)

func TestChapterRecheckRequiresCompleteMatchingScopeAndSkipsWriter(t *testing.T) {
	b := manuscript.ContextBundle{Targets: []manuscript.ContextBundle{{Beat: manuscript.Beat{ID: "one", SceneID: "scene"}}, {Beat: manuscript.Beat{ID: "two", SceneID: "scene"}}}}
	base := []manuscript.Segment{{ID: "s1", BeatID: "one", SceneID: "scene", Text: "第一段原文。"}, {ID: "s2", BeatID: "two", SceneID: "scene", Text: "第二段原文。"}}
	for _, tc := range []struct {
		name  string
		mode  string
		ss    []manuscript.Segment
		valid bool
	}{
		{"valid", "chapter", base, true}, {"beat", "beat", base, false}, {"missing", "chapter", base[:1], false}, {"reordered", "chapter", []manuscript.Segment{base[1], base[0]}, false},
		{"different plan", "chapter", []manuscript.Segment{base[0], {ID: "s2", BeatID: "other", SceneID: "scene", Text: "正文"}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := Run{Planning: &PlannedRunSource{Mode: tc.mode}, Result: &orchestration.ChapterState{Segments: tc.ss}}
			if err := ValidateChapterRecheck(b, r); (err == nil) != tc.valid {
				t.Fatal(err)
			}
		})
	}
	b.Original = base
	out, _, err := agents.WriteScope(context.Background(), model.NewFake(nil), b)
	if err != nil || !reflect.DeepEqual(out, base) {
		t.Fatal("recheck regenerated text", out, err)
	}
	req := PlannedRunRequest{RequestID: "r", ChapterID: "c", PlanVersion: 1, Mode: "chapter", Recheck: true, FromRunID: "source", SourceVersion: 2, DraftVersion: 2}
	if !ValidPlannedRequest(req) {
		t.Fatal("chapter recheck blocked")
	}
	req.AutoRevise = true
	if ValidPlannedRequest(req) {
		t.Fatal("recheck permitted automatic rewriting")
	}
	req.AutoRevise = false
	req.Recheck = false
	req.Rewrite = &manuscript.AuthorRewrite{}
	if ValidPlannedRequest(req) {
		t.Fatal("chapter rewrite accidentally enabled")
	}
}
