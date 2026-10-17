package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

var ErrBudgetExhausted = errors.New("run model budget exhausted before call")

type Limits struct {
	ConsistencyOutputTokens     int
	ConsistencyTimeout          time.Duration
	History                     []CallRecord
	OnCall                      func(context.Context, CallRecord) error
	Calls, Tokens, OutputTokens int
	Timeout                     time.Duration
	ModelName                   string
}
type Guard struct {
	inner           ChatModel
	limits          Limits
	mu              sync.Mutex
	calls, reserved int
	usage           Usage
}

func NewGuard(inner ChatModel, limits Limits) *Guard {
	g := &Guard{inner: inner, limits: limits, usage: Usage{Known: true}}
	for _, c := range limits.History {
		if c.Number > g.calls {
			g.calls = c.Number
		}
		g.usage.InputTokens += c.Usage.InputTokens
		g.usage.OutputTokens += c.Usage.OutputTokens
		known := c.Phase == "finished" && c.Usage.Known
		g.usage.Known = g.usage.Known && known
		if known {
			g.reserved += c.Usage.InputTokens + c.Usage.OutputTokens
		} else if c.ReservedTokens > 0 {
			g.reserved += c.ReservedTokens
		} else {
			g.reserved += limits.Tokens
		}
	}
	return g
}
func (g *Guard) Usage() Usage { g.mu.Lock(); defer g.mu.Unlock(); return g.usage }

func (g *Guard) Generate(ctx context.Context, in Input) (Output, Usage, error) {
	total := Usage{Known: true}
	if in.SystemPrompt == "" || in.UserPrompt == "" || in.PromptVersion == "" {
		return Output{}, total, fmt.Errorf("model prompt must be rendered before calling Guard")
	}
	in.OutputTokens, in.CallTimeout = g.limits.OutputTokens, g.limits.Timeout
	if in.Role == "hard_consistency" || in.Role == "chapter_consistency" {
		if g.limits.ConsistencyOutputTokens > 0 {
			in.OutputTokens = g.limits.ConsistencyOutputTokens
		}
		if g.limits.ConsistencyTimeout > 0 {
			in.CallTimeout = g.limits.ConsistencyTimeout
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		if err := ctx.Err(); err != nil {
			return Output{}, total, err
		}
		// UTF-8 字节数作为当前中文材料的保守估算，另预留最大输出。
		history, _ := json.Marshal(in.Messages)
		tools, _ := json.Marshal(in.Tools)
		estimate := len(history) + len(tools) + len(in.SystemPrompt) + len(in.UserPrompt) + in.OutputTokens + 128
		g.mu.Lock()
		if g.calls >= g.limits.Calls || g.reserved+estimate > g.limits.Tokens {
			g.mu.Unlock()
			return Output{}, total, ErrBudgetExhausted
		}
		g.calls++
		g.reserved += estimate
		call := g.calls
		g.mu.Unlock()
		record := CallRecord{StartedAt: time.Now().UTC(), TimeoutMs: in.CallTimeout.Milliseconds(), OutputLimit: in.OutputTokens, Activity: callActivity(in), Thinking: in.Thinking, ReservedTokens: estimate, Number: call, Attempt: attempt + 1, Role: in.Role, Purpose: in.Purpose, PromptVersion: in.PromptVersion, SchemaVersion: in.SchemaVersion, Model: g.limits.ModelName, Phase: "started"}
		if g.limits.OnCall != nil {
			if err := g.limits.OnCall(ctx, record); err != nil {
				return Output{}, total, fmt.Errorf("record model call intent: %w", err)
			}
		}
		callCtx, cancel := context.WithTimeout(ctx, in.CallTimeout)
		started := time.Now()
		out, usage, err := g.inner.Generate(callCtx, in)
		if callCtx.Err() != nil && err == nil {
			err = callCtx.Err()
		}
		cancel()
		total.InputTokens += usage.InputTokens
		total.OutputTokens += usage.OutputTokens
		total.Known = total.Known && usage.Known
		g.mu.Lock()
		if usage.Known {
			g.reserved += usage.InputTokens + usage.OutputTokens - estimate
		}
		g.usage.InputTokens += usage.InputTokens
		g.usage.OutputTokens += usage.OutputTokens
		g.usage.Known = g.usage.Known && usage.Known
		g.mu.Unlock()
		slog.InfoContext(ctx, "llm_call", "role", in.Role, "purpose", in.Purpose, "prompt_version", in.PromptVersion, "schema_version", in.SchemaVersion, "thinking", in.Thinking, "model", g.limits.ModelName, "call", call, "attempt", attempt+1, "elapsed_ms", time.Since(started).Milliseconds(), "input_tokens", usage.InputTokens, "output_tokens", usage.OutputTokens, "usage_known", usage.Known, "finish", out.FinishReason, "success", err == nil && (out.FinishReason == Complete || out.FinishReason == ToolRequested))
		record.Phase = "finished"
		record.ElapsedMs = time.Since(started).Milliseconds()
		record.Usage = usage
		record.FinishReason = out.FinishReason
		record.Success = err == nil && (out.FinishReason == Complete || out.FinishReason == ToolRequested)
		if g.limits.OnCall != nil {
			if saveErr := g.limits.OnCall(ctx, record); saveErr != nil {
				return Output{}, total, fmt.Errorf("record model call outcome: %w", saveErr)
			}
		}
		if err == nil {
			return out, total, nil
		}
		var provider *ProviderError
		// 只对明确的限流/服务不可用重试一次；超时结果未知，不自动重复付费调用。
		if attempt == 1 || !errors.As(err, &provider) || (provider.Status != 429 && provider.Status != 503) {
			return Output{}, total, err
		}
		timer := time.NewTimer(500 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return Output{}, total, ctx.Err()
		case <-timer.C:
		}
	}
	panic("unreachable")
}

func callActivity(in Input) string {
	if in.Purpose == Repair {
		return "format_repair"
	}
	if in.Role != "hard_consistency" && in.Role != "chapter_consistency" {
		return ""
	}
	var body struct {
		Pass          bool             `json:"continuityPass"`
		Focus         string           `json:"focus"`
		AuthorRequest *json.RawMessage `json:"authorRequest"`
	}
	_ = json.Unmarshal(in.Material, &body)
	if body.Pass {
		switch body.Focus {
		case "objects":
			return "continuity_objects"
		case "characters":
			return "continuity_characters"
		default:
			return "continuity"
		}
	}
	if body.AuthorRequest != nil {
		return "author_verification"
	}
	return "consistency"
}
