// Package review 保存评审结果与确定性规则。模型提意见，程序校验意见。
package review

import (
	"fmt"
	"sort"
	"strings"

	"inkloom/internal/domain/manuscript"
)

type Severity string

const (
	P0 Severity = "P0"
	P1 Severity = "P1"
	P2 Severity = "P2"
	P3 Severity = "P3"
)

type Finding struct {
	ID           string   `json:"id"`
	Critic       string   `json:"critic"`
	Severity     Severity `json:"severity"`
	SegmentID    string   `json:"segmentId"`
	Quote        string   `json:"quote"`
	EvidenceRefs []string `json:"evidenceRefs"`
	Reason       string   `json:"reason"`
	Suggestion   string   `json:"suggestion"`
	RepairScope  string   `json:"repairScope"`
	DraftVersion int      `json:"draftVersion"`
}

type Report struct {
	DraftVersion    int       `json:"draftVersion"`
	Findings        []Finding `json:"findings"`
	HighestSeverity Severity  `json:"highestSeverity,omitempty"`
}

// Aggregate 先校验再去重排序；没有问题不等于可以跳过人工定稿。
// I0–I1 只接受本轮正文作为证据，Bible 证据校验随上下文能力扩展。
func Aggregate(findings []Finding, segments []manuscript.Segment, draftVersion int) (Report, error) {
	report := Report{DraftVersion: draftVersion, Findings: make([]Finding, 0)}
	if draftVersion < 1 {
		return report, fmt.Errorf("invalid draft version: %d", draftVersion)
	}
	byID := make(map[string]manuscript.Segment, len(segments))
	for _, segment := range segments {
		byID[segment.ID] = segment
	}
	seen := make(map[string]bool)
	for _, finding := range findings {
		if err := validate(finding, byID, draftVersion); err != nil {
			return Report{}, fmt.Errorf("finding %q: %w", finding.ID, err)
		}
		// 只去除完全相同的结论；不同 Critic、理由或建议都保留。
		key := fmt.Sprintf("%q", []string{finding.Critic, string(finding.Severity), finding.SegmentID,
			finding.Quote, finding.Reason, finding.Suggestion, finding.RepairScope, strings.Join(finding.EvidenceRefs, "\x00")})
		if !seen[key] {
			report.Findings = append(report.Findings, finding)
			seen[key] = true
		}
	}
	sort.SliceStable(report.Findings, func(i, j int) bool {
		return report.Findings[i].Severity < report.Findings[j].Severity
	})
	if len(report.Findings) > 0 {
		report.HighestSeverity = report.Findings[0].Severity
	}
	return report, nil
}

func validate(f Finding, segments map[string]manuscript.Segment, version int) error {
	if f.ID == "" || strings.TrimSpace(f.Quote) == "" || strings.TrimSpace(f.Reason) == "" || strings.TrimSpace(f.Suggestion) == "" {
		return fmt.Errorf("id, quote, reason and suggestion are required")
	}
	switch f.Severity {
	case P0, P1, P2, P3:
	default:
		return fmt.Errorf("invalid severity %q", f.Severity)
	}
	switch f.Critic {
	case "hard_consistency", "style", "ai_taste", "reader":
	default:
		return fmt.Errorf("invalid critic %q", f.Critic)
	}
	switch f.RepairScope {
	case "phrase", "segment", "scene", "beat", "outline", "cross_chapter":
	default:
		return fmt.Errorf("invalid repair scope %q", f.RepairScope)
	}
	if f.DraftVersion != version {
		return fmt.Errorf("draft version mismatch: got %d, want %d", f.DraftVersion, version)
	}
	segment, ok := segments[f.SegmentID]
	if !ok || !strings.Contains(segment.Text, f.Quote) {
		return fmt.Errorf("quote does not exist in segment %q", f.SegmentID)
	}
	if len(f.EvidenceRefs) == 0 {
		return fmt.Errorf("evidence refs are required")
	}
	for _, ref := range f.EvidenceRefs {
		if _, ok := segments[ref]; !ok {
			return fmt.Errorf("unknown evidence %q", ref)
		}
	}
	return nil
}
