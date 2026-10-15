package knowledge_test

import (
	"encoding/json"
	"strings"
	"testing"

	"inkloom/internal/domain/knowledge"
	"inkloom/internal/domain/memory"
)

func fixture() knowledge.Snapshot {
	old := knowledge.Location{ChapterID: "ch4", SegmentID: "ch4-s2", At: memory.Moment{Chapter: 4, StoryTime: 240}}
	later := knowledge.Location{ChapterID: "ch8", SegmentID: "ch8-s1", At: memory.Moment{Chapter: 8, StoryTime: 480}}
	return knowledge.Snapshot{ProjectID: "book", BranchID: "main", Version: 1, Confirmed: true, Characters: []string{"shen", "lu"},
		Facts:       []knowledge.Fact{{ID: "letter", Version: 1, Text: "陆青藏了旧信。", Source: old}},
		Timeline:    []knowledge.TimelineEvent{{ID: "hide", Summary: "藏信", Source: old, FactIDs: []string{"letter"}, CausalBefore: []string{"reveal"}}, {ID: "reveal", Summary: "发现旧信", Source: later, FactIDs: []string{"letter"}}},
		Information: []knowledge.InfoState{{FactID: "letter", SubjectID: "lu", State: "known", Source: old}, {FactID: "letter", SubjectID: "shen", State: "known", Source: later}, {FactID: "letter", SubjectID: "reader", State: "known", Source: old}},
		Foreshadows: []knowledge.Foreshadow{{ID: "clue", Title: "空座板", Payload: "旧信解释失踪原因", Planted: old, PlanResolveChapter: 8, Status: "open", Importance: "P1"}},
	}
}

func TestProjectionKeepsCharacterAndAuthorKnowledgeSeparate(t *testing.T) {
	for _, tc := range []struct {
		name, pov string
		at        memory.Moment
		want      int
	}{
		{"reader knows but shen does not", "shen", memory.Moment{Chapter: 7, StoryTime: 420}, 0},
		{"lu already knows", "lu", memory.Moment{Chapter: 7, StoryTime: 420}, 1},
		{"chapter alone is insufficient", "shen", memory.Moment{Chapter: 8, StoryTime: 420}, 0},
		{"story time alone is insufficient", "shen", memory.Moment{Chapter: 7, StoryTime: 480}, 0},
		{"both acquisition boundaries reached", "shen", memory.Moment{Chapter: 8, StoryTime: 480}, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := fixture()
			got, err := knowledge.Project(s, memory.View{ProjectID: "book", BranchID: "main", POV: tc.pov, At: tc.at})
			if err != nil || len(got.CharacterContext) != tc.want {
				t.Fatalf("%+v %v", got, err)
			}
			raw, _ := json.Marshal(got)
			if strings.Contains(string(raw), "旧信解释失踪原因") {
				t.Fatal("author plan leaked")
			}
		})
	}
	s := fixture()
	s.Information[0].State = "belief"
	s.Information[0].Belief = "信已经烧掉了。"
	got, err := knowledge.Project(s, memory.View{ProjectID: "book", BranchID: "main", POV: "lu", At: memory.Moment{Chapter: 7, StoryTime: 420}})
	if err != nil || len(got.CharacterContext) != 0 {
		t.Fatalf("belief promoted to world fact: %+v %v", got, err)
	}
}

func TestRejectInvalidKnowledgeLinks(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*knowledge.Snapshot)
	}{
		{"missing causal event", func(s *knowledge.Snapshot) { s.Timeline[0].CausalBefore = []string{"missing"} }},
		{"causal cycle", func(s *knowledge.Snapshot) {
			s.Timeline[1].Source.At.StoryTime = s.Timeline[0].Source.At.StoryTime
			s.Timeline[1].CausalBefore = []string{"hide"}
		}},
		{"unknown fact", func(s *knowledge.Snapshot) { s.Information[0].FactID = "missing" }},
		{"closed without evidence", func(s *knowledge.Snapshot) { s.Foreshadows[0].Status = "closed" }},
		{"unconfirmed snapshot", func(s *knowledge.Snapshot) { s.Confirmed = false }},
		{"conflicting knowledge", func(s *knowledge.Snapshot) { s.Information = append(s.Information, s.Information[0]) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := fixture()
			tc.change(&s)
			if s.Validate() == nil {
				t.Fatal("invalid snapshot accepted")
			}
		})
	}
	s := fixture()
	if _, err := knowledge.Project(s, memory.View{ProjectID: "book", BranchID: "other", POV: "lu", At: memory.Moment{Chapter: 7, StoryTime: 420}}); err == nil {
		t.Fatal("wrong branch accepted")
	}
}
