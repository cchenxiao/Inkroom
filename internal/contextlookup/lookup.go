// Package contextlookup 在确定性装配之前执行有界工具循环；模型不能直接访问仓库。
package contextlookup

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"inkloom/internal/agents/model"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/retrieval"
)

type Search func(context.Context, string) (retrieval.Result, error)
type Observe func(memory.LookupTrace) error

var tool = model.ToolDefinition{Name: "search_memory", Description: "查当前作品、分支和POV可见的前情；范围由服务端固定。空结果不是事实不存在的证明。", Parameters: json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","minLength":1,"maxLength":500}},"required":["query"],"additionalProperties":false}`)}
var finalSchema = json.RawMessage(`{"type":"object","properties":{"decision":{"type":"string","enum":["ready","insufficient"]}},"required":["decision"],"additionalProperties":false}`)

// Run 最多3次工具请求、4次模型决策（第三次查询后仍需决定是否足够）。
// Guard 另限制实际模型调用/重试/token。任何失败都不允许开始 Writer。
func Run(ctx context.Context, chat model.ChatModel, bundle manuscript.ContextBundle, search Search, observe Observe) (result retrieval.Result, err error) {
	raw, err := json.Marshal(bundle)
	if err != nil {
		return result, err
	}
	in, err := prompts.Render(model.Input{Role: "context_assembler", Purpose: model.Generate, Task: "检查固定材料；如有必要查询前情，最后明确 ready 或 insufficient。", Material: raw, OutputSchema: finalSchema})
	if err != nil {
		return result, err
	}
	result, _, err = Execute(ctx, chat, in, search, func(trace memory.LookupTrace, _ retrieval.Result) error {
		if observe != nil {
			return observe(trace)
		}
		return nil
	}, func(out model.Output, _ retrieval.Result) error {
		var final struct {
			Decision string `json:"decision"`
		}
		if e := decode(out.Content, &final); e != nil || (final.Decision != "ready" && final.Decision != "insufficient") {
			return fmt.Errorf("invalid context decision")
		}
		if final.Decision == "insufficient" {
			return ErrInsufficient
		}
		return nil
	})
	return result, err
}

// ErrInsufficient 表示模型明确要求补充材料，不是空 findings 通过。
var ErrInsufficient = fmt.Errorf("context remains insufficient; author input required")
var ErrNoNewSources = fmt.Errorf("two searches produced no new sources; author input required")
var ErrToolLimit = fmt.Errorf("context tool limit reached (3)")
var ErrInvalidToolRequest = fmt.Errorf("tool name, arguments, ID or duplicate query rejected")

// Execute 是共享的有界工具循环。finish 校验各角色自己的最终输出，observe 仅接收公开行为及实际检索结果。
func Execute(ctx context.Context, chat model.ChatModel, in model.Input, search Search, observe func(memory.LookupTrace, retrieval.Result) error, finish func(model.Output, retrieval.Result) error) (result retrieval.Result, usage model.Usage, err error) {
	usage.Known = true
	trace := memory.LookupTrace{Steps: []memory.LookupStep{}}
	emit := func() error {
		if observe != nil {
			return observe(trace, result)
		}
		return nil
	}
	defer func() {
		if err != nil && trace.Stop == "" {
			trace.Stop = "blocked"
		}
		if e := emit(); e != nil {
			err = e
		}
	}()
	in.Tools = []model.ToolDefinition{tool}
	queries := map[string]bool{}
	ids := map[string]bool{}
	seen := map[string]string{}
	noGain := 0
	for decision := 0; decision < 4; decision++ {
		if e := ctx.Err(); e != nil {
			return result, usage, e
		}
		out, used, e := chat.Generate(ctx, in)
		usage.InputTokens += used.InputTokens
		usage.OutputTokens += used.OutputTokens
		usage.Known = usage.Known && used.Known
		if e != nil {
			return result, usage, e
		}
		if out.FinishReason == model.Complete && len(out.ToolCalls) == 0 {
			if e := finish(out, result); e != nil {
				if e == ErrInsufficient {
					trace.Stop = "insufficient"
				}
				return result, usage, e
			}
			trace.Stop = "ready"
			return result, usage, nil
		}
		if out.FinishReason != model.ToolRequested || len(out.ToolCalls) != 1 {
			return result, usage, fmt.Errorf("expected exactly one native tool call")
		}
		if len(trace.Steps) >= 3 {
			trace.Stop = "limit"
			return result, usage, ErrToolLimit
		}
		call := out.ToolCalls[0]
		step := memory.LookupStep{CallID: call.ID, Status: "rejected", Refs: []memory.LookupRef{}}
		var args struct {
			Query string `json:"query"`
		}
		valid := call.Name == tool.Name && call.ID != "" && len(call.ID) <= 128 && !ids[call.ID] && len(call.Arguments) <= 4096 && decode(call.Arguments, &args) == nil
		q := strings.TrimSpace(args.Query)
		key := strings.ToLower(strings.Join(strings.Fields(q), " "))
		valid = valid && len(q) > 0 && len(q) <= 2000 && len([]rune(q)) <= 500 && !queries[key]
		// 不记录越权参数原文。有效查询文本才进入日志。
		if valid {
			step.Query = q
			step.Status = "started"
		}
		trace.Steps = append(trace.Steps, step)
		if e := emit(); e != nil {
			return result, usage, e
		}
		if !valid {
			trace.Stop = "rejected"
			return result, usage, ErrInvalidToolRequest
		}
		queries[key] = true
		ids[call.ID] = true
		lookup, stop := context.WithTimeout(ctx, 10*time.Second)
		found, e := search(lookup, q)
		stop()
		n := len(trace.Steps) - 1
		if e != nil {
			trace.Steps[n].Status = "failed"
			return result, usage, e
		}
		// 稳定目录中同一来源不能在多轮查询里突然换版。
		for _, h := range found.Context.Hits {
			if old, ok := seen[h.Record.ID]; ok && old != h.Digest {
				return result, usage, fmt.Errorf("source changed during context lookup")
			}
			trace.Steps[n].Refs = append(trace.Steps[n].Refs, memory.LookupRef{ID: h.Record.ID, Version: h.Record.Version, Digest: h.Digest})
			if _, ok := seen[h.Record.ID]; !ok {
				seen[h.Record.ID] = h.Digest
				result.Context.Hits = append(result.Context.Hits, h)
				trace.Steps[n].NewSources++
			}
		}
		hits := result.Context.Hits
		if len(trace.Steps) == 1 {
			result.Context = found.Context
			result.Context.Query = q
		} else {
			result.Context.Query += "\n" + q
		}
		result.Context.Hits = hits
		result.Excluded = found.Excluded
		result.VisibleCount = found.VisibleCount
		trace.Steps[n].Status = "completed"
		if trace.Steps[n].NewSources == 0 {
			noGain++
		} else {
			noGain = 0
		}
		if e := emit(); e != nil {
			return result, usage, e
		}
		if noGain >= 2 {
			trace.Stop = "no_gain"
			return result, usage, ErrNoNewSources
		}
		// 只把筛选后的实际返回记录交给模型；不传被排除的文本或诊断详情。
		response, _ := json.Marshal(struct {
			Hits      []memory.Hit `json:"hits"`
			Remaining int          `json:"remainingCalls"`
		}{found.Context.Hits, 3 - len(trace.Steps)})
		if len(response) > 16000 {
			return result, usage, fmt.Errorf("tool result exceeds context limit")
		}
		in.Messages = append(in.Messages, model.Message{Role: "assistant", ToolCalls: out.ToolCalls}, model.Message{Role: "tool", ToolCallID: call.ID, Content: string(response)})
	}
	trace.Stop = "limit"
	return result, usage, fmt.Errorf("context decision limit reached")
}
func decode(raw string, out any) error {
	if len(raw) > 4096 {
		return fmt.Errorf("JSON too large")
	}
	d := json.NewDecoder(strings.NewReader(raw))
	d.DisallowUnknownFields()
	if e := d.Decode(out); e != nil {
		return e
	}
	if d.Decode(new(any)) != io.EOF {
		return fmt.Errorf("expected one JSON object")
	}
	return nil
}
