package evaluation

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/domain/manuscript"
	"strings"
	"time"
)

//go:embed continuity_cases.json
var continuityCasesJSON []byte

//go:embed continuity_compact_cases.json
var continuityCompactCasesJSON []byte

//go:embed continuity_quantity_cases.json
var continuityQuantityCasesJSON []byte

type ContinuityCase struct {
	ID               string   `json:"id"`
	Texts            []string `json:"texts"`
	ExpectedSegment  int      `json:"expectedSegment"`
	RequiredEvidence string   `json:"requiredEvidence,omitempty"`
}
type ContinuityResult struct {
	Case       ContinuityCase               `json:"case"`
	Assessment agents.ConsistencyAssessment `json:"assessment"`
	Passed     bool                         `json:"passed"`
	Calls      []RevisionCall               `json:"calls"`
	Error      string                       `json:"error,omitempty"`
}
type ContinuityReport struct {
	DatasetTotal    int                `json:"datasetTotal"`
	SelectedCases   []string           `json:"selectedCases,omitempty"`
	MaxCalls        int                `json:"maxCalls"`
	MaxTokens       int                `json:"maxTokens"`
	MaxOutputTokens int                `json:"maxOutputTokens"`
	CallTimeoutMS   int64              `json:"callTimeoutMs"`
	ReviewMode      string             `json:"reviewMode"`
	StartedAt       time.Time          `json:"startedAt"`
	Model           string             `json:"model"`
	DatasetDigest   string             `json:"datasetDigest"`
	Total           int                `json:"total"`
	Passed          int                `json:"passed"`
	Results         []ContinuityResult `json:"results"`
	Usage           model.Usage        `json:"usage"`
}

func RunContinuity(ctx context.Context, name string, limits model.Limits, next model.ChatModel, selectedIDs ...string) (report ContinuityReport, err error) {
	return runContinuityDataset(ctx, name, limits, next, continuityCasesJSON, selectedIDs...)
}

// RunCompactContinuity evaluates the separately versioned 2,000–3,000 character pair.
// The original long-form stress dataset is kept unchanged.
func RunCompactContinuity(ctx context.Context, name string, limits model.Limits, next model.ChatModel, selectedIDs ...string) (ContinuityReport, error) {
	return runContinuityDataset(ctx, name, limits, next, continuityCompactCasesJSON, selectedIDs...)
}
func RunQuantityContinuity(ctx context.Context, name string, limits model.Limits, next model.ChatModel, selectedIDs ...string) (ContinuityReport, error) {
	return runContinuityDataset(ctx, name, limits, next, continuityQuantityCasesJSON, selectedIDs...)
}
func runContinuityDataset(ctx context.Context, name string, limits model.Limits, next model.ChatModel, dataset []byte, selectedIDs ...string) (report ContinuityReport, err error) {
	var cases []ContinuityCase
	if err = json.Unmarshal(dataset, &cases); err != nil {
		return report, err
	}
	report = ContinuityReport{MaxCalls: limits.Calls, MaxTokens: limits.Tokens, MaxOutputTokens: limits.OutputTokens, CallTimeoutMS: limits.Timeout.Milliseconds(), ReviewMode: "parallel-focused-narrative-pairs-v3", StartedAt: time.Now().UTC(), Model: name, Total: len(cases), Results: []ContinuityResult{}}
	if limits.ConsistencyOutputTokens > 0 {
		report.MaxOutputTokens = limits.ConsistencyOutputTokens
	}
	if limits.ConsistencyTimeout > 0 {
		report.CallTimeoutMS = limits.ConsistencyTimeout.Milliseconds()
	}
	report.DatasetDigest, _ = manuscript.ContentDigest(cases)
	report.DatasetTotal = len(cases)
	if len(selectedIDs) > 0 {
		chosen := []ContinuityCase{}
		for _, id := range selectedIDs {
			found := false
			for _, c := range cases {
				if c.ID == id {
					chosen = append(chosen, c)
					found = true
					break
				}
			}
			if !found {
				return report, fmt.Errorf("unknown continuity case %q", id)
			}
		}
		cases = chosen
		report.SelectedCases = append([]string{}, selectedIDs...)
		report.Total = len(cases)
	}

	capture := &revisionCapture{next: next}
	guard := model.NewGuard(capture, limits)
	chat := prompts.Bind(guard)
	defer func() { report.Usage = guard.Usage() }()
	for _, c := range cases {
		b := ChapterWorkflowInput().Targets[0]
		b.WritingTask.ExperimentalContinuity = true
		b.Targets = nil
		ss := []manuscript.Segment{}
		for i, text := range c.Texts {
			target := b
			target.Targets = nil
			target.Beat.ID = fmt.Sprintf("beat-%d", i)
			task := *target.WritingTask
			task.Brief.SelectedBeatID = target.Beat.ID
			target.WritingTask = &task
			b.Targets = append(b.Targets, target)
			ss = append(ss, manuscript.Segment{ID: fmt.Sprintf("s%d", i), BeatID: target.Beat.ID, SceneID: b.Beat.SceneID, ChapterID: b.ChapterID, Text: text, Order: i + 1, Version: 1})
		}
		capture.mu.Lock()
		start := len(capture.calls)
		capture.mu.Unlock()
		a, _, e := agents.CheckNarrativeContinuity(ctx, chat, ss, 1, b)
		r := ContinuityResult{Case: c, Assessment: a}
		if e != nil {
			r.Error = e.Error()
		} else {
			if c.ExpectedSegment < 0 {
				r.Passed = len(a.Findings) == 0
				for _, ch := range a.Continuity {
					r.Passed = r.Passed && ch.Status == "clear"
				}
			} else {
				for _, f := range a.Findings {
					if f.SegmentID == ss[c.ExpectedSegment].ID && (f.Severity == "P1" || f.RequiresHuman) && strings.Contains(f.Quote+f.RuleQuote, c.RequiredEvidence) {
						r.Passed = true
					}
				}
			}
		}
		capture.mu.Lock()
		r.Calls = append([]RevisionCall{}, capture.calls[start:]...)
		capture.mu.Unlock()
		report.Results = append(report.Results, r)
		if r.Passed {
			report.Passed++
		}
	}
	if report.Passed != report.Total {
		return report, fmt.Errorf("continuity evaluation: %d/%d cases passed", report.Passed, report.Total)
	}
	return report, nil
}
