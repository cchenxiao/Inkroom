package planning

import (
	"strings"
	"testing"
)

func TestAnalysisSamplingIsBoundedAndEvidenceMustComeFromSample(t *testing.T) {
	in, err := NewStyleAnalysisInput("参考片段", strings.Repeat("前", 10000)+strings.Repeat("中", 10000)+strings.Repeat("尾", 10000))
	if err != nil {
		t.Fatal(err)
	}
	if in.TotalCharacters != 30000 || in.AnalyzedCharacters != 3000 || len(in.Samples) != 3 {
		t.Fatal("coverage must be explicit and bounded")
	}
	for _, s := range in.Samples {
		if s.End-s.Start != len([]rune(s.Text)) {
			t.Fatal("invalid character offsets")
		}
	}
	out := StyleAnalysisOutput{Limitations: "样本观察不是全文判断", Observations: []StyleObservation{{Dimension: "rhythm", SampleIndex: 0, Quote: "前", Reason: "解释", Suggestion: "建议", Certainty: "tentative"}}, AnchorText: "前", Rules: StyleRules{POV: "待确认", Tense: "待确认", Tone: "待确认", SentenceLength: NumberRange{Min: 8, Max: 30}, DialogueRatio: NumberRange{Min: 0, Max: 1}}}
	if err := out.Validate(in); err != nil {
		t.Fatal(err)
	}
	out.Observations[0].Quote = "并不存在的引文"
	if out.Validate(in) == nil {
		t.Fatal("invented evidence accepted")
	}
	if _, err = NewStyleAnalysisInput("", strings.Repeat("字", 30001)); err == nil {
		t.Fatal("oversized text silently truncated")
	}
}
