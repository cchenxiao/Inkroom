package memory

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestVisibilityBoundaries(t *testing.T) {
	base := Record{ID: "copper", ProjectID: "zhuoliu", BranchID: "main", Version: 1,
		Kind: Fact, Status: Confirmed, ChapterID: "ch2", SegmentID: "ch2-s1",
		At: &Moment{Chapter: 2, StoryTime: 20}, Text: "铜扣来自父亲的旧外套。",
		KnownBy: []Knowledge{{CharacterID: "shenyan", Since: &Moment{Chapter: 3, StoryTime: 30}}}}
	view := View{ProjectID: "zhuoliu", BranchID: "main", POV: "shenyan", At: Moment{Chapter: 7, StoryTime: 70}}
	tests := []struct {
		name   string
		change func(*Record)
		reason Reason
	}{
		{"other project", func(r *Record) { r.ProjectID = "other" }, OtherProject},
		{"other branch", func(r *Record) { r.BranchID = "trial" }, OtherBranch},
		{"candidate", func(r *Record) { r.Status = Candidate }, Unconfirmed},
		{"future chapter flashback", func(r *Record) { r.At = &Moment{Chapter: 9, StoryTime: 10} }, FutureChapter},
		{"future story time", func(r *Record) { r.At = &Moment{Chapter: 2, StoryTime: 80} }, FutureStoryTime},
		{"unknown POV", func(r *Record) { r.KnownBy = nil }, UnknownToPOV},
		{"known by someone else", func(r *Record) { r.KnownBy = []Knowledge{{CharacterID: "luqing", Since: r.At}} }, UnknownToPOV},
		{"knowledge later chapter", func(r *Record) {
			r.KnownBy = []Knowledge{{CharacterID: "shenyan", Since: &Moment{Chapter: 8, StoryTime: 30}}}
		}, KnowledgeLater},
		{"knowledge later story time", func(r *Record) {
			r.KnownBy = []Knowledge{{CharacterID: "shenyan", Since: &Moment{Chapter: 3, StoryTime: 80}}}
		}, KnowledgeLater},
		{"unknown acquisition time", func(r *Record) { r.KnownBy = []Knowledge{{CharacterID: "shenyan"}} }, UnknownToPOV},
		{"missing source time", func(r *Record) { r.At = nil }, InvalidRecord},
		{"unknown kind", func(r *Record) { r.Kind = "summary_inference" }, InvalidRecord},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := base
			tc.change(&r)
			view.Pins = map[string]Pin{r.ID: {Version: r.Version, Digest: Digest(r)}}
			out, err := Select(view, []Record{r})
			if err != nil || len(out.CharacterContext) != 0 || len(out.AuthorPlans) != 0 || len(out.Excluded) != 1 || out.Excluded[0].Reason != tc.reason {
				t.Fatalf("unsafe decision: %+v, %v", out, err)
			}
			raw, _ := json.Marshal(out)
			if strings.Contains(string(raw), r.Text) {
				t.Fatal("excluded content leaked through diagnostic")
			}
		})
	}

	view.Pins = map[string]Pin{base.ID: {Version: 1, Digest: Digest(base)}}
	out, err := Select(view, []Record{base})
	if err != nil || len(out.CharacterContext) != 1 {
		t.Fatalf("known fact lost: %+v %v", out, err)
	}
	base.Text = "改过的正文"
	if out.CharacterContext[0].Text == base.Text {
		t.Fatal("selection aliases input")
	}
	for _, tc := range []struct {
		pin    Pin
		reason Reason
	}{
		{Pin{Version: 2, Digest: Digest(base)}, VersionMismatch},
		{view.Pins[base.ID], DigestMismatch},
		{Pin{}, NotPinned},
	} {
		view.Pins = map[string]Pin{}
		if tc.pin.Version > 0 {
			view.Pins[base.ID] = tc.pin
		}
		out, err = Select(view, []Record{base})
		if err != nil || len(out.Excluded) != 1 || out.Excluded[0].Reason != tc.reason {
			t.Fatalf("pin bypass: %+v %v", out, err)
		}
	}
	view.POV = ""
	if _, err = Select(view, nil); err == nil {
		t.Fatal("missing POV must fail, even with empty candidates")
	}
}

func TestPlanningAndDialogueStayInTheirPartitions(t *testing.T) {
	at := &Moment{Chapter: 2, StoryTime: 20}
	quote := Record{ID: "lie", ProjectID: "zhuoliu", BranchID: "main", Version: 1, Kind: Passage, Status: Confirmed, ChapterID: "ch2", SegmentID: "s1", At: at, Text: "陆青说：我从未见过这枚铜扣。", KnownBy: []Knowledge{{CharacterID: "shenyan", Since: at}}}
	plan := Record{ID: "plan", ProjectID: "zhuoliu", BranchID: "main", Version: 1, Kind: Plan, Status: Confirmed, ChapterID: "ch10", At: &Moment{Chapter: 10, StoryTime: 100}, Text: "第十章让陆青承认藏过铜扣。"}
	v := View{ProjectID: "zhuoliu", BranchID: "main", POV: "shenyan", At: Moment{Chapter: 7, StoryTime: 70}, Pins: map[string]Pin{
		quote.ID: {Version: 1, Digest: Digest(quote)}, plan.ID: {Version: 1, Digest: Digest(plan)},
	}}
	out, err := Select(v, []Record{quote, plan})
	if err != nil || len(out.CharacterContext) != 1 || out.CharacterContext[0].Kind != Passage || len(out.AuthorPlans) != 1 || out.AuthorPlans[0].ID != plan.ID {
		t.Fatalf("partition lost: %+v %v", out, err)
	}
	// 可见范围也属于被固定的内容：修改获知者，不能沿用原正文的摘要。
	quote.KnownBy = append(quote.KnownBy, Knowledge{CharacterID: "luqing", Since: at})
	out, err = Select(v, []Record{quote})
	if err != nil || len(out.Excluded) != 1 || out.Excluded[0].Reason != DigestMismatch {
		t.Fatalf("visibility metadata not pinned: %+v %v", out, err)
	}
}
