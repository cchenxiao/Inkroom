package postgres

import (
	"inkloom/internal/orchestration"
	"reflect"
)

// Lookup is persisted before the separate author-requirement assessment. The
// aggregate must retain its exact evidence, trace and finding prefix. Only the
// explicit assessment's appended findings, AuthorCheck and Continuity may differ.
func criticLookupMatches(lookup, aggregate orchestration.CriticReview, assessed bool) bool {
	if lookup.Critic != "hard_consistency" || aggregate.Critic != lookup.Critic || lookup.Status != "completed" || aggregate.Status != "completed" {
		return false
	}
	if reflect.DeepEqual(lookup, aggregate) {
		return true
	}
	if !assessed || lookup.AuthorCheck != nil || aggregate.AuthorCheck == nil || len(aggregate.Findings) < len(lookup.Findings) {
		return false
	}
	for i, finding := range lookup.Findings {
		if !reflect.DeepEqual(finding, aggregate.Findings[i]) {
			return false
		}
	}
	aggregate.Findings = lookup.Findings
	aggregate.AuthorCheck = lookup.AuthorCheck
	aggregate.Continuity = lookup.Continuity
	return reflect.DeepEqual(lookup, aggregate)
}
