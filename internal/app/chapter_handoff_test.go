package app

import (
	"encoding/json"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/planning"
	"strings"
	"testing"
)

func TestNextChapterFreezesPublishedEndingAndProjectsFacts(t *testing.T) {
	base := outlineFixture(t)
	zero := int64(0)
	pov := base.Core.Content.Characters[0].ID
	base.Core.Content.WorldFacts[0].StoryTime = &zero
	base.Core.Content.WorldFacts[0].KnownBy = []planning.ProposedKnowledge{{CharacterID: pov, LearnedAt: &zero}}
	o := planning.OutlineSelection{Version: 1, BindingsVersion: 1, Versions: base.Versions, Content: fakeOutline(base), Confirmed: true}
	in := planning.ChapterPlanInput{Base: base, Outline: o, ChapterID: o.Content.Chapters[1].ID, Request: "继续第二章"}
	content := fakeChapterPlan(in)
	content.TargetWords = 2400
	content.Scenes[0].StoryTime = &zero
	p := planning.ChapterPlanSelection{Version: 1, Versions: in.Versions(), ChapterID: in.ChapterID, Input: in, Content: content, Confirmed: true}
	_, cfg := trialFixture(t)
	pub := ChapterPublication{ID: "published-one", Scope: "example/main", ChapterID: o.Content.Chapters[0].ID, Version: 2,
		Review:           ChapterReviewJob{Decision: &ChapterReviewDecision{Action: "approve"}},
		FactConfirmation: FactConfirmation{NoPendingFacts: true},
		Assembly:         ChapterAssembly{Parts: []AssemblyPart{{Segments: []manuscript.Segment{{Text: strings.Repeat("前文", 800) + "钥匙仍在左手，走向渡口。"}}}}},
		FactSelection: &ChapterFactsSelection{Package: ChapterFactPackage{Facts: []ConfirmedChapterFact{
			{ID: "known", Text: "已确认可知事实", KnownBy: []string{pov}},
			{ID: "secret", Text: "别人知道的秘密", KnownBy: []string{"other"}},
			{ID: "future", Text: "未来才获知的事情", KnownBy: []string{pov}, StoryTime: 999},
		}}},
	}
	if _, err := PreparePlannedContext(cfg, "example/main", "run", 0, p); err == nil {
		t.Fatal("missing publication accepted")
	}
	frozen, err := PreparePlannedContextWithHistory(cfg, "example/main", "run", 0, p, []ChapterPublication{pub})
	if err != nil {
		t.Fatal(err)
	}
	if frozen.Bundle.WritingTask.ChapterTargetWords != 2400 || frozen.Bundle.WritingTask.BeatTargetWords != 1200 {
		t.Fatal("chapter length override not frozen")
	}
	if frozen.Bundle.WritingTask.Opening || frozen.Bundle.WritingTask.ChapterNumber != 2 || frozen.Bundle.PreviousEnding.Version != 2 || len([]rune(frozen.Bundle.PreviousEnding.Text)) != 1200 || !strings.HasSuffix(frozen.Bundle.PreviousEnding.Text, "钥匙仍在左手，走向渡口。") {
		t.Fatal("lost pinned chapter ending")
	}
	raw, _ := json.Marshal(frozen.Bundle)
	if !strings.Contains(string(raw), "已确认可知事实") || strings.Contains(string(raw), "别人知道的秘密") || strings.Contains(string(raw), "未来才获知的事情") {
		t.Fatal("POV/time projection failed")
	}
	frozen, err = ReassemblePlanned(frozen)
	if err != nil || frozen.Validate() != nil {
		t.Fatal("reassembly lost previous chapter", err)
	}
	pub.Scope = "another/main"
	if _, err = PreparePlannedContextWithHistory(cfg, "example/main", "run", 0, p, []ChapterPublication{pub}); err == nil {
		t.Fatal("cross-project publication accepted")
	}
}
