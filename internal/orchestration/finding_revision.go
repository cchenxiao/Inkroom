package orchestration

import (
	"context"
	"fmt"
	"strings"

	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

// FindingProposal is a pinned replacement awaiting explicit author confirmation.
// It is persisted with the gate, but is never part of the manuscript until applied.
type FindingProposal struct {
	ID           string                   `json:"id"`
	FindingID    string                   `json:"findingId"`
	DraftVersion int                      `json:"draftVersion"`
	Request      manuscript.AuthorRewrite `json:"request"`
	Replacement  string                   `json:"replacement"`
}
type FindingChange struct {
	FindingID   string `json:"findingId"`
	SegmentID   string `json:"segmentId"`
	Before      string `json:"before"`
	After       string `json:"after"`
	FromVersion int    `json:"fromVersion"`
	ToVersion   int    `json:"toVersion"`
}

func isFindingAction(kind string) bool {
	switch kind {
	case "propose_selection", "propose_finding", "apply_finding", "discard_finding", "edit_finding":
		return true
	}
	return false
}
func validateFindingAction(s ChapterState, a HumanAction) error {
	if a.Type == "apply_finding" || a.Type == "discard_finding" {
		p := s.FindingProposal
		if p == nil || p.ID != a.ProposalID || p.DraftVersion != s.DraftVersion {
			return fmt.Errorf("修改预览已变化，请重新核对")
		}
		return p.Request.Validate(s.Segments)
	}
	if s.FindingProposal != nil {
		return fmt.Errorf("请先确认或放弃当前修改预览")
	}
	if a.Rewrite == nil {
		return fmt.Errorf("缺少问题修改范围")
	}
	if err := a.Rewrite.Validate(s.Segments); err != nil {
		return err
	}
	if a.Type == "propose_selection" {
		if a.FindingID != "" {
			return fmt.Errorf("选区修改不应绑定审查问题")
		}
		return nil
	}
	if s.Report.DraftVersion != s.DraftVersion && !s.ReviewPending {
		return fmt.Errorf("请先复审当前稿")
	}
	for _, change := range s.FindingChanges {
		if change.FindingID == a.FindingID {
			return fmt.Errorf("这条问题已修改，待统一复审")
		}
	}
	var finding *review.Finding
	for i := range s.Report.Findings {
		if s.Report.Findings[i].ID == a.FindingID {
			finding = &s.Report.Findings[i]
			break
		}
	}
	if finding == nil || finding.ID == "author-request-review" || finding.Severity != review.P3 || finding.SegmentID != a.Rewrite.SegmentID || finding.Quote == "" {
		return fmt.Errorf("此入口只处理当前稿中的单条 P3 问题")
	}
	// Local review does not silently widen to a whole beat. An expanded change uses
	// the separate full rewrite flow and its full review contract.
	quote := string([]rune(a.Rewrite.Original)[a.Rewrite.Start:a.Rewrite.End])
	if quote != finding.Quote || strings.Count(a.Rewrite.Original, quote) != 1 {
		return fmt.Errorf("问题引用已变化或不唯一，请重新选择正文")
	}
	if a.Type == "edit_finding" {
		if _, err := manuscript.ApplyAuthorReplacement(a.Rewrite.Original, *a.Rewrite, a.Text); err != nil {
			return err
		}
	}
	return nil
}
func applyFindingAction(ctx context.Context, s ChapterState, a HumanAction, chat model.ChatModel) (ChapterState, error) {
	if err := validateFindingAction(s, a); err != nil {
		return s, err
	}
	if a.Type == "propose_finding" || a.Type == "propose_selection" {
		segments, _, err := agents.RewriteAuthor(ctx, chat, s.Segments, s.Context, *a.Rewrite)
		if err != nil {
			return s, err
		}
		original := []rune(a.Rewrite.Original)
		for _, seg := range segments {
			if seg.ID == a.Rewrite.SegmentID {
				end := len([]rune(seg.Text)) - (len(original) - a.Rewrite.End)
				replacement := string([]rune(seg.Text)[a.Rewrite.Start:end])
				s.FindingProposal = &FindingProposal{ID: a.ID, FindingID: a.FindingID, DraftVersion: s.DraftVersion, Request: *a.Rewrite, Replacement: replacement}
				s.StopReason = "局部修改预览已生成，正文未变；请确认或放弃"
				return s, nil
			}
		}
		return s, fmt.Errorf("修改目标不存在")
	}
	if a.Type == "discard_finding" {
		s.FindingProposal = nil
		s.StopReason = "已放弃修改预览，正文未变"
		return s, nil
	}
	req, replacement, findingID := a.Rewrite, a.Text, a.FindingID
	if a.Type == "apply_finding" {
		req, replacement, findingID = &s.FindingProposal.Request, s.FindingProposal.Replacement, s.FindingProposal.FindingID
	}
	text, err := manuscript.ApplyAuthorReplacement(req.Original, *req, replacement)
	if err != nil {
		return s, err
	}
	s.Segments = append([]manuscript.Segment{}, s.Segments...)
	for i := range s.Segments {
		if s.Segments[i].ID == req.SegmentID {
			s.Segments[i].Text = text
			s.Segments[i].Version = s.DraftVersion + 1
		}
	}
	s.FindingChanges = append(append([]FindingChange{}, s.FindingChanges...), FindingChange{FindingID: findingID, SegmentID: req.SegmentID, Before: string([]rune(req.Original)[req.Start:req.End]), After: replacement, FromVersion: s.DraftVersion, ToVersion: s.DraftVersion + 1})
	if findingID == "" {
		request := *req
		s.AuthorRequest = &request
	}
	s.DraftVersion++
	s.ReviewPending = true
	s.FindingProposal = nil
	// Keep the previous report and IDs verbatim as a worklist, never as approval
	// evidence for this new version. Full review replaces it only on explicit request.
	s.StopReason = "局部修改已保存，其他问题保留；处理完后请统一复审"
	return s, nil
}
