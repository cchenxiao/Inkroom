package evaluation

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"inkloom/internal/orchestration"
)

//go:embed author_revision_cases.json
var authorRevisionCasesJSON []byte

type AuthorRevisionCase struct {
	RequiredPatterns    []string `json:"requiredPatterns,omitempty"`
	ForbiddenPatterns   []string `json:"forbiddenPatterns,omitempty"`
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	Mode                string   `json:"mode"`
	Original            string   `json:"original"`
	Instruction         string   `json:"instruction"`
	Candidate           string   `json:"candidate,omitempty"`
	Selection           string   `json:"selection,omitempty"`
	ExpectedReplacement string   `json:"expectedReplacement,omitempty"`
	Facts               []string `json:"facts"`
	After               string   `json:"after,omitempty"`
	ExpectedStatuses    []string `json:"expectedStatuses"`
}

func AuthorRevisionCases() ([]AuthorRevisionCase, error) {
	var cases []AuthorRevisionCase
	err := json.Unmarshal(authorRevisionCasesJSON, &cases)
	return cases, err
}

type RevisionCall struct {
	OutputLimit   int                `json:"outputLimit,omitempty"`
	TimeoutMS     int64              `json:"timeoutMs,omitempty"`
	Thinking      bool               `json:"thinking"`
	Role          string             `json:"role"`
	PromptVersion string             `json:"promptVersion"`
	SchemaVersion string             `json:"schemaVersion"`
	InputDigest   string             `json:"inputDigest"`
	PromptDigest  string             `json:"promptDigest"`
	Output        string             `json:"output"`
	FinishReason  model.FinishReason `json:"finishReason"`
	Usage         model.Usage        `json:"usage"`
	ElapsedMS     int64              `json:"elapsedMs"`
	Error         string             `json:"error,omitempty"`
}
type RevisionResult struct {
	TextChecksPassed        bool                `json:"textChecksPassed"`
	Case                    AuthorRevisionCase  `json:"case"`
	Candidate               string              `json:"candidate"`
	Check                   *review.AuthorCheck `json:"check,omitempty"`
	Findings                []review.Finding    `json:"findings"`
	ApprovalBlock           string              `json:"approvalBlock"`
	ScopePreserved          bool                `json:"scopePreserved"`
	OutcomeMatched          bool                `json:"outcomeMatched"`
	ExactReplacementMatched bool                `json:"exactReplacementMatched"`
	Passed                  bool                `json:"passed"`
	Error                   string              `json:"error,omitempty"`
	Calls                   []RevisionCall      `json:"calls"`
}
type RevisionReport struct {
	Dataset       string           `json:"dataset"`
	DatasetDigest string           `json:"datasetDigest"`
	Provider      string           `json:"provider"`
	Model         string           `json:"model"`
	StartedAt     time.Time        `json:"startedAt"`
	Total         int              `json:"total"`
	Attempted     int              `json:"attempted"`
	Passed        int              `json:"passed"`
	Usage         model.Usage      `json:"usage"`
	Results       []RevisionResult `json:"results"`
	Error         string           `json:"error,omitempty"`
}

// Capture only synthetic evaluation data, never credentials. Concurrent critics own their calls.
type revisionCapture struct {
	next  model.ChatModel
	mu    sync.Mutex
	calls []RevisionCall
}

func (c *revisionCapture) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	started := time.Now()
	out, usage, err := c.next.Generate(ctx, in)
	digest, _ := manuscript.ContentDigest(json.RawMessage(in.Material))
	promptDigest, _ := manuscript.ContentDigest([]string{in.SystemPrompt, in.UserPrompt})
	call := RevisionCall{OutputLimit: in.OutputTokens, TimeoutMS: in.CallTimeout.Milliseconds(), Thinking: in.Thinking, Role: in.Role, PromptVersion: in.PromptVersion, SchemaVersion: in.SchemaVersion, InputDigest: digest, PromptDigest: promptDigest, Output: out.Content, FinishReason: out.FinishReason, Usage: usage, ElapsedMS: time.Since(started).Milliseconds()}
	if err != nil {
		call.Error = err.Error()
	}
	c.mu.Lock()
	c.calls = append(c.calls, call)
	c.mu.Unlock()
	return out, usage, err
}

func revisionInput(c AuthorRevisionCase) (manuscript.ContextBundle, *manuscript.AuthorRewrite, error) {
	b := manuscript.ContextBundle{ProjectID: "revision-evaluation", ChapterID: "chapter", BranchID: "isolated", POV: "第三人称限知，沈砚", Beat: manuscript.Beat{ID: "beat", SceneID: "scene", Version: 1, Title: "核对档案", Description: "按作者要求修正当前情节段，保持事件结果。"}}
	for i, f := range c.Facts {
		b.Facts = append(b.Facts, manuscript.SourceRef{ID: fmt.Sprintf("fact-%d", i+1), Version: 1, Text: f})
	}
	original := manuscript.Segment{ID: "target", ChapterID: b.ChapterID, SceneID: b.Beat.SceneID, BeatID: b.Beat.ID, POV: b.POV, Text: c.Original, Order: 1, Version: 1}
	req := &manuscript.AuthorRewrite{SegmentID: original.ID, Original: c.Original, End: len([]rune(c.Original)), Instruction: c.Instruction}
	if c.Selection != "" {
		offset := strings.Index(c.Original, c.Selection)
		if offset < 0 || strings.Count(c.Original, c.Selection) != 1 {
			return b, nil, fmt.Errorf("ambiguous evaluation selection")
		}
		req.Start = len([]rune(c.Original[:offset]))
		req.End = req.Start + len([]rune(c.Selection))
	}
	b.Original = []manuscript.Segment{original}
	if c.After != "" {
		segments := []manuscript.Segment{{ID: "neighbor", BeatID: "after", Text: c.After, Version: 1}}
		digest, _ := manuscript.ContentDigest(segments)
		b.Neighbors = []manuscript.Passage{{BeatID: "after", Title: "后段", DraftID: "neighbor-draft", RunID: "evaluation-neighbor", Version: 1, Digest: digest, Position: "after", State: "candidate", Segments: segments}}
	}
	return b, req, req.Validate(b.Original)
}

// RunAuthorRevision uses the production author, critics and approval gate; no database writes.
// The guard is shared across the whole suite, so retries cannot reset the budget per sample.
// Expected labels stay in the grader and are never included in model material.
func RunAuthorRevision(ctx context.Context, provider, name string, limits model.Limits, next model.ChatModel, selectedIDs ...string) (report RevisionReport, runErr error) {
	report = RevisionReport{Dataset: "author-revision-v2", Provider: provider, Model: name, StartedAt: time.Now().UTC(), Results: []RevisionResult{}}
	cases, err := AuthorRevisionCases()
	if err != nil {
		return report, err
	}
	if len(selectedIDs) > 0 {
		selected := []AuthorRevisionCase{}
		for _, id := range selectedIDs {
			found := false
			for _, c := range cases {
				if c.ID == id {
					selected = append(selected, c)
					found = true
					break
				}
			}
			if !found {
				return report, fmt.Errorf("unknown author revision case %q", id)
			}
		}
		cases = selected
	}
	report.Total = len(cases)
	report.DatasetDigest, _ = manuscript.ContentDigest(cases)
	capture := &revisionCapture{next: next}
	guard := model.NewGuard(capture, limits)
	chat := prompts.Bind(guard)
	defer func() {
		report.Usage = guard.Usage()
		if runErr != nil {
			report.Error = runErr.Error()
		}
	}()
	for _, c := range cases {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		capture.mu.Lock()
		callStart := len(capture.calls)
		capture.mu.Unlock()
		r := RevisionResult{Case: c, ScopePreserved: true, ExactReplacementMatched: true, TextChecksPassed: true, Findings: []review.Finding{}}
		b, req, e := revisionInput(c)
		if e != nil {
			return report, e
		}
		var state orchestration.ChapterState
		if c.Mode == "rewrite" {
			b.Rewrite = req
			graph, err := orchestration.NewChapter(ctx, chat, orchestration.Options{BaseDraftVersion: 1, AutoRevise: false})
			if err != nil {
				return report, err
			}
			state, e = graph.Invoke(ctx, b)
			if len(state.Segments) == 1 {
				r.Candidate = state.Segments[0].Text
			} else {
				r.ScopePreserved = false
			}
			if e == nil {
				r.ScopePreserved = r.ScopePreserved && state.Segments[0].ID == req.SegmentID && strings.HasPrefix(r.Candidate, string([]rune(req.Original)[:req.Start])) && strings.HasSuffix(r.Candidate, string([]rune(req.Original)[req.End:]))
				r.Findings = state.Report.Findings
				r.ApprovalBlock = orchestration.ApprovalReason(state)
				for _, critic := range state.CriticReviews {
					if critic.Critic == "hard_consistency" {
						r.Check = critic.AuthorCheck
					}
				}
			}
		} else {
			s := b.Original[0]
			s.Text = c.Candidate
			s.Version = 2
			r.Candidate = s.Text
			r.Findings, r.Check, _, e = agents.CheckConsistencyRevision(ctx, chat, []manuscript.Segment{s}, 2, b, req)
			if e == nil {
				state = orchestration.ChapterState{AuthorRequest: req, DraftVersion: 2, Report: review.Report{DraftVersion: 2, Findings: r.Findings}, CriticReviews: []orchestration.CriticReview{{Critic: "hard_consistency", DraftVersion: 2, Status: "completed", Findings: r.Findings, AuthorCheck: r.Check}, {Critic: "ai_taste", DraftVersion: 2, Status: "completed"}}}
				// Review-only probes isolate consistency; the empty style review here is synthetic.
				r.ApprovalBlock = orchestration.ApprovalReason(state)
			}
		}
		if e != nil {
			r.Error = e.Error()
		}
		if c.ExpectedReplacement != "" {
			expected := string([]rune(req.Original)[:req.Start]) + c.ExpectedReplacement + string([]rune(req.Original)[req.End:])
			r.ExactReplacementMatched = r.Candidate == expected
		}
		if r.Check != nil {
			for _, want := range c.ExpectedStatuses {
				if r.Check.Status == want {
					r.OutcomeMatched = true
				}
			}
		}
		for _, pattern := range c.RequiredPatterns {
			matched, err := regexp.MatchString(pattern, r.Candidate)
			if err != nil {
				return report, err
			}
			r.TextChecksPassed = r.TextChecksPassed && matched
		}
		for _, pattern := range c.ForbiddenPatterns {
			matched, err := regexp.MatchString(pattern, r.Candidate)
			if err != nil {
				return report, err
			}
			r.TextChecksPassed = r.TextChecksPassed && !matched
		}
		r.Passed = r.TextChecksPassed && r.Error == "" && r.ScopePreserved && r.OutcomeMatched && r.ExactReplacementMatched
		if r.Check != nil && ((r.Check.Status != "addressed" && r.ApprovalBlock == "") || (r.Check.Status == "addressed" && r.ApprovalBlock != "")) {
			r.Passed = false
		}
		capture.mu.Lock()
		r.Calls = append([]RevisionCall{}, capture.calls[callStart:]...)
		capture.mu.Unlock()
		report.Results = append(report.Results, r)
		report.Attempted++
		if r.Passed {
			report.Passed++
		}
	}
	if report.Passed != report.Total {
		return report, fmt.Errorf("author revision evaluation: %d/%d probes passed", report.Passed, report.Total)
	}
	return report, nil
}
