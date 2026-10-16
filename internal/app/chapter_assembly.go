package app

import (
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/planning"
	"time"
)

// 章稿与单 Beat commit 分开：组装本身不运行 Critic，也不授予整章定稿资格。
type AssemblyChoice struct {
	CommitID     string    `json:"commitId"`
	DraftVersion int       `json:"draftVersion"`
	CreatedAt    time.Time `json:"createdAt"`
	Eligible     bool      `json:"eligible"`
	Reason       string    `json:"reason"`
}
type AssemblyPart struct {
	SceneID      string               `json:"sceneId"`
	SceneTitle   string               `json:"sceneTitle"`
	BeatID       string               `json:"beatId"`
	BeatTitle    string               `json:"beatTitle"`
	CommitID     string               `json:"commitId"`
	DraftVersion int                  `json:"draftVersion"`
	Segments     []manuscript.Segment `json:"segments"`
}
type AssemblySlot struct {
	Part    AssemblyPart     `json:"part"`
	Choices []AssemblyChoice `json:"choices"`
	Reason  string           `json:"reason"`
}
type ChapterAssembly struct {
	ID          string                       `json:"id"`
	Scope       string                       `json:"scope"`
	ChapterID   string                       `json:"chapterId"`
	Title       string                       `json:"title"`
	Version     int                          `json:"version"`
	Status      string                       `json:"status"` // 本阶段固定 awaiting_chapter_review。
	Expected    planning.ChapterPlanVersions `json:"expected"`
	PlanVersion int                          `json:"planVersion"`
	Knowledge   *memory.KnowledgeRef         `json:"knowledge"`
	Parts       []AssemblyPart               `json:"parts"`
	Digest      string                       `json:"digest"`
	CreatedAt   time.Time                    `json:"createdAt"`
}
type AssemblyPreviewRequest struct {
	ChapterID string            `json:"chapterId"`
	Choices   map[string]string `json:"choices"` // Beat → immutable commit。省略时取最新有效提交。
}
type AssemblySaveRequest struct {
	RequestID       string            `json:"requestId"`
	ChapterID       string            `json:"chapterId"`
	Choices         map[string]string `json:"choices"`
	ExpectedVersion int               `json:"expectedVersion"`
	PreviewDigest   string            `json:"previewDigest"`
	Confirm         bool              `json:"confirm"`
}
type AssemblyPreview struct {
	Ready           bool              `json:"ready"`
	Reason          string            `json:"reason"`
	ExpectedVersion int               `json:"expectedVersion"`
	PreviewDigest   string            `json:"previewDigest"`
	Slots           []AssemblySlot    `json:"slots"`
	Draft           ChapterAssembly   `json:"draft"`
	History         []ChapterAssembly `json:"history"`
}
