package postgres

import (
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/review"
	"inkloom/internal/orchestration"
	"testing"
)

func TestLookupMatchAcceptsAssessmentButRejectsChangedEvidence(t *testing.T) {
	base := orchestration.CriticReview{Critic: "hard_consistency", Status: "completed", DraftVersion: 7, Findings: []review.Finding{{ID: "original", Quote: "原文"}}, Lookup: &memory.LookupTrace{Stop: "ready"}}
	complete := base
	complete.AuthorCheck = &review.AuthorCheck{Status: "addressed", Reason: "核对完成"}
	complete.Findings = append(append([]review.Finding{}, base.Findings...), review.Finding{ID: "author-finding"})
	if !criticLookupMatches(base, complete, true) || criticLookupMatches(base, complete, false) {
		t.Fatal("assessment extension incorrectly matched")
	}
	for _, change := range []func(*orchestration.CriticReview){
		func(c *orchestration.CriticReview) { c.DraftVersion++ },
		func(c *orchestration.CriticReview) { c.Status = "failed" },
		func(c *orchestration.CriticReview) { c.Lookup = &memory.LookupTrace{Stop: "other"} },
		func(c *orchestration.CriticReview) {
			c.Findings = []review.Finding{{ID: "original", Quote: "篡改引用"}}
		},
		func(c *orchestration.CriticReview) { c.Findings = nil },
	} {
		changed := complete
		change(&changed)
		if criticLookupMatches(base, changed, true) {
			t.Fatal("changed lookup evidence accepted", changed)
		}
	}
}
