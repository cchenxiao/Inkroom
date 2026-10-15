// Package evaluation 执行固定教学样本；期望标签只给评分器，不给 Agent。
package evaluation

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/contextlookup"
	"inkloom/internal/demo"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/review"
	"inkloom/internal/retrieval"
	"time"
)

//go:embed critic_cases.json
var casesJSON []byte

//go:embed critic_memory.json
var memoryJSON []byte

type Case struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Scenario     string   `json:"scenario"`
	Text         string   `json:"text"`
	MemoryIDs    []string `json:"memoryIds"`
	ExpectSearch bool     `json:"expectSearch"`
	Expect       string   `json:"expect"`
	ExpectedRule string   `json:"expectedRule,omitempty"`
}
type Result struct {
	ID              string             `json:"id"`
	Name            string             `json:"name"`
	ExpectSearch    bool               `json:"expectSearch"`
	Expected        string             `json:"expected"`
	InputDigest     string             `json:"inputDigest"`
	PromptVersion   string             `json:"promptVersion"`
	PromptDigest    string             `json:"promptDigest"`
	SchemaVersion   string             `json:"schemaVersion"`
	Calls           int                `json:"calls"`
	Usage           model.Usage        `json:"usage"`
	Trace           memory.LookupTrace `json:"trace"`
	Findings        []review.Finding   `json:"findings"`
	Error           string             `json:"error,omitempty"`
	QueryMatched    bool               `json:"queryMatched"`
	OutcomeMatched  bool               `json:"outcomeMatched"`
	UnsafeEmptyPass bool               `json:"unsafeEmptyPass"`
	Passed          bool               `json:"passed"`
}
type Report struct {
	Dataset       string      `json:"dataset"`
	DatasetDigest string      `json:"datasetDigest"`
	Provider      string      `json:"provider"`
	Model         string      `json:"model"`
	SearchMode    string      `json:"searchMode"`
	Variant       string      `json:"variant"`
	StartedAt     time.Time   `json:"startedAt"`
	Passed        int         `json:"passed"`
	Total         int         `json:"total"` // 全部计划样本数，提前中止也不缩小分母
	Attempted     int         `json:"attempted"`
	Error         string      `json:"error,omitempty"`
	Usage         model.Usage `json:"usage"`
	Results       []Result    `json:"results"`
}

type Factory func(Case) (model.ChatModel, error)

// Run 复用生产 Critic/工具循环/关键词检索；唯一替换是只读内存仓储。
// 数据集失败返回完整报告和错误，绝不通过吞掉样本来提高分数。
func Run(ctx context.Context, provider, name string, limits model.Limits, factory Factory, candidate bool) (report Report, runErr error) {
	defer func() {
		if runErr != nil {
			report.Error = runErr.Error()
		}
	}()
	report = Report{Dataset: "critic-lookup-v1", Provider: provider, Model: name, SearchMode: "controlled-corpus/production-keyword", StartedAt: time.Now().UTC(), Usage: model.Usage{Known: true}, Results: []Result{}}
	report.Variant = "current"
	if candidate {
		report.Variant = "candidate"
	}
	var cases []Case
	if err := json.Unmarshal(casesJSON, &cases); err != nil {
		return report, err
	}
	var records []memory.Record
	err := json.Unmarshal(memoryJSON, &records)
	if err != nil {
		return report, err
	}
	report.Total = len(cases)
	type prepared struct {
		c        Case
		bundle   manuscript.ContextBundle
		segments []manuscript.Segment
		repo     *corpus
		digest   string
	}
	inputs := make([]prepared, 0, len(cases))
	datasetInputs := []string{}
	for _, c := range cases {
		b, _, err := demo.Load(c.Scenario)
		if err != nil {
			return report, err
		}
		b.POVCharacterID = "character-shenyan"
		segments := []manuscript.Segment{{ID: "ch7-beat-1-seg-1", ChapterID: b.ChapterID, SceneID: b.Beat.SceneID, BeatID: b.Beat.ID, Text: c.Text, Version: 1, POV: b.POV}}
		repo := &corpus{snapshot: retrieval.Snapshot{Pins: map[string]memory.Pin{}, Origins: map[string]retrieval.Origin{}}}
		for _, id := range c.MemoryIDs {
			found := false
			for _, r := range records {
				if r.ID == id {
					found = true
					repo.snapshot.Records = append(repo.snapshot.Records, r)
					repo.snapshot.Pins[id] = memory.Pin{Version: r.Version, Digest: memory.Digest(r)}
					repo.snapshot.Origins[id] = retrieval.Origin{Kind: "teaching_seed"}
				}
			}
			if !found {
				return report, fmt.Errorf("case %s: unknown memory %s", c.ID, id)
			}
		}
		digest, err := manuscript.ContentDigest(struct {
			Case    Case
			Bundle  manuscript.ContextBundle
			Records []memory.Record
		}{c, b, repo.snapshot.Records})
		if err != nil {
			return report, err
		}
		datasetInputs = append(datasetInputs, digest)
		inputs = append(inputs, prepared{c: c, bundle: b, segments: segments, repo: repo, digest: digest})
	}
	report.DatasetDigest, err = manuscript.ContentDigest(datasetInputs)
	if err != nil {
		return report, err
	}
	for _, input := range inputs {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		c, b, segments, repo, digest := input.c, input.bundle, input.segments, input.repo, input.digest
		result := Result{ID: c.ID, Name: c.Name, ExpectSearch: c.ExpectSearch, Expected: c.Expect, InputDigest: digest}
		chat, err := factory(c)
		if err != nil {
			return report, err
		}
		record := &capture{next: chat, result: &result}
		localLimits := limits
		localLimits.History = nil
		localLimits.OnCall = nil
		guard := model.NewGuard(record, localLimits)
		search := retrieval.Service{Repo: repo}
		view := memory.View{ProjectID: b.ProjectID, BranchID: b.BranchID, POV: b.POVCharacterID, At: memory.Moment{Chapter: 7, StoryTime: 420}}
		prompted := prompts.Bind(guard)
		if candidate {
			prompted = prompts.BindConsistencyCandidate(guard)
		}
		fs, _, trace, _, err := agents.CheckConsistencyTools(ctx, prompted, segments, 1, b, func(ctx context.Context, q string) (retrieval.Result, error) { return search.Search(ctx, view, q, 3) }, nil)
		result.Findings, result.Trace, result.Usage = fs, trace, guard.Usage()
		if err != nil && !errors.Is(err, contextlookup.ErrInsufficient) {
			result.Error = err.Error()
		}
		grade(c, &result)
		report.Attempted++
		if result.Passed {
			report.Passed++
		}
		report.Usage.InputTokens += result.Usage.InputTokens
		report.Usage.OutputTokens += result.Usage.OutputTokens
		report.Usage.Known = report.Usage.Known && result.Usage.Known
		report.Results = append(report.Results, result)
		if ctx.Err() != nil {
			return report, ctx.Err()
		}
	}
	if report.Passed != report.Total {
		return report, fmt.Errorf("critic evaluation: %d/%d samples passed", report.Passed, report.Total)
	}
	return report, nil
}

func grade(c Case, r *Result) {
	// 工具请求即代表模型决定查证；执行是否成功另外由 trace/status 与 Error 表达。
	queried := len(r.Trace.Steps) > 0
	r.QueryMatched = queried == c.ExpectSearch
	r.UnsafeEmptyPass = c.Expect != "clear" && r.Trace.Stop == "ready" && len(r.Findings) == 0 && r.Error == ""
	r.OutcomeMatched = false
	switch c.Expect {
	case "clear":
		r.OutcomeMatched = r.Trace.Stop == "ready" && len(r.Findings) == 0
	case "insufficient":
		r.OutcomeMatched = r.Trace.Stop == "insufficient" && len(r.Findings) == 0
	case "hard_conflict":
		// 固定样本只包含这一处冲突；额外结论也需计作误报。
		r.OutcomeMatched = r.Trace.Stop == "ready" && len(r.Findings) == 1
		for _, f := range r.Findings {
			r.OutcomeMatched = r.OutcomeMatched && f.Severity == review.P0 && f.RuleRef == c.ExpectedRule && f.EvidenceStatus == "confirmed"
		}
	case "human_lie":
		r.OutcomeMatched = r.Trace.Stop == "ready" && len(r.Findings) == 1
		for _, f := range r.Findings {
			r.OutcomeMatched = r.OutcomeMatched && f.Severity == review.P3 && f.RuleRef == c.ExpectedRule && f.EvidenceStatus == "uncertain" && f.PossibleDialogueLie && f.RequiresHuman
		}
	}
	r.Passed = r.Error == "" && r.QueryMatched && r.OutcomeMatched
}

type capture struct {
	next   model.ChatModel
	result *Result
}

func (c *capture) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	c.result.Calls++
	c.result.PromptVersion = in.PromptVersion
	c.result.SchemaVersion = in.SchemaVersion
	c.result.PromptDigest, _ = manuscript.ContentDigest(in.SystemPrompt)
	return c.next.Generate(ctx, in)
}

type corpus struct{ snapshot retrieval.Snapshot }

func (c *corpus) MemorySnapshot(context.Context, memory.View) (retrieval.Snapshot, error) {
	return c.snapshot, nil
}
func (c *corpus) CachedVectors(context.Context, []string, string) (map[string][]float32, error) {
	return nil, fmt.Errorf("evaluation forbids embedding")
}
func (c *corpus) SaveVector(context.Context, string, string, []float32) error {
	return fmt.Errorf("evaluation is read-only")
}
func (c *corpus) Nearest(context.Context, []string, string, []float32, int) ([]retrieval.Ranked, error) {
	return nil, fmt.Errorf("evaluation forbids embedding")
}
