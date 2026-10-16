package app

import "time"

// ChapterPublicationRequest binds the author's fact confirmation to one approved review.
// This increment does not extract facts or write story events into the knowledge base.
type ChapterPublicationRequest struct {
	RequestID       string `json:"requestId"`
	ReviewID        string `json:"reviewId"`
	AssemblyVersion int    `json:"assemblyVersion"`
	InputDigest     string `json:"inputDigest"`
	ApprovalID      string `json:"approvalId"`
	NoPendingFacts  bool   `json:"noPendingFacts"`
}

// ChapterPublication is an immutable whole-chapter receipt, separate from a Beat commit.
// Assembly and Review are saved snapshots; Current is derived separately on every read.
type ChapterPublication struct {
	ID                  string                    `json:"id"`
	Scope               string                    `json:"scope"`
	ChapterID           string                    `json:"chapterId"`
	Version             int                       `json:"version"`
	ParentPublicationID string                    `json:"parentPublicationId,omitempty"`
	Request             ChapterPublicationRequest `json:"request"`
	Assembly            ChapterAssembly           `json:"assembly"`
	Review              ChapterReviewJob          `json:"review"`
	FactConfirmation    FactConfirmation          `json:"factConfirmation"`
	CreatedAt           time.Time                 `json:"createdAt"`
}
type ChapterPublicationState struct {
	Publication *ChapterPublication `json:"publication"`
	Current     bool                `json:"current"`
	Reason      string              `json:"reason"`
}
