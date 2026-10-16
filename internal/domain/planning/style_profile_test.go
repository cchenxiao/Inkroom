package planning

import "testing"

func TestStyleRulesRejectInvalidTargets(t *testing.T) {
	rules := StyleRules{POV: "第三人称限知", Tense: "过去时", Tone: "克制", SentenceLength: NumberRange{5, 35}, DialogueRatio: NumberRange{0.1, 0.5}}
	if err := rules.Validate(); err != nil {
		t.Fatal(err)
	}
	rules.DialogueRatio.Max = 1.1
	if rules.Validate() == nil {
		t.Fatal("dialogue ratio above 1 accepted")
	}
	rules.DialogueRatio.Max = 0.5
	rules.SentenceLength.Min = 40
	if rules.Validate() == nil {
		t.Fatal("reversed range accepted")
	}
}
