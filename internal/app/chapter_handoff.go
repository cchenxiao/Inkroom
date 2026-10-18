package app

import (
	"fmt"
	"inkloom/internal/contextassembly"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/planning"
	"strings"
)

// Only immutable, author-finalized receipts cross a chapter boundary. A newer
// working draft does not silently replace a published chapter's handoff.
func chapterHandoff(scope string, p planning.ChapterPlanSelection, history []ChapterPublication) (contextassembly.PreviousChapter, []manuscript.PublicationRef, int, error) {
	var previous contextassembly.PreviousChapter
	index := -1
	for i, ch := range p.Input.Outline.Content.Chapters {
		if ch.ID == p.ChapterID {
			index = i
			break
		}
	}
	if index < 0 {
		return previous, nil, 0, ErrVersionMismatch
	}
	if len(history) != index {
		return previous, nil, 0, fmt.Errorf("请先完成前面章节的整章定稿，再继续本章")
	}
	refs := []manuscript.PublicationRef{}
	for i, pub := range history {
		if pub.ID == "" || pub.Scope != scope || pub.ChapterID != p.Input.Outline.Content.Chapters[i].ID || pub.Version < 1 || !pub.FactConfirmation.NoPendingFacts || pub.Review.Decision == nil || pub.Review.Decision.Action != "approve" {
			return previous, nil, 0, fmt.Errorf("第 %d 章尚无有效的作者定稿", i+1)
		}
		refs = append(refs, manuscript.PublicationRef{ID: pub.ID, ChapterID: pub.ChapterID, Version: pub.Version})
	}
	if index > 0 {
		pub := history[index-1]
		var text []string
		for _, part := range pub.Assembly.Parts {
			for _, segment := range part.Segments {
				text = append(text, segment.Text)
			}
		}
		ending := []rune(strings.TrimSpace(strings.Join(text, "\n")))
		if len(ending) == 0 {
			return previous, nil, 0, fmt.Errorf("前章定稿正文为空，请核对定稿记录")
		}
		if len(ending) > 1200 {
			ending = ending[len(ending)-1200:]
		}
		project, branch, _ := strings.Cut(scope, "/")
		previous = contextassembly.PreviousChapter{ProjectID: project, BranchID: branch, Confirmed: true, Source: manuscript.SourceRef{ID: "publication/" + pub.ID + "/ending", Version: pub.Version, Text: string(ending)}}
	}
	return previous, refs, index + 1, nil
}

// Narrative history is not character knowledge: only author-confirmed facts
// with an explicit knower and a reached story time enter this POV's facts.
func appendChapterFacts(b *manuscript.ContextBundle, history []ChapterPublication) {
	for _, pub := range history {
		if pub.FactSelection == nil {
			continue
		}
		for _, f := range pub.FactSelection.Package.Facts {
			if f.StoryTime > b.WritingTask.StoryTime {
				continue
			}
			for _, id := range f.KnownBy {
				if id == b.POVCharacterID {
					b.Facts = append(b.Facts, manuscript.SourceRef{ID: "publication/" + pub.ID + "/fact/" + f.ID, Version: pub.Version, Text: f.Text})
					break
				}
			}
		}
	}
}
