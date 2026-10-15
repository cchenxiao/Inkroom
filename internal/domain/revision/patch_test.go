package revision

import (
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"reflect"
	"testing"
)

func TestPatchValidationIsAtomic(t *testing.T) {
	source := []manuscript.Segment{{ID: "s", Text: "沈砚没有离开。他嘴角勾起一抹冷笑。", Version: 1}}
	findings := []review.Finding{{ID: "f", SegmentID: "s", Critic: "ai_taste", Severity: review.P2, RepairScope: "phrase", DraftVersion: 1, Quote: "嘴角勾起一抹冷笑"}}
	base := Proposal{BasedOnDraftVersion: 1, Patches: []Patch{{FindingID: "f", SegmentID: "s", ChangeType: "delete", OldText: findings[0].Quote, Reason: "删除套语"}}}
	cases := []struct {
		name   string
		mutate func(*Proposal)
	}{
		{"stale", func(p *Proposal) { p.BasedOnDraftVersion = 2 }},
		{"new entity", func(p *Proposal) { p.Patches[0].ChangeType = "replace"; p.Patches[0].NewText = "沈砚死了" }},
		{"negation", func(p *Proposal) { p.Patches[0].ChangeType = "replace"; p.Patches[0].NewText = "没有冷笑" }},
		{"partial batch", func(p *Proposal) { p.Patches = append(p.Patches, Patch{FindingID: "missing"}) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := base
			p.Patches = append([]Patch{}, base.Patches...)
			tc.mutate(&p)
			got, err := Apply(source, findings, 1, p, []string{"沈砚"})
			if err == nil {
				t.Fatal("unsafe patch accepted")
			}
			if !reflect.DeepEqual(got, source) || source[0].Version != 1 {
				t.Fatal("failed patch mutated original")
			}
		})
	}
}

func TestQuantityAndOverlappingQuoteAreProtected(t *testing.T) {
	for _, tc := range []struct{ text, old, next string }{
		{"他握着三枚铜扣。", "三枚铜扣", "五枚铜扣"},
		{"他哈哈哈地笑。", "哈哈", "呵呵"},
		{"雨落下来，一股情绪涌上心头。", "一股情绪涌上心头。", ""},
	} {
		source := []manuscript.Segment{{ID: "s", Text: tc.text, Version: 1}}
		findings := []review.Finding{{ID: "f", SegmentID: "s", Critic: "ai_taste", Severity: review.P2, RepairScope: "phrase", DraftVersion: 1, Quote: tc.old}}
		kind := "replace"
		if tc.next == "" {
			kind = "delete"
		}
		p := Proposal{BasedOnDraftVersion: 1, Patches: []Patch{{FindingID: "f", SegmentID: "s", ChangeType: kind, OldText: tc.old, NewText: tc.next, Reason: "改写"}}}
		got, err := Apply(source, findings, 1, p, []string{"铜扣"})
		if err == nil || got[0].Text != tc.text {
			t.Fatalf("unsafe change accepted: %+v", tc)
		}
	}
}
