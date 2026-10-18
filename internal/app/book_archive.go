package app

import (
	"fmt"
	"inkloom/internal/domain/planning"
	"inkloom/internal/domain/style"
	"strings"
)

// Archive is an author-facing projection of saved publications, not a mutable
// knowledge head. Reading/exporting it cannot invalidate adopted chapters.
type BookArchive struct {
	Scope        string                       `json:"scope"`
	Characters   map[string]string            `json:"characters"`
	InitialFacts []planning.WorldFactProposal `json:"initialFacts"`
	Chapters     []PublishedChapter           `json:"chapters"`
}
type PublishedChapter struct {
	Statistics    style.Stats            `json:"statistics"`
	Number        int                    `json:"number"`
	ChapterID     string                 `json:"chapterId"`
	Title         string                 `json:"title"`
	PublicationID string                 `json:"publicationId"`
	Version       int                    `json:"version"`
	Current       bool                   `json:"current"`
	Reason        string                 `json:"reason"`
	Text          string                 `json:"text"`
	Facts         []ConfirmedChapterFact `json:"facts"`
	ReviewID      string                 `json:"reviewId"`
	Findings      []ChapterFinding       `json:"findings"`
	KeptFindings  []string               `json:"keptFindings"`
}

func (b BookArchive) ExportText() string {
	var text strings.Builder
	for _, ch := range b.Chapters {
		fmt.Fprintf(&text, "第 %d 章 · %s\n定稿 v%d", ch.Number, ch.Title, ch.Version)
		if !ch.Current {
			text.WriteString("（历史定稿，当前修改尚未定稿）")
		}
		text.WriteString("\n\n" + ch.Text + "\n\n")
	}
	return text.String()
}
