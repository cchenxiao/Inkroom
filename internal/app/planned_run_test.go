package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"inkloom/internal/domain/planning"
	"inkloom/internal/orchestration"
)

func TestPlannedContextProjectionAndFirstBeatExecution(t *testing.T) {
	base := outlineFixture(t)
	base.Style.AnchorText = "不可传给正文的参考原文"
	zero, later := int64(0), int64(20)
	pov := base.Core.Content.Characters[0].ID
	f := &base.Core.Content.WorldFacts[0]
	f.StoryTime = &zero
	f.KnownBy = []planning.ProposedKnowledge{{CharacterID: pov, LearnedAt: &zero}}
	future := *f
	future.ID = "future-secret"
	future.Text = "不应泄露的未来事实"
	future.KnownBy = []planning.ProposedKnowledge{{CharacterID: pov, LearnedAt: &later}}
	base.Core.Content.WorldFacts = append(base.Core.Content.WorldFacts, future)
	base.Core.Decisions[future.ID] = planning.CoreConfirmed
	outline := planning.OutlineSelection{Version: 1, BindingsVersion: 1, Versions: base.Versions, Content: fakeOutline(base), Confirmed: true}
	in := planning.ChapterPlanInput{Base: base, Outline: outline, ChapterID: outline.Content.Chapters[0].ID, Request: "第一章"}
	content := fakeChapterPlan(in)
	content.Scenes[0].StoryTime = &zero
	p := planning.ChapterPlanSelection{Version: 1, Versions: in.Versions(), ChapterID: in.ChapterID, Input: in, Content: content, Confirmed: true}
	_, cfg := trialFixture(t)
	frozen, err := PreparePlannedContext(cfg, "example/main", "planned-test", 0, p)
	if err != nil {
		t.Fatal(err)
	}
	if err = frozen.Validate(); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(frozen.Bundle)
	for _, bad := range []string{base.Style.AnchorText, future.Text, "ch7", "沈砚"} {
		if strings.Contains(string(raw), bad) {
			t.Fatalf("leaked %s", bad)
		}
	}
	if frozen.Bundle.PreviousEnding != nil || len(frozen.Bundle.Facts) != 1 || frozen.Bundle.ChapterID == in.ChapterID {
		t.Fatal("invalid first chapter isolation")
	}
	result, err := ExecuteChapter(context.Background(), cfg, "normal", orchestration.Options{FrozenInput: &frozen, MaxRounds: 2})
	if err != nil || len(result.Segments) != 1 || result.Segments[0].ChapterID != frozen.Bundle.ChapterID {
		t.Fatalf("planned run failed: %v %+v", err, result)
	}
	p.Content.Scenes[0].StoryTime = nil
	if _, err = PreparePlannedContext(cfg, "example/main", "unknown", 0, p); err == nil {
		t.Fatal("unknown scene time accepted")
	}
	p.Content.Scenes[0].StoryTime = &zero
	p.Input.ChapterID = p.Input.Outline.Content.Chapters[1].ID
	p.ChapterID = p.Input.ChapterID
	if _, err = PreparePlannedContext(cfg, "example/main", "later", 0, p); err == nil {
		t.Fatal("later chapter accepted without previous commit")
	}
}
