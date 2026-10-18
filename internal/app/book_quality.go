package app

import (
	"inkloom/internal/domain/review"
	"inkloom/internal/domain/style"
	"time"
)

type BookQuality struct {
	Scope    string           `json:"scope"`
	Chapters []QualityChapter `json:"chapters"`
	Runs     []QualityRun     `json:"runs"`
}
type QualityChapter struct {
	ChapterID  string           `json:"chapterId"`
	Title      string           `json:"title"`
	Words      int              `json:"words"`
	Statistics style.Stats      `json:"statistics"`
	Findings   []QualityFinding `json:"findings"`
}
type QualityFinding struct {
	review.Finding
	BeatID string `json:"beatId"`
	RunID  string `json:"runId"`
	Kept   bool   `json:"kept"`
}
type QualityRun struct {
	ID          string    `json:"id"`
	ChapterID   string    `json:"chapterId"`
	BeatID      string    `json:"beatId"`
	Status      string    `json:"status"`
	Mode        string    `json:"mode"`
	Model       string    `json:"model"`
	Error       string    `json:"error"`
	Tokens      int       `json:"tokens"`
	TokensKnown bool      `json:"tokensKnown"`
	ReviseRound int       `json:"reviseRound"`
	AutoRevise  bool      `json:"autoRevise"`
	Lookup      bool      `json:"lookup"`
	CreatedAt   time.Time `json:"createdAt"`
}
