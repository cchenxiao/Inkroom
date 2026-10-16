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
