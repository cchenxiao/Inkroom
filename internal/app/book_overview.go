package app

import "inkloom/internal/domain/planning"

// BookOverview exposes current persisted progress; absent reviews never imply a passed gate.
type BookOverview struct {
	Scope             string                     `json:"scope"`
	Name              string                     `json:"name"`
	Premise           string                     `json:"premise"`
	Genre             string                     `json:"genre"`
	TargetWords       string                     `json:"targetWords"`
	NextSection       string                     `json:"nextSection"`
	CurrentChapterID  string                     `json:"currentChapterId"`
	NextStage         string                     `json:"nextStage"`
	Confirmed         map[string]bool            `json:"confirmed"`
	Chapters          []BookChapter              `json:"chapters"`
	Characters        []planning.CharacterDesign `json:"characters"`
	Plans             []planning.FuturePlan      `json:"plans"`
	Style             *planning.StyleRules       `json:"style"`
	AcceptedWords     int                        `json:"acceptedWords"`
	FinalizedChapters int                        `json:"finalizedChapters"`
	DoneBeats         int                        `json:"doneBeats"`
	TotalBeats        int                        `json:"totalBeats"`
}
type BookChapter struct {
	ID                    string `json:"id"`
	Title                 string `json:"title"`
	Act                   string `json:"act"`
	Number                int    `json:"number"`
	TargetWords           int    `json:"targetWords"`
	Status                string `json:"status"` // planned | drafting | in_review | human | finalized | stale
	Reason                string `json:"reason"`
	AcceptedWords         int    `json:"acceptedWords"`
	DoneBeats             int    `json:"doneBeats"`
	TotalBeats            int    `json:"totalBeats"`
	ReviewSummary         string `json:"reviewSummary"`
	HistoricalPublication bool   `json:"historicalPublication"`
}
