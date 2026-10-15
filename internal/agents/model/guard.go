package model

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

var ErrBudgetExhausted = errors.New("run model budget exhausted before call")

type Limits struct {
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
	return &Guard{inner: inner, limits: limits, usage: Usage{Known: true}}
}
func (g *Guard) Usage() Usage { g.mu.Lock(); defer g.mu.Unlock(); return g.usage }

func (g *Guard) Generate(ctx context.Context, in Input) (Output, Usage, error) {
	total := Usage{Known: true}
	if in.SystemPrompt == "" || in.UserPrompt == "" || in.PromptVersion == "" {
		return Output{}, total, fmt.Errorf("model prompt must be rendered before calling Guard")
	}
	for attempt := 0; attempt < 2; attempt++ {
		if err := ctx.Err(); err != nil {
			return Output{}, total, err
		}
		// UTF-8 字节数作为当前中文材料的保守估算，另预留最大输出。
		estimate := len(in.SystemPrompt) + len(in.UserPrompt) + g.limits.OutputTokens + 128
		g.mu.Lock()
		if g.calls >= g.limits.Calls || g.reserved+estimate > g.limits.Tokens {
			g.mu.Unlock()
			return Output{}, total, ErrBudgetExhausted
		}
		g.calls++
		g.reserved += estimate
		call := g.calls
		g.mu.Unlock()
		callCtx, cancel := context.WithTimeout(ctx, g.limits.Timeout)
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
		slog.InfoContext(ctx, "llm_call", "role", in.Role, "purpose", in.Purpose, "prompt_version", in.PromptVersion, "schema_version", in.SchemaVersion, "model", g.limits.ModelName, "call", call, "attempt", attempt+1, "elapsed_ms", time.Since(started).Milliseconds(), "input_tokens", usage.InputTokens, "output_tokens", usage.OutputTokens, "usage_known", usage.Known, "finish", out.FinishReason, "success", err == nil)
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
