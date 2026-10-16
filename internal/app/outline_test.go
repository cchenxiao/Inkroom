package app

import (
	"context"
	"encoding/json"
	"inkloom/internal/domain/planning"
	"os"
	"strings"
	"testing"
)

func outlineFixture(t *testing.T) planning.OutlineInput {
	t.Helper()
	raw, err := os.ReadFile("../demo/core_settings.json")
	if err != nil {
		t.Fatal(err)
	}
	var base planning.CoreSettingsInput
	if err = json.Unmarshal(raw, &base); err != nil {
		t.Fatal(err)
	}
	content := fakeCoreSettings()
	decisions := map[string]planning.CoreDecision{}
	for _, c := range content.Characters {
		decisions[c.ID] = planning.CoreConfirmed
	}
	for _, f := range content.WorldFacts {
		decisions[f.ID] = planning.CoreConfirmed
	}
	for _, p := range content.Plans {
		decisions[p.ID] = planning.CoreConfirmed
	}
	core := planning.CoreSelection{Version: 1, InputVersion: 1, DirectionVersion: 1, StyleVersion: 1, JobID: "core-fixture", CandidateVersion: 1, Content: content, Decisions: decisions}
	return planning.OutlineInput{Versions: planning.PlanningVersions{Input: 1, Direction: 1, Style: 1, Core: 1}, Source: base.Source, Direction: base.Selection, Style: base.Style, Core: core, Request: "安排三章简要故事骨架", ChapterCount: 3}
}
func TestOutlineFiltersUnconfirmedAndRejectsDanglingBindings(t *testing.T) {
	in := outlineFixture(t)
	in.Style.AnchorText = "参考原文不得传入章纲模型"
	in.Core.Content.Plans = append(in.Core.Content.Plans, planning.FuturePlan{ID: "pending-secret", Subject: "world", Intent: "未确认计划不该进入章纲材料"}, planning.FuturePlan{ID: "rejected-secret", Subject: "world", Intent: "已舍弃的剧情"})
	in.Core.Decisions["pending-secret"] = planning.CorePending
	in.Core.Decisions["rejected-secret"] = planning.CoreRejected
	raw, err := outlineMaterial(in)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{in.Style.AnchorText, "pending-secret", "rejected-secret"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatal("unapproved source leaked", forbidden)
		}
	}
	_, cfg := trialFixture(t)
	out, err := GenerateOutline(context.Background(), cfg, in, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Chapters) != 3 {
		t.Fatal("chapter count ignored")
	}
	out.Chapters[0].CharacterIDs = []string{"unknown"}
	if err = out.Validate(in); err == nil {
		t.Fatal("unknown person accepted")
	}
	out = fakeOutline(in)
	out.Bindings.Plans[0].ChapterIDs = []string{"deleted"}
	if err = out.Validate(in); err == nil {
		t.Fatal("dangling plan binding accepted")
	}
	out = fakeOutline(in)
	out.Bindings.Plans[0].PlanID = "pending-secret"
	if err = out.Validate(in); err == nil {
		t.Fatal("unconfirmed plan accepted")
	}
	out = fakeOutline(in)
	out.Bindings.Style = nil
	if err = out.Validate(in); err == nil {
		t.Fatal("nullable bindings accepted")
	}
	in.Core.StyleVersion = 0
	if _, err = GenerateOutline(context.Background(), cfg, in, nil); err == nil {
		t.Fatal("stale core invoked model")
	}
}
