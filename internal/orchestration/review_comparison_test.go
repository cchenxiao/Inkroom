package orchestration

import (
	"inkloom/internal/domain/review"
	"testing"
)

func TestReviewComparisonDoesNotTrustReusedModelIDs(t *testing.T) {
	before := review.Report{DraftVersion: 1, Findings: []review.Finding{{ID: "one", Critic: "ai_taste", SegmentID: "a", Quote: "旧句"}, {ID: "two", Critic: "ai_taste", SegmentID: "a", Quote: "移除句"}}}
	after := review.Report{DraftVersion: 2, Findings: []review.Finding{{ID: "changed-id", Critic: "ai_taste", SegmentID: "a", Quote: "旧句"}, {ID: "two", Critic: "ai_taste", SegmentID: "a", Quote: "新句"}}}
	c := compareReviews(before, after)
	if c.Added != 1 || c.Continued != 1 || c.NotRepeated != 1 {
		t.Fatal(c)
	}
}

func TestPriorReviewSurvivesClearedReportAndResume(t *testing.T) {
	previous := review.Report{DraftVersion: 3, Findings: []review.Finding{{ID: "p2", Quote: "旧句"}}}
	s := ChapterState{DraftVersion: 4, Report: review.Report{DraftVersion: 4}, Reviews: []review.Report{previous}}
	if got := priorReview(s); got.DraftVersion != 3 || len(got.Findings) != 1 {
		t.Fatal(got)
	}
	// A completed clean report must not resurrect older findings.
	s.Reviews = append(s.Reviews, review.Report{DraftVersion: 4})
	if got := priorReview(s); got.DraftVersion != 4 || len(got.Findings) != 0 {
		t.Fatal(got)
	}
	// Local edits intentionally retain their worklist until explicit review.
	s.Report = previous
	s.ReviewPending = true
	if got := priorReview(s); got.DraftVersion != 3 {
		t.Fatal(got)
	}
	if got := priorReview(ChapterState{}); got.DraftVersion != 0 {
		t.Fatal(got)
	}
}
