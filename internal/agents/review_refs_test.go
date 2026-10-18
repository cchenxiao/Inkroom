package agents

import (
	"context"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"strings"
	"testing"
)

func TestCriticResolvesUniqueReadonlyNeighborEvidence(t *testing.T) {
	ss := []manuscript.Segment{{ID: "middle", Text: "她又收紧袋口。"}}
	b := manuscript.ContextBundle{Neighbors: []manuscript.Passage{{BeatID: "left", Version: 1, Segments: []manuscript.Segment{{ID: "previous", Text: "她收紧袋口。"}}}}}
	out, _, err := Critique(context.Background(), model.NewFake([]model.Step{{Role: "ai_taste", Content: `{"findings":[{"id":"repeat","critic":"ai_taste","severity":"P3","segmentId":"middle","quote":"她又收紧袋口。","evidenceRefs":["middle","previous"],"reason":"与邻段重复收袋动作","suggestion":"核对是否需要重复描写","repairScope":"phrase","draftVersion":1}]}`}}), ss, 1, nil, b)
	if err != nil || len(out) != 1 || out[0].EvidenceRefs[1] != "passage/left/previous" {
		t.Fatal(out, err)
	}
}
func TestNeighborAliasCannotChangeTargetsOrResolveAmbiguity(t *testing.T) {
	fs := []review.Finding{{SegmentID: "previous", Quote: "不存在", RuleRef: "unknown", EvidenceRefs: []string{"same", "previous", "unknown"}}}
	ss := []manuscript.Segment{{ID: "same"}}
	ns := []manuscript.Passage{{BeatID: "left", Version: 1, Segments: []manuscript.Segment{{ID: "previous"}, {ID: "same"}}}, {BeatID: "right", Segments: []manuscript.Segment{{ID: "previous"}}}}
	normalizeNeighborRefs(fs, ss, ns)
	if fs[0].SegmentID != "previous" || fs[0].EvidenceRefs[0] != "same" || fs[0].EvidenceRefs[1] != "previous" || fs[0].RuleRef != "unknown" {
		t.Fatal(fs)
	}
	if _, err := review.Aggregate(fs, ss, 1); err == nil {
		t.Fatal("invalid target accepted")
	}
}

func TestFreshCriticResponseUsesRequestVersionAndStillChecksQuote(t *testing.T) {
	raw := `{"findings":[{"id":"style-1","critic":"ai_taste","severity":"P3","segmentId":"s1","quote":"她收紧袋口。","evidenceRefs":["s1"],"reason":"动作重复","suggestion":"删去重复动作","repairScope":"phrase","draftVersion":2}]}`
	segments := []manuscript.Segment{{ID: "s1", Version: 2, Text: "她收紧袋口。"}, {ID: "s2", Version: 3, Text: "他转身。"}}
	out, _, err := Critique(context.Background(), model.NewFake([]model.Step{{Role: "ai_taste", Content: raw}}), segments, 3, nil)
	if err != nil || len(out) != 1 || out[0].DraftVersion != 3 {
		t.Fatal(out, err)
	}
	raw = strings.ReplaceAll(raw, "她收紧袋口。", "不存在的句子。")
	if _, _, err = Critique(context.Background(), model.NewFake([]model.Step{{Role: "ai_taste", Content: raw}}), segments, 3, nil); err == nil {
		t.Fatal("accepted nonexistent quote")
	}
}
