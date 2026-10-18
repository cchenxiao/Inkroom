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
	EnhancedContinuity bool                `json:"enhancedContinuity,omitempty"`
	AssemblyID         string              `json:"assemblyId"`
	DraftVersion       int                 `json:"draftVersion"` // 此处是整章组稿版本，不能与 Beat draftVersion 混用。
	AssemblyDigest     string              `json:"assemblyDigest"`
	Parts              []ChapterReviewPart `json:"parts"`
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
	Failure  *ChapterReviewFailure `json:"failure,omitempty"`
	Critic   string                `json:"critic"`
	Status   string                `json:"status"`
	Findings []ChapterFinding      `json:"findings"`
	Error    string                `json:"error,omitempty"`
}
type ChapterReviewOutput struct {
	Critics []ChapterCriticResult `json:"critics"`
}
type ChapterReviewRequest struct {
	EnhancedContinuity bool   `json:"enhancedContinuity,omitempty"`
	RequestID          string `json:"requestId"`
	AssemblyID         string `json:"assemblyId"`
	AssemblyVersion    int    `json:"assemblyVersion"`
	AssemblyDigest     string `json:"assemblyDigest"`
}
type ChapterReviewDecision struct {
	KeptFindings    []string  `json:"keptFindings,omitempty"`
	RequestID       string    `json:"requestId"`
	AssemblyVersion int       `json:"assemblyVersion"`
	InputDigest     string    `json:"inputDigest"`
	Action          string    `json:"action"` // approve | request_changes
	Reason          string    `json:"reason"`
	CreatedAt       time.Time `json:"createdAt"`
}
type ChapterReviewJob struct {
	Failure                  *ChapterReviewFailure  `json:"failure,omitempty"`
	CanApproveAfterJudgement bool                   `json:"canApproveAfterJudgement"`
	ID                       string                 `json:"id"`
	Scope                    string                 `json:"scope"`
	ChapterID                string                 `json:"chapterId"`
	Status                   string                 `json:"status"` // running | completed | failed | interrupted
	Request                  ChapterReviewRequest   `json:"request"`
	Input                    ChapterReviewInput     `json:"input"`
	InputDigest              string                 `json:"inputDigest"`
	Provider                 string                 `json:"provider"`
	Model                    string                 `json:"model"`
	Output                   *ChapterReviewOutput   `json:"output,omitempty"`
	Message                  string                 `json:"message"`
	Calls                    []model.CallRecord     `json:"calls"`
	Decision                 *ChapterReviewDecision `json:"decision,omitempty"`
	Current                  bool                   `json:"current"` // 查询时推导；不改变历史结论。
	ApprovalBlock            string                 `json:"approvalBlock"`
	CreatedAt                time.Time              `json:"createdAt"`
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
	for index, f := range fs {
		target := sources[f.SegmentID]
		if f.ID == "" || seen[f.ID] || f.Critic != role || f.DraftVersion != in.DraftVersion || target.Kind != "passage" || strings.TrimSpace(f.Quote) == "" || !strings.Contains(target.Text, f.Quote) || strings.TrimSpace(f.Reason) == "" || strings.TrimSpace(f.Suggestion) == "" {
			return findingError(index, "finding_invalid", fmt.Sprintf("第 %d 条意见的目标段落、角色、版本或原文引用不匹配。", index+1))
		}
		seen[f.ID] = true
		if f.Severity != review.P0 && f.Severity != review.P1 && f.Severity != review.P2 && f.Severity != review.P3 {
			return findingError(index, "invalid_severity", fmt.Sprintf("第 %d 条意见：问题等级不符合审查约定。", index+1))
		}
		switch f.RepairScope {
		case "phrase", "segment", "scene", "beat", "outline", "cross_chapter":
		default:
			return findingError(index, "invalid_repair_scope", fmt.Sprintf("第 %d 条意见：修改范围不符合审查约定。", index+1))
		}
		if f.EvidenceStatus != "confirmed" && f.EvidenceStatus != "uncertain" {
			return findingError(index, "invalid_evidence_status", fmt.Sprintf("第 %d 条意见：证据确认状态无效。", index+1))
		}
		if f.EvidenceStatus == "uncertain" && (f.Severity != review.P3 || !f.RequiresHuman) {
			return findingError(index, "uncertain_evidence_must_await_human_judgement_as_P3", fmt.Sprintf("第 %d 条意见：不确定证据必须标记为待作者判断的 P3 建议。", index+1))
		}
		if f.PossibleDialogueLie && (f.Severity != review.P3 || !f.RequiresHuman) {
			return findingError(index, "dialogue_is_not_an_automatic_world_fact", fmt.Sprintf("第 %d 条意见：疑似不实台词不能直接判定为世界事实。", index+1))
		}
		if len(f.Evidence) == 0 || len(f.Evidence) != len(f.EvidenceRefs) {
			return findingError(index, "quoted_evidence_required", fmt.Sprintf("第 %d 条意见：缺少逐字证据，或证据数量与引用列表不一致。", index+1))
		}
		refs := map[string]bool{}
		for i, e := range f.Evidence {
			source := sources[e.Ref]
			if source.ID == "" {
				return findingError(index, "evidence_source_unknown", fmt.Sprintf("第 %d 条意见引用了本次章稿中不存在的证据来源（证据 %d）。", index+1, i+1))
			}
			if refs[e.Ref] {
				return findingError(index, "evidence_source_duplicate", fmt.Sprintf("第 %d 条意见重复引用同一证据来源（证据 %d）；重复引用不能算作独立证据。", index+1, i+1))
			}
			if e.Ref != f.EvidenceRefs[i] {
				return findingError(index, "evidence_order_mismatch", fmt.Sprintf("第 %d 条意见的证据编号与引用列表顺序不一致（证据 %d）。", index+1, i+1))
			}
			if strings.TrimSpace(e.Quote) == "" || !strings.Contains(source.Text, e.Quote) {
				return findingError(index, "evidence_quote_mismatch", fmt.Sprintf("第 %d 条意见的证据 %d 无法在对应原文中逐字找到，不能作为审查依据。", index+1, i+1))
			}
			if role == "ai_taste" && source.Kind != "passage" {
				return findingError(index, "language_critic_cannot_cite_hidden_facts", fmt.Sprintf("第 %d 条意见：语言审查引用了未提供给它的事实材料。", index+1))
			}
			if source.Kind == "fact" && owners[e.Ref] != owners[f.SegmentID] {
				return findingError(index, "fact_is_outside_target_POV_time_snapshot", fmt.Sprintf("第 %d 条意见：引用事实超出了该段人物视角或故事时间范围。", index+1))
			}
			refs[e.Ref] = true
		}
		if !refs[f.SegmentID] {
			return findingError(index, "target_must_be_quoted_in_evidence", fmt.Sprintf("第 %d 条意见：证据列表未包含问题所指的正文段。", index+1))
		}
		if role == "hard_consistency" {
			if f.EvidenceStatus == "confirmed" && len(refs) < 2 {
				return findingError(index, "cross-passage_or_frozen-fact_evidence_required", fmt.Sprintf("第 %d 条意见：确定的一致性问题缺少另一段正文或确认事实作为证据。", index+1))
			}
			if (f.Severity == review.P0 && f.RepairScope != "beat" && f.RepairScope != "outline" && f.RepairScope != "cross_chapter") || (f.Severity == review.P1 && f.RepairScope != "scene" && f.RepairScope != "segment") {
				return findingError(index, "severity_scope_mismatch", fmt.Sprintf("第 %d 条意见：问题等级与修改范围不匹配。", index+1))
			}
		} else if role == "ai_taste" {
			if f.Severity == review.P0 || f.Severity == review.P1 || (f.RepairScope != "phrase" && f.RepairScope != "segment") {
				return findingError(index, "language_critic_only_suggests_local_changes", fmt.Sprintf("第 %d 条意见：语言审查给出了超出局部建议权限的问题等级或修改范围。", index+1))
			}
		} else {
			return findingError(index, "unsupported_chapter_critic", fmt.Sprintf("第 %d 条意见：审查角色不受支持。", index+1))
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
			if f.Severity != review.P3 || ((f.RequiresHuman || f.PossibleDialogueLie) && !chapterFindingKept(j, c.Critic+"/"+f.ID)) {
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

func chapterFindingKept(j ChapterReviewJob, key string) bool {
	d := j.Decision
	if d == nil || d.Action != "approve" || d.AssemblyVersion != j.Input.DraftVersion || d.InputDigest != j.InputDigest {
		return false
	}
	for _, k := range d.KeptFindings {
		if k == key {
			return true
		}
	}
	return false
}

// Exposes the server gate outcome after explicit P3 judgements. No hard issue,
// incomplete review or stale source can be bypassed by a client checkbox.
func ChapterReviewCanJudge(j ChapterReviewJob) bool {
	if ChapterReviewBlock(j) == "" || j.Output == nil {
		return false
	}
	d := ChapterReviewDecision{Action: "approve", AssemblyVersion: j.Input.DraftVersion, InputDigest: j.InputDigest}
	for _, c := range j.Output.Critics {
		for _, f := range c.Findings {
			if f.Severity == review.P3 {
				d.KeptFindings = append(d.KeptFindings, c.Critic+"/"+f.ID)
			}
		}
	}
	j.Decision = &d
	return ChapterReviewBlock(j) == ""
}
func ValidateChapterJudgements(j ChapterReviewJob, d ChapterReviewDecision) error {
	allowed := map[string]bool{}
	if j.Output != nil {
		for _, c := range j.Output.Critics {
			for _, f := range c.Findings {
				if f.Severity == review.P3 {
					allowed[c.Critic+"/"+f.ID] = true
				}
			}
		}
	}
	seen := map[string]bool{}
	for _, key := range d.KeptFindings {
		if !allowed[key] || seen[key] {
			return ErrInvalidWrite
		}
		seen[key] = true
	}
	return nil
}
