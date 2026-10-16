package app

import (
	"encoding/json"
	"inkloom/internal/domain/knowledge"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/planning"
	"strings"
	"testing"
)

func TestPublishInitialKnowledgePreservesSourceAndVisibility(t *testing.T) {
	in := outlineFixture(t)
	zero, later := int64(0), int64(20)
	pov := in.Core.Content.Characters[0].ID
	fact := &in.Core.Content.WorldFacts[0]
	fact.StoryTime = &zero
	fact.KnownBy = []planning.ProposedKnowledge{{CharacterID: pov, LearnedAt: &zero}}
	future := *fact
	future.ID = "future"
	future.Text = "角色稍后才获知的事实"
	future.KnownBy = []planning.ProposedKnowledge{{CharacterID: pov, LearnedAt: &later}}
	unknown := *fact
	unknown.ID = "unknown"
	unknown.Text = "没有故事时点"
	unknown.StoryTime = nil
	in.Core.Content.WorldFacts = append(in.Core.Content.WorldFacts, future, unknown)
	in.Core.Decisions[future.ID] = planning.CoreConfirmed
	in.Core.Decisions[unknown.ID] = planning.CoreConfirmed
	snapshot, excluded, err := BuildPlanningKnowledge("test/main", in, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Facts) != 2 || len(excluded) < 1 || snapshot.Facts[0].Source.ChapterID != "" || snapshot.Facts[0].Source.Initial == nil {
		t.Fatal("source/unknown filtering", snapshot)
	}
	selected, err := knowledge.Project(snapshot, memory.View{ProjectID: "test", BranchID: "main", POV: pov, At: memory.Moment{Chapter: 1, StoryTime: 0}})
	if err != nil || len(selected.CharacterContext) != 1 {
		t.Fatal("initial fact excluded or future knowledge leaked", selected, err)
	}
	raw, _ := json.Marshal(snapshot)
	if strings.Contains(string(raw), unknown.Text) || strings.Contains(string(raw), in.Core.Content.Plans[0].Intent) {
		t.Fatal("unusable fact or author plan published")
	}
	snapshot.Facts[0].Source.SegmentID = "invented-paragraph"
	if snapshot.Validate() == nil {
		t.Fatal("initial source pretended to be a paragraph")
	}
}
