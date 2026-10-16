package app

import (
	"context"
	"errors"
	"time"

	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/review"
	"inkloom/internal/orchestration"
)

var ErrVersionMismatch = errors.New("draft version mismatch")
var ErrRunBusy = errors.New("run already active")
var ErrNotFound = errors.New("record not found")
var ErrGateBlocked = errors.New("human action blocked")
var ErrActionMismatch = errors.New("action id reused with different content")

var ErrInvalidWrite = errors.New("invalid draft write")

type Run struct {
	Planning          *PlannedRunSource           `json:"planning,omitempty"`
	CriticLookups     []CriticLookup              `json:"criticLookups,omitempty"`
	Lookup            *memory.LookupTrace         `json:"lookup,omitempty"`
	InputDigest       string                      `json:"inputDigest,omitempty"`
	CommitID          string                      `json:"commitId,omitempty"`
	EventSequence     int64                       `json:"eventSequence"`
	ActiveRoles       []string                    `json:"activeRoles"`
	CanResume         bool                        `json:"canResume"`
	ApprovalBlock     string                      `json:"approvalBlock,omitempty"`
	InstructionBlock  string                      `json:"instructionBlock,omitempty"`
	PendingAction     *orchestration.HumanAction  `json:"pendingAction,omitempty"`
	MaxCalls          int                         `json:"maxCalls"`
	MaxTokens         int                         `json:"maxTokens"`
	BaseDraftVersion  int                         `json:"baseDraftVersion"`
	CreatedAt         time.Time                   `json:"createdAt"`
	AllowLocalRewrite bool                        `json:"allowLocalRewrite"`
	Scenario          string                      `json:"scenario"`
	AutoRevise        bool                        `json:"autoRevise"`
	Usage             model.Usage                 `json:"usage"`
	ID                string                      `json:"id"`
	ChapterID         string                      `json:"chapterId"`
	BranchID          string                      `json:"branchId"`
	DraftVersion      int                         `json:"draftVersion"`
	Status            string                      `json:"status"`
	CurrentNode       string                      `json:"currentNode"`
	ReviseRound       int                         `json:"reviseRound"`
	MaxRounds         int                         `json:"maxRounds"`
	Tokens            int                         `json:"tokens"`
	ElapsedMs         int64                       `json:"elapsedMs"`
	Nodes             []any                       `json:"nodes"`
	Provider          string                      `json:"provider"`
	Model             string                      `json:"model"`
	Result            *orchestration.ChapterState `json:"result,omitempty"`
	Error             string                      `json:"error,omitempty"`
}

// Draft 的稿本版本与段落版本不同：未修改的段保留自身版本。
type Draft struct {
	ChapterID    string               `json:"chapterId"`
	BranchID     string               `json:"branchId"`
	DraftVersion int                  `json:"draftVersion"`
	Segments     []manuscript.Segment `json:"segments"`
	Findings     []review.Finding     `json:"findings"`
	Reviewed     bool                 `json:"reviewed"`
	Origin       string               `json:"origin"`
	CreatedAt    time.Time            `json:"createdAt"`
}

type VersionInfo struct {
	DraftVersion int       `json:"draftVersion"`
	Origin       string    `json:"origin"`
	CreatedAt    time.Time `json:"createdAt"`
}

// Repository 属于用例边界；HTTP 与 Agent 均不直接拼 SQL。
type Repository interface {
	CreateRun(context.Context, Run) error
	GetRun(context.Context, string) (Run, error)
	ListRuns(context.Context) ([]Run, error)
	SaveProgress(context.Context, Run, int) error
	StopRun(context.Context, string, string, string) error
	Draft(context.Context, string, string, int) (Draft, error)
	Versions(context.Context, string, string) ([]VersionInfo, error)
	EditSegment(context.Context, string, string, string, int, string) (Draft, error)
	RecordCall(context.Context, string, model.CallRecord) error
	Calls(context.Context, string) ([]model.CallRecord, error)
}

// HumanRepository 在 I6 Repository 之外增加人审事务；不把 Eino checkpoint 字节交给浏览器。
type HumanRepository interface {
	Repository
	Checkpoint(context.Context, string) ([]byte, bool, error)
	SaveCheckpoint(context.Context, string, []byte, orchestration.ChapterState, string) error
	ClaimAction(context.Context, string, orchestration.HumanAction) (Run, bool, error)
	LoadArtifact(context.Context, string, string) (orchestration.ChapterState, bool, error)
	CommitArtifact(context.Context, string, string, string, int, orchestration.ChapterState, string) error
	Approve(context.Context, string, string, int) error
}
