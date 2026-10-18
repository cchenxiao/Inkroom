package app

import (
	"context"
	"inkloom/internal/domain/planning"
	"strings"
	"testing"
)

func TestChapterPlanBoundariesAndKnowledge(t *testing.T) {
	base := outlineFixture(t)
	base.Style.AnchorText = "不应转发的参考原文"
	base.Core.Content.Plans = append(base.Core.Content.Plans, planning.FuturePlan{ID: "pending-secret", Subject: "world", Intent: "不能进入模型"})
	base.Core.Decisions["pending-secret"] = planning.CorePending
	outline := planning.OutlineSelection{Version: 1, BindingsVersion: 1, Versions: base.Versions, Content: fakeOutline(base), Confirmed: true}
	in := planning.ChapterPlanInput{Base: base, Outline: outline, ChapterID: outline.Content.Chapters[0].ID, Request: "只展开本章"}
	raw, err := chapterPlanMaterial(in)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "pending-secret") || strings.Contains(string(raw), base.Style.AnchorText) {
		t.Fatal("unconfirmed material leaked")
	}
	_, cfg := trialFixture(t)
	out, err := GenerateChapterPlan(context.Background(), cfg, in, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Scenes) != 1 || out.Brief.SelectedBeatID != out.Scenes[0].Beats[0].ID {
		t.Fatal("invalid fake candidate")
	}
	in.PreviousChapter = &planning.ChapterHandoff{PublicationID: "pub-1", ChapterID: "first", Version: 1, Ending: "前章真实结尾", Facts: []planning.ChapterHandoffFact{{ID: "f", Text: "已确认交接", KnownBy: []string{"shen"}}}}
	raw, err = chapterPlanMaterial(in)
	if err != nil || !strings.Contains(string(raw), "前章真实结尾") || !strings.Contains(string(raw), "已确认交接") {
		t.Fatal("planner handoff omitted", err)
	}
	in.PreviousChapter = nil
	in.Outline.Confirmed = false
	if _, err = GenerateChapterPlan(context.Background(), cfg, in, nil); err == nil {
		t.Fatal("unconfirmed outline accepted")
	}
	in.Outline.Confirmed = true
	out.Brief.SelectedBeatID = "deleted"
	if out.Validate(in) == nil {
		t.Fatal("dangling beat accepted")
	}
	out = fakeChapterPlan(in)
	out.Scenes[0].POVCharacterID = "absent"
	if out.Validate(in) == nil {
		t.Fatal("unknown POV accepted")
	}
	out = fakeChapterPlan(in)
	// 时间未知不等于起点；作者计划、未知或未来知情均不得出现在可知范围。
	zero, later := int64(0), int64(20)
	char := out.Scenes[0].POVCharacterID
	in.Base.Core.Content.WorldFacts = []planning.WorldFactProposal{
		{ID: "known", StoryTime: &zero, KnownBy: []planning.ProposedKnowledge{{CharacterID: char, LearnedAt: &zero}}},
		{ID: "future", StoryTime: &zero, KnownBy: []planning.ProposedKnowledge{{CharacterID: char, LearnedAt: &later}}},
		{ID: "unknown", KnownBy: []planning.ProposedKnowledge{{CharacterID: char, LearnedAt: &zero}}},
	}
	in.Base.Core.Decisions = map[string]planning.CoreDecision{}
	for i := range in.Base.Core.Content.Characters {
		c := &in.Base.Core.Content.Characters[i]
		c.HardFactIDs = []string{}
		in.Base.Core.Decisions[c.ID] = planning.CoreConfirmed
	}
	for i := range in.Base.Core.Content.WorldFacts {
		f := &in.Base.Core.Content.WorldFacts[i]
		f.Subject = "world"
		f.Text = "确认的事实"
		f.Rigidity = "soft"
		in.Base.Core.Decisions[f.ID] = planning.CoreConfirmed
	}
	for _, p := range in.Base.Core.Content.Plans {
		in.Base.Core.Decisions[p.ID] = planning.CoreConfirmed
	}
	if _, err := in.Base.Confirmed(); err != nil {
		t.Fatal(err)
	}
	if len(out.Knowledge(in)[0].KnownFactIDs) != 0 {
		t.Fatal("unknown scene time exposed facts")
	}
	out.Scenes[0].StoryTime = &zero
	knowledge := out.Knowledge(in)[0]
	if len(knowledge.KnownFactIDs) != 1 || knowledge.KnownFactIDs[0] != "known" || len(knowledge.ExcludedFactIDs) != 2 {
		t.Fatal("visibility projection failed", knowledge)
	}
}
