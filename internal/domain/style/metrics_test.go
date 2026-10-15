package style

import (
	"inkloom/internal/domain/manuscript"
	"testing"
)

func TestMetricsDoNotBecomeUncalibratedGate(t *testing.T) {
	segments := []manuscript.Segment{{ID: "s", Text: "雨。她嘴角勾起一抹冷笑！"}}
	stats := Analyze(segments, []string{"嘴角勾起一抹冷笑"})
	if len(stats[0].SentenceLengths) != 2 || stats[0].SentenceLengths[0] != 1 || stats[0].Calibrated || stats[0].Variance <= 0 {
		t.Fatalf("bad stats: %+v", stats)
	}
	findings := AddFindings(nil, stats, 3)
	if len(findings) != 1 || findings[0].DraftVersion != 3 {
		t.Fatal("explicit banned phrase must be reported")
	}
	noBan := Analyze(segments, nil)
	if len(AddFindings(nil, noBan, 3)) != 0 {
		t.Fatal("uncalibrated sentence statistics blocked the draft")
	}
}
