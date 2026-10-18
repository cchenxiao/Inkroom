package orchestration

import "inkloom/internal/domain/review"

type ReviewComparison struct {
	FromVersion int `json:"fromVersion"`
	ToVersion   int `json:"toVersion"`
	Added       int `json:"added"`
	Continued   int `json:"continued"`
	NotRepeated int `json:"notRepeated"`
}

// Match exact cited locations, not ephemeral model IDs or severity. This is a
// report comparison, never proof of resolution or permission to approve.
func compareReviews(before, after review.Report) *ReviewComparison {
	if before.DraftVersion == 0 {
		return nil
	}
	key := func(f review.Finding) string { return f.Critic + "\x00" + f.SegmentID + "\x00" + f.Quote }
	prior := map[string]int{}
	for _, f := range before.Findings {
		prior[key(f)]++
	}
	out := &ReviewComparison{FromVersion: before.DraftVersion, ToVersion: after.DraftVersion}
	for _, f := range after.Findings {
		k := key(f)
		if prior[k] > 0 {
			out.Continued++
			prior[k]--
		} else {
			out.Added++
		}
	}
	for _, n := range prior {
		out.NotRepeated += n
	}
	return out
}

// A generic author edit clears the live report while keeping completed reviews.
// Resume checkpoints written before local finding actions must use that history,
// otherwise every surviving issue is misleadingly counted as newly discovered.
func priorReview(s ChapterState) review.Report {
	if len(s.Report.Findings) > 0 || s.ReviewPending {
		return s.Report
	}
	if len(s.Reviews) > 0 {
		return s.Reviews[len(s.Reviews)-1]
	}
	return review.Report{}
}
