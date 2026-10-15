// Package style 计算可复核的文本特征，不把未校准统计量当质量门禁。
package style

import (
	"fmt"
	"math"
	"strings"
	"unicode"

	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

type Hit struct {
	Phrase string `json:"phrase"`
	Count  int    `json:"count"`
}
type Stats struct {
	SegmentID       string  `json:"segmentId"`
	SentenceLengths []int   `json:"sentenceLengths"`
	Mean            float64 `json:"mean"`
	Variance        float64 `json:"variance"`
	Burstiness      float64 `json:"burstiness"`
	Calibrated      bool    `json:"calibrated"`
	Hits            []Hit   `json:"hits"`
}

// Analyze 句界按中文/英文句末标点或换行；长度为非空白、非标点的 rune 数。
// burstiness=(标准差-均值)/(标准差+均值)。样本很短时仅作描述。
func Analyze(segments []manuscript.Segment, banned []string) []Stats {
	out := make([]Stats, 0, len(segments))
	for _, s := range segments {
		st := Stats{SegmentID: s.ID, SentenceLengths: []int{}, Hits: []Hit{}}
		n := 0
		flush := func() {
			if n > 0 {
				st.SentenceLengths = append(st.SentenceLengths, n)
				n = 0
			}
		}
		for _, r := range s.Text {
			if strings.ContainsRune("。！？.!?\n", r) {
				flush()
			} else if !unicode.IsSpace(r) && !unicode.IsPunct(r) {
				n++
			}
		}
		flush()
		for _, v := range st.SentenceLengths {
			st.Mean += float64(v)
		}
		if len(st.SentenceLengths) > 0 {
			st.Mean /= float64(len(st.SentenceLengths))
			for _, v := range st.SentenceLengths {
				st.Variance += math.Pow(float64(v)-st.Mean, 2)
			}
			st.Variance /= float64(len(st.SentenceLengths))
		}
		sd := math.Sqrt(st.Variance)
		if sd+st.Mean > 0 {
			st.Burstiness = (sd - st.Mean) / (sd + st.Mean)
		}
		seen := map[string]bool{}
		for _, p := range banned {
			if p != "" && !seen[p] {
				seen[p] = true
				if count := strings.Count(s.Text, p); count > 0 {
					st.Hits = append(st.Hits, Hit{p, count})
				}
			}
		}
		out = append(out, st)
	}
	return out
}

// AddFindings 使用作者明确禁用的短语作确定性 P2 依据，模型不能漏报后直接放行。
// 句长/方差没有校准阈值，不生成阻断问题。
func AddFindings(findings []review.Finding, stats []Stats, version int) []review.Finding {
	out := append([]review.Finding{}, findings...)
	for _, s := range stats {
		for i, h := range s.Hits {
			covered := false
			for _, f := range out {
				if f.SegmentID == s.SegmentID && f.Severity == review.P2 && strings.Contains(f.Quote, h.Phrase) {
					covered = true
					break
				}
			}
			if !covered {
				out = append(out, review.Finding{ID: fmt.Sprintf("rule-%s-v%d-%d", s.SegmentID, version, i), Critic: "ai_taste", Severity: review.P2, SegmentID: s.SegmentID, Quote: h.Phrase, EvidenceRefs: []string{s.SegmentID}, Reason: "命中本次风格约束的禁用短语", Suggestion: "局部删改该短语，保留事实与人物动作", RepairScope: "phrase", DraftVersion: version})
			}
		}
	}
	return out
}
