package agents

import (
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

// A model may copy a neighbor's local segment ID instead of its fully qualified
// source ID. Resolve only unique, read-only aliases. Never change a finding target
// or quote, and leave unknown/ambiguous references for Aggregate to reject.
func normalizeNeighborRefs(findings []review.Finding, segments []manuscript.Segment, neighbors []manuscript.Passage) {
	writable := map[string]bool{}
	for _, s := range segments {
		writable[s.ID] = true
	}
	aliases := map[string]string{}
	ambiguous := map[string]bool{}
	for _, p := range neighbors {
		for _, s := range p.Segments {
			if writable[s.ID] {
				continue
			}
			ref := "passage/" + p.BeatID + "/" + s.ID
			if old, ok := aliases[s.ID]; ok && old != ref {
				ambiguous[s.ID] = true
			}
			aliases[s.ID] = ref
		}
	}
	resolve := func(ref string) string {
		if canonical, ok := aliases[ref]; ok && !ambiguous[ref] {
			return canonical
		}
		return ref
	}
	for i := range findings {
		findings[i].RuleRef = resolve(findings[i].RuleRef)
		for j, ref := range findings[i].EvidenceRefs {
			findings[i].EvidenceRefs[j] = resolve(ref)
		}
	}
}
