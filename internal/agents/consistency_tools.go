package agents

import (
	"context"
	"encoding/json"
	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/contextlookup"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/review"
	"inkloom/internal/retrieval"
)

// CheckConsistencyTools 冷读正文；不接收 Writer 历史、规划或其他 Critic 意见。
// 查询结果在进入模型前再次校验，最终问题只能引用明确事实。
func CheckConsistencyTools(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, version int, bundle manuscript.ContextBundle, search contextlookup.Search, observe func(memory.LookupTrace, *memory.RetrievalContext, []review.Finding) error) (findings []review.Finding, evidence *memory.RetrievalContext, trace memory.LookupTrace, usage model.Usage, err error) {
	material, err := json.Marshal(struct {
		DraftVersion int                         `json:"draftVersion"`
		Segments     []manuscript.Segment        `json:"segments"`
		Characters   []manuscript.CharacterFacts `json:"characters"`
		Facts        []manuscript.SourceRef      `json:"facts"`
	}{version, segments, bundle.Characters, bundle.ExplicitFacts()})
	if err != nil {
		return
	}
	schema, _ := json.Marshal(map[string]any{"oneOf": []any{json.RawMessage(contracts.ConsistencySchema), map[string]any{"type": "object", "properties": map[string]any{"decision": map[string]any{"const": "insufficient"}}, "required": []string{"decision"}, "additionalProperties": false}}})
	in := model.Input{Role: "hard_consistency", Purpose: model.Generate, Task: "先检查正文是否引用了输入中没有依据的具体前情。有这种断言时，先调用 search_memory 核对再出结论；材料已有对应依据或无须前情核对时可直接评审。最多3次查询。查证结束后输出 findings，不输出 ready。", Material: material, OutputSchema: schema}
	checkedSearch := func(ctx context.Context, q string) (retrieval.Result, error) {
		r, e := search(ctx, q)
		if e != nil {
			return r, e
		}
		_, e = bundle.WithReviewEvidence(&r.Context)
		return r, e
	}
	_, usage, err = contextlookup.Execute(ctx, chat, in, checkedSearch, func(t memory.LookupTrace, r retrieval.Result) error {
		trace = t
		if r.Context.Query != "" {
			c := r.Context
			evidence = &c
		}
		if observe != nil {
			return observe(t, evidence, findings)
		}
		return nil
	}, func(out model.Output, r retrieval.Result) error {
		var decision map[string]json.RawMessage
		if json.Unmarshal([]byte(out.Content), &decision) == nil && len(decision) == 1 && string(decision["decision"]) == `"insufficient"` {
			return contextlookup.ErrInsufficient
		}

		var e *memory.RetrievalContext
		if r.Context.Query != "" {
			e = &r.Context
		}
		b, err := bundle.WithReviewEvidence(e)
		if err != nil {
			return err
		}
		parsed, err := parse.Decode[contracts.CriticOutput](out, contracts.ConsistencySchema, func(out contracts.CriticOutput) error {
			_, err := review.Aggregate(out.Findings, segments, version, b.FactSources()...)
			return err
		})
		if err == nil {
			findings = parsed.Findings
		}
		return err
	})
	return
}
