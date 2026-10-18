package app

import (
	"fmt"
	"inkloom/internal/domain/memory"
	"strings"
)

// PublicationMemory projects immutable receipts. Prose is indexed separately from
// approved facts, without guessing who knows every assertion in a whole passage.
func PublicationMemory(pub ChapterPublication, chapter int) ([]memory.Record, error) {
	project, branch, ok := strings.Cut(pub.Scope, "/")
	if !ok || chapter < 1 || pub.ID == "" || pub.Version < 1 || !pub.FactConfirmation.NoPendingFacts {
		return nil, ErrContextMismatch
	}
	out := []memory.Record{}
	if pub.FactSelection != nil {
		for _, f := range pub.FactSelection.Package.Facts {
			at := memory.Moment{Chapter: chapter, StoryTime: f.StoryTime}
			r := memory.Record{ID: "publication/" + pub.ID + "/fact/" + f.ID, ProjectID: project, BranchID: branch, Version: pub.Version, Kind: memory.Fact, Status: memory.Confirmed, ChapterID: pub.ChapterID, SegmentID: f.SegmentID, At: &at, Text: f.Text, KnownBy: []memory.Knowledge{}}
			for _, id := range f.KnownBy {
				r.KnownBy = append(r.KnownBy, memory.Knowledge{CharacterID: id, Since: &at})
			}
			out = append(out, r)
		}
	}
	for i, p := range pub.Review.Input.Parts {
		for j, s := range p.Segments {
			at := memory.Moment{Chapter: chapter, StoryTime: p.StoryTime}
			out = append(out, memory.Record{ID: fmt.Sprintf("publication/%s/passage/%d/%d", pub.ID, i, j), ProjectID: project, BranchID: branch, Version: pub.Version, Kind: memory.Passage, Status: memory.Confirmed, ChapterID: pub.ChapterID, SegmentID: s.SourceID, At: &at, Text: s.Text, KnownBy: []memory.Knowledge{}})
		}
	}
	return out, nil
}
