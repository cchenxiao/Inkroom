package app

import (
	"inkloom/internal/domain/knowledge"
	"inkloom/internal/domain/memory"
	"testing"
)

func TestChapterFactEvidenceAndHumanBoundary(t *testing.T) {
	in := ChapterFactsInput{ChapterID: "chapter-one", BaseKnowledge: memory.KnowledgeRef{Version: 1, Digest: "base"}, Knowledge: knowledge.Snapshot{Characters: []string{"shen", "lu"}, Facts: []knowledge.Fact{{ID: "hand", Text: "惯用左手"}}}, Review: ChapterReviewInput{Parts: []ChapterReviewPart{{CommitID: "commit", StoryTime: 10, Segments: []ChapterReviewSource{{ID: "s-1-1", Text: "陆青把铜扣交给沈砚。", SourceID: "segment", SourceVersion: 2}}}}}}
	candidate := ChapterFactCandidate{ID: "f1", Kind: "event", Text: "沈砚收到铜扣", Evidence: ChapterEvidence{Ref: "s-1-1", Quote: "陆青把铜扣交给沈砚。"}}
	out := ChapterFactsOutput{Candidates: []ChapterFactCandidate{candidate}}
	req := ChapterFactsSelectionRequest{Decisions: []ChapterFactDecision{{CandidateID: "f1", Action: "confirm", Text: candidate.Text, KnownBy: []string{"shen"}, Reason: "已核对交接动作"}}}
	pack, block, err := BuildChapterFacts(in, out, req)
	if err != nil || block != "" || len(pack.Facts) != 1 || pack.Facts[0].CommitID != "commit" || len(pack.Facts[0].KnownBy) != 1 {
		t.Fatal(pack, block, err)
	}
	req.Decisions = nil
	if _, block, err = BuildChapterFacts(in, out, req); err != nil || block == "" {
		t.Fatal("missing decision bypassed", err)
	}
	req.Decisions = []ChapterFactDecision{{CandidateID: "f1", Action: "confirm", Text: candidate.Text, KnownBy: []string{"stranger"}, Reason: "确认"}}
	if _, _, err = BuildChapterFacts(in, out, req); err == nil {
		t.Fatal("unknown character accepted")
	}
	req.Decisions[0].KnownBy = []string{}
	out.Candidates[0].Evidence.Quote = "并未出现的句子"
	if _, _, err = BuildChapterFacts(in, out, req); err == nil {
		t.Fatal("fabricated evidence accepted")
	}
	out.Candidates[0] = candidate
	out.Candidates[0].Kind = "statement"
	if _, _, err = BuildChapterFacts(in, out, req); err == nil {
		t.Fatal("dialogue promoted")
	}
	out.Candidates[0] = candidate
	out.Candidates[0].RelatedFactID = "hand"
	if _, _, err = BuildChapterFacts(in, out, req); err == nil {
		t.Fatal("existing fact overwritten")
	}
	req.Decisions[0].Action = "keep_existing"
	if pack, block, err = BuildChapterFacts(in, out, req); err != nil || block != "" || len(pack.Facts) != 0 {
		t.Fatal("keep existing", err)
	}
	req.Decisions[0].Action = "revise_manuscript"
	if _, block, err = BuildChapterFacts(in, out, req); err != nil || block == "" {
		t.Fatal("unresolved conflict not blocked", err)
	}
}

func TestAuthorCanCorrectModelClassificationWithoutOverwritingEvidenceOrOldFacts(t *testing.T) {
	in := ChapterFactsInput{Knowledge: knowledge.Snapshot{Characters: []string{"shen"}, Facts: []knowledge.Fact{{ID: "old", Text: "旧事实"}}}, Review: ChapterReviewInput{Parts: []ChapterReviewPart{{Segments: []ChapterReviewSource{{ID: "s", Text: "陆青说：“别说是渡口叫去的。”", SourceID: "segment", SourceVersion: 1}}}}}}
	for _, kind := range []string{"statement", "uncertain"} {
		out := ChapterFactsOutput{Candidates: []ChapterFactCandidate{{ID: "f", Kind: kind, Text: "陆青的叮嘱", Evidence: ChapterEvidence{Ref: "s", Quote: "陆青说：“别说是渡口叫去的。”"}}}}
		req := ChapterFactsSelectionRequest{Decisions: []ChapterFactDecision{{CandidateID: "f", Action: "confirm", Text: "陆青叮嘱沈砚不要说是渡口叫去的", Reason: "作者按原文记录言语行为"}}}
		if _, _, err := BuildChapterFacts(in, out, req); err == nil {
			t.Fatal("model classification bypassed without author correction")
		}
		for _, basis := range []string{"speech_act", "observed_event"} {
			req.Decisions[0].EventBasis = basis
			pack, block, err := BuildChapterFacts(in, out, req)
			if err != nil || block != "" || len(pack.Facts) != 1 || pack.Facts[0].Text != req.Decisions[0].Text || pack.Facts[0].Evidence != out.Candidates[0].Evidence || len(pack.Facts[0].KnownBy) != 0 {
				t.Fatal(pack, block, err)
			}
			if out.Candidates[0].Kind != kind {
				t.Fatal("original model classification was mutated")
			}
		}
		req.Decisions[0].EventBasis = "anything"
		if _, _, err := BuildChapterFacts(in, out, req); err == nil {
			t.Fatal("invalid author classification accepted")
		}
		req.Decisions[0].EventBasis = "speech_act"
		out.Candidates[0].RelatedFactID = "old"
		if _, _, err := BuildChapterFacts(in, out, req); err == nil {
			t.Fatal("author classification bypassed old-fact protection")
		}
		out.Candidates[0].RelatedFactID = ""
		out.Candidates[0].Evidence.Quote = "没有发生的对话"
		if _, _, err := BuildChapterFacts(in, out, req); err == nil {
			t.Fatal("author classification bypassed evidence validation")
		}
	}
}

func TestKnowerSuggestionsNeedCharacterAndOriginalEvidence(t *testing.T) {
	in := ChapterFactsInput{Knowledge: knowledge.Snapshot{Characters: []string{"shen"}}, Review: ChapterReviewInput{Parts: []ChapterReviewPart{{StoryTime: 10, Segments: []ChapterReviewSource{{ID: "s", Text: "沈砚亲眼看见钥匙放在桌上。"}}}, {StoryTime: 20, Segments: []ChapterReviewSource{{ID: "later", Text: "后来陆青告诉他。"}}}}}}
	c := ChapterFactCandidate{ID: "f", Kind: "event", Text: "钥匙放在桌上", Evidence: ChapterEvidence{Ref: "s", Quote: "钥匙放在桌上"}, SuggestedKnowers: []SuggestedKnower{{CharacterID: "shen", Evidence: ChapterEvidence{Ref: "s", Quote: "沈砚亲眼看见钥匙放在桌上。"}}}}
	out := ChapterFactsOutput{Candidates: []ChapterFactCandidate{c}}
	if err := ValidateChapterFactCandidates(in, out); err != nil {
		t.Fatal(err)
	}
	req := ChapterFactsSelectionRequest{Decisions: []ChapterFactDecision{{CandidateID: "f", Action: "confirm", Text: c.Text, Reason: "作者计入但未采纳知情建议", KnownBy: []string{}}}}
	pack, _, err := BuildChapterFacts(in, out, req)
	if err != nil || len(pack.Facts[0].KnownBy) != 0 {
		t.Fatal("suggestion silently approved", pack, err)
	}
	for _, bad := range []SuggestedKnower{{CharacterID: "stranger", Evidence: c.Evidence}, {CharacterID: "shen", Evidence: ChapterEvidence{Ref: "s", Quote: "伪造引文"}}, {CharacterID: "shen", Evidence: ChapterEvidence{Ref: "later", Quote: "后来陆青告诉他。"}}} {
		out.Candidates[0].SuggestedKnowers = []SuggestedKnower{bad}
		if ValidateChapterFactCandidates(in, out) == nil {
			t.Fatal("invalid suggestion accepted", bad)
		}
	}
}
