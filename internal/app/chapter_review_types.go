package app

import (
	"fmt"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/review"
	"strings"
	"time"
)

type ChapterReviewSource struct {
	ID            string `json:"id"`
	Kind          string `json:"kind"` // passage 或 fact，正文不会自动成为世界事实。
	Text          string `json:"text"`
	SourceID      string `json:"sourceId"`
	SourceVersion int    `json:"sourceVersion"`
}
type ChapterReviewPart struct {
	BeatID    string                `json:"beatId"`
	SceneID   string                `json:"sceneId"`
	Title     string                `json:"title"`
	CommitID  string                `json:"commitId"`
	POV       string                `json:"pov"`
	StoryTime int64                 `json:"storyTime"`
	Segments  []ChapterReviewSource `json:"segments"`
	Facts     []ChapterReviewSource `json:"facts"`
}
type ChapterReviewInput struct {
	AssemblyID     string              `json:"assemblyId"`
	DraftVersion   int                 `json:"draftVersion"` // 此处是整章组稿版本，不能与 Beat draftVersion 混用。
	AssemblyDigest string              `json:"assemblyDigest"`
	Parts          []ChapterReviewPart `json:"parts"`
}
type ChapterEvidence struct {
	Ref   string `json:"ref"`
	Quote string `json:"quote"`
}
type ChapterFinding struct {
	review.Finding
	Evidence []ChapterEvidence `json:"evidence"`
}
type ChapterCriticResult struct {
	Critic   string           `json:"critic"`
	Status   string           `json:"status"`
	Findings []ChapterFinding `json:"findings"`
	Error    string           `json:"error,omitempty"`
}
type ChapterReviewOutput struct {
	Critics []ChapterCriticResult `json:"critics"`
}
type ChapterReviewRequest struct {
	RequestID       string `json:"requestId"`
	AssemblyID      string `json:"assemblyId"`
	AssemblyVersion int    `json:"assemblyVersion"`
	AssemblyDigest  string `json:"assemblyDigest"`
}
type ChapterReviewDecision struct {
	RequestID       string    `json:"requestId"`
	AssemblyVersion int       `json:"assemblyVersion"`
	InputDigest     string    `json:"inputDigest"`
	Action          string    `json:"action"` // approve | request_changes
	Reason          string    `json:"reason"`
	CreatedAt       time.Time `json:"createdAt"`
}
type ChapterReviewJob struct {
	ID            string                 `json:"id"`
	Scope         string                 `json:"scope"`
	ChapterID     string                 `json:"chapterId"`
	Status        string                 `json:"status"` // running | completed | failed | interrupted
	Request       ChapterReviewRequest   `json:"request"`
	Input         ChapterReviewInput     `json:"input"`
	InputDigest   string                 `json:"inputDigest"`
	Provider      string                 `json:"provider"`
	Model         string                 `json:"model"`
	Output        *ChapterReviewOutput   `json:"output,omitempty"`
	Message       string                 `json:"message"`
	Calls         []model.CallRecord     `json:"calls"`
	Decision      *ChapterReviewDecision `json:"decision,omitempty"`
	Current       bool                   `json:"current"` // 查询时推导；不改变历史结论。
	ApprovalBlock string                 `json:"approvalBlock"`
	CreatedAt     time.Time              `json:"createdAt"`
}

func ValidateChapterFindings(in ChapterReviewInput, role string, fs []ChapterFinding) error {
	sources := map[string]ChapterReviewSource{}
	owners := map[string]string{}
	for _, p := range in.Parts {
		for _, s := range append(append([]ChapterReviewSource{}, p.Segments...), p.Facts...) {
			if s.ID == "" || sources[s.ID].ID != "" {
				return fmt.Errorf("duplicate review source")
			}
			sources[s.ID] = s
			owners[s.ID] = p.BeatID
		}
	}
	seen := map[string]bool{}
	for _, f := range fs {
		target := sources[f.SegmentID]
		if f.ID == "" || seen[f.ID] || f.Critic != role || f.DraftVersion != in.DraftVersion || target.Kind != "passage" || strings.TrimSpace(f.Quote) == "" || !strings.Contains(target.Text, f.Quote) || strings.TrimSpace(f.Reason) == "" || strings.TrimSpace(f.Suggestion) == "" {
			return fmt.Errorf("invalid finding target, role, version or quote")
		}
		seen[f.ID] = true
		if f.Severity != review.P0 && f.Severity != review.P1 && f.Severity != review.P2 && f.Severity != review.P3 {
			return fmt.Errorf("invalid severity")
		}
		switch f.RepairScope {
		case "phrase", "segment", "scene", "beat", "outline", "cross_chapter":
		default:
			return fmt.Errorf("invalid repair scope")
		}
		if f.EvidenceStatus != "confirmed" && f.EvidenceStatus != "uncertain" {
			return fmt.Errorf("invalid evidence status")
		}
		if f.EvidenceStatus == "uncertain" && (f.Severity != review.P3 || !f.RequiresHuman) {
			return fmt.Errorf("uncertain evidence must await human judgement as P3")
		}
		if f.PossibleDialogueLie && (f.Severity != review.P3 || !f.RequiresHuman) {
			return fmt.Errorf("dialogue is not an automatic world fact")
		}
		if len(f.Evidence) == 0 || len(f.Evidence) != len(f.EvidenceRefs) {
			return fmt.Errorf("quoted evidence required")
		}
		refs := map[string]bool{}
		for i, e := range f.Evidence {
			source := sources[e.Ref]
			if source.ID == "" || refs[e.Ref] || e.Ref != f.EvidenceRefs[i] || strings.TrimSpace(e.Quote) == "" || !strings.Contains(source.Text, e.Quote) {
				return fmt.Errorf("unknown or fabricated evidence")
			}
			if role == "ai_taste" && source.Kind != "passage" {
				return fmt.Errorf("language critic cannot cite hidden facts")
			}
			if source.Kind == "fact" && owners[e.Ref] != owners[f.SegmentID] {
				return fmt.Errorf("fact is outside target POV/time snapshot")
			}
			refs[e.Ref] = true
		}
		if !refs[f.SegmentID] {
			return fmt.Errorf("target must be quoted in evidence")
		}
		if role == "hard_consistency" {
			if f.EvidenceStatus == "confirmed" && len(refs) < 2 {
				return fmt.Errorf("cross-passage or frozen-fact evidence required")
			}
			if (f.Severity == review.P0 && f.RepairScope != "beat" && f.RepairScope != "outline" && f.RepairScope != "cross_chapter") || (f.Severity == review.P1 && f.RepairScope != "scene" && f.RepairScope != "segment") {
				return fmt.Errorf("severity/scope mismatch")
			}
		} else if role == "ai_taste" {
			if f.Severity == review.P0 || f.Severity == review.P1 || (f.RepairScope != "phrase" && f.RepairScope != "segment") {
				return fmt.Errorf("language critic only suggests local changes")
			}
		} else {
			return fmt.Errorf("unsupported chapter critic")
		}
	}
	return nil
}
func ChapterReviewBlock(j ChapterReviewJob) string {
	if !j.Current {
		return "章稿、来源或复审批次已更新，旧审批失效"
	}
	if j.Status != "completed" || j.Output == nil || len(j.Output.Critics) != 2 {
		return "两路整章复审尚未完整完成"
	}
	seen := map[string]bool{}
	for _, c := range j.Output.Critics {
		if seen[c.Critic] || (c.Critic != "hard_consistency" && c.Critic != "ai_taste") || c.Status != "completed" {
			return "两路整章复审尚未完整完成"
		}
		seen[c.Critic] = true
		for _, f := range c.Findings {
			if f.Severity != review.P3 || f.RequiresHuman || f.PossibleDialogueLie {
				return "仍有待修订或待裁决的问题，请改稿后重新组稿复审"
			}
		}
	}
	return ""
}

type ChapterReviewState struct {
	Current bool               `json:"current"`
	Reason  string             `json:"reason"`
	Jobs    []ChapterReviewJob `json:"jobs"`
}
