package app

import (
	"context"
	"errors"
	"time"

	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/review"
)

var ErrContextMismatch = errors.New("frozen context mismatch or missing")
var ErrFactsUnconfirmed = errors.New("author fact confirmation required")

type FinalizeInput struct {
	ID             string `json:"id"`
	DraftVersion   int    `json:"draftVersion"`
	InputDigest    string `json:"inputDigest"`
	FactsConfirmed bool   `json:"factsConfirmed"`
}
type FactConfirmation struct {
	DraftVersion int    `json:"draftVersion"`
	Method       string `json:"method"`
	// 仅表示作者明确确认无待同步事实，不是假装模型已完成事实抽取。
	NoPendingFacts bool `json:"noPendingFacts"`
}
type FinalCommit struct {
	ID               string                     `json:"id"`
	RunID            string                     `json:"runId"`
	ProjectID        string                     `json:"projectId"`
	ChapterID        string                     `json:"chapterId"`
	BranchID         string                     `json:"branchId"`
	DraftVersion     int                        `json:"draftVersion"`
	ParentCommit     string                     `json:"parentCommit,omitempty"`
	ApprovalActionID string                     `json:"approvalActionId"`
	InputDigest      string                     `json:"inputDigest"`
	CreatedAt        time.Time                  `json:"createdAt"`
	FactConfirmation FactConfirmation           `json:"factConfirmation"`
	Manifest         manuscript.ContextManifest `json:"manifest"`
	Segments         []manuscript.Segment       `json:"segments"`
	Report           review.Report              `json:"report"`
	Refs             []manuscript.VersionRef    `json:"refs"`
}
type FinalRepository interface {
	CreatePreparingRun(context.Context, Run, manuscript.FrozenInput) error
	PreparationInput(context.Context, string) (manuscript.FrozenInput, error)
	SaveLookup(context.Context, string, memory.LookupTrace) error
	SealPreparedContext(context.Context, string, manuscript.FrozenInput) error
	LiveRepository
	CreatePreparedRun(context.Context, Run, manuscript.FrozenInput) error
	FrozenContext(context.Context, string) (manuscript.FrozenInput, error)
	Finalize(context.Context, string, FinalizeInput) (FinalCommit, error)
	Commits(context.Context, string, string) ([]FinalCommit, error)
	GetCommit(context.Context, string) (FinalCommit, error)
}
