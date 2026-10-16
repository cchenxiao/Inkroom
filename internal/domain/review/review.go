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
	RuleRef             string   `json:"ruleRef,omitempty"`
	RuleQuote           string   `json:"ruleQuote,omitempty"`
	EvidenceStatus      string   `json:"evidenceStatus,omitempty"`
	PossibleDialogueLie bool     `json:"possibleDialogueLie,omitempty"`
	RequiresHuman       bool     `json:"requiresHuman,omitempty"`
	ID                  string   `json:"id"`
	Critic              string   `json:"critic"`
	Severity            Severity `json:"severity"`
	SegmentID           string   `json:"segmentId"`
	Quote               string   `json:"quote"`
	EvidenceRefs        []string `json:"evidenceRefs"`
	Reason              string   `json:"reason"`
	Suggestion          string   `json:"suggestion"`
	RepairScope         string   `json:"repairScope"`
	DraftVersion        int      `json:"draftVersion"`
}

type Report struct {
	DraftVersion    int       `json:"draftVersion"`
	Findings        []Finding `json:"findings"`
	HighestSeverity Severity  `json:"highestSeverity,omitempty"`
}

// Aggregate 先校验再去重排序；没有问题不等于可以跳过人工定稿。
// 调用者必须传本轮冻结事实，不能临时查询最新 Bible。
func Aggregate(findings []Finding, segments []manuscript.Segment, draftVersion int, sources ...manuscript.SourceRef) (Report, error) {
	report := Report{DraftVersion: draftVersion, Findings: make([]Finding, 0)}
	if draftVersion < 1 {
		return report, fmt.Errorf("invalid draft version: %d", draftVersion)
	}
	byID := make(map[string]manuscript.Segment, len(segments))
	for _, segment := range segments {
		byID[segment.ID] = segment
	}
	facts := make(map[string]string, len(sources))
	for _, source := range sources {
		if source.ID == "" || source.Version < 1 || source.Text == "" || facts[source.ID] != "" {
			return Report{}, fmt.Errorf("invalid source %q", source.ID)
		}
		if _, exists := byID[source.ID]; exists {
			return Report{}, fmt.Errorf("source collides with segment %q", source.ID)
		}
		facts[source.ID] = source.Text
	}
	seen := make(map[string]bool)
	ids := make(map[string]bool)
	for _, finding := range findings {
		if err := validate(finding, byID, draftVersion, facts); err != nil {
			return Report{}, fmt.Errorf("finding %q: %w", finding.ID, err)
		}
		if ids[finding.ID] {
			return Report{}, fmt.Errorf("duplicate finding id %q", finding.ID)
		}
		ids[finding.ID] = true
		// 只去除完全相同的结论；不同 Critic、理由或建议都保留。
		key := fmt.Sprintf("%q", []string{finding.Critic, string(finding.Severity), finding.SegmentID,
			finding.Quote, finding.Reason, finding.Suggestion, finding.RepairScope, strings.Join(finding.EvidenceRefs, "\x00"), finding.RuleRef, finding.RuleQuote, finding.EvidenceStatus, fmt.Sprint(finding.RequiresHuman, finding.PossibleDialogueLie)})
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

func validate(f Finding, segments map[string]manuscript.Segment, version int, facts map[string]string) error {
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
		if _, ok := segments[ref]; !ok && facts[ref] == "" {
			return fmt.Errorf("unknown evidence %q", ref)
		}
	}
	if f.Critic == "hard_consistency" {
		if f.EvidenceStatus != "confirmed" && f.EvidenceStatus != "uncertain" {
			return fmt.Errorf("missing evidence status")
		}
		if f.EvidenceStatus == "uncertain" && f.Severity != P3 {
			return fmt.Errorf("uncertain evidence may only be P3")
		}
		if f.PossibleDialogueLie && (f.Severity != P3 || !f.RequiresHuman) {
			return fmt.Errorf("possible dialogue lie needs human judgement, not a hard violation")
		}
		source := facts[f.RuleRef]
		if source == "" {
			if passage, ok := segments[f.RuleRef]; ok {
				source = passage.Text
			}
		}
		if source == "" || strings.TrimSpace(f.RuleQuote) == "" || !strings.Contains(source, f.RuleQuote) {
			return fmt.Errorf("rule quote must exist in frozen facts")
		}
		found := false
		for _, ref := range f.EvidenceRefs {
			if ref == f.RuleRef {
				found = true
			}
		}
		if !found {
			return fmt.Errorf("ruleRef must be in evidenceRefs")
		}
		if (f.Severity == P0 && f.RepairScope != "beat" && f.RepairScope != "outline" && f.RepairScope != "cross_chapter") || (f.Severity == P1 && f.RepairScope != "scene" && f.RepairScope != "segment") {
			return fmt.Errorf("severity does not match repair scope")
		}
	}
	return nil
}
