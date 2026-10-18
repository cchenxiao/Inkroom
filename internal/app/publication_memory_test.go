package app

import (
	"inkloom/internal/domain/memory"
	"testing"
)

func TestPublicationMemoryKeepsFactsProseAndKnowledgeSeparate(t *testing.T) {
	pub := ChapterPublication{ID: "pub", Scope: "book/main", ChapterID: "chapter-one", Version: 2, FactConfirmation: FactConfirmation{NoPendingFacts: true}, FactSelection: &ChapterFactsSelection{Package: ChapterFactPackage{Facts: []ConfirmedChapterFact{{ID: "known", Text: "钥匙已归还", StoryTime: 20, SegmentID: "s", KnownBy: []string{"shen"}}, {ID: "unknown", Text: "秘密", StoryTime: 20, SegmentID: "s"}}}}, Review: ChapterReviewJob{Input: ChapterReviewInput{Parts: []ChapterReviewPart{{StoryTime: 20, Segments: []ChapterReviewSource{{SourceID: "s", Text: "陆青说的话并非全是真相"}}}}}}}
	records, err := PublicationMemory(pub, 1)
	if err != nil || len(records) != 3 {
		t.Fatal(records, err)
	}
	v := memory.View{CatalogBound: true, ProjectID: "book", BranchID: "main", POV: "shen", At: memory.Moment{Chapter: 2, StoryTime: 30}, Pins: map[string]memory.Pin{}}
	for _, r := range records {
		v.Pins[r.ID] = memory.Pin{Version: r.Version, Digest: memory.Digest(r)}
	}
	selected, err := memory.Select(v, records)
	if err != nil || len(selected.CharacterContext) != 1 || selected.CharacterContext[0].Text != "钥匙已归还" {
		t.Fatal("unknown or prose promoted to knowledge", selected, err)
	}
	author, err := memory.SelectForAuthor(v, records)
	if err != nil || len(author.CharacterContext) != 3 {
		t.Fatal("author cannot inspect published prose", author, err)
	}
	// Author visibility never changes the immutable knowledge metadata.
	selected, err = memory.Select(v, records)
	if err != nil || len(selected.CharacterContext) != 1 {
		t.Fatal("author search expanded character knowledge", selected, err)
	}
	v.At.StoryTime = 10
	selected, err = memory.Select(v, records)
	if err != nil || len(selected.CharacterContext) != 0 {
		t.Fatal("future knowledge leaked", selected, err)
	}
	pub.FactConfirmation.NoPendingFacts = false
	if _, err = PublicationMemory(pub, 1); err == nil {
		t.Fatal("unconfirmed publication indexed")
	}
}
