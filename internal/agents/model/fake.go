package model

import (
	"context"
	"fmt"
)

type Step struct {
	Role         string
	Content      string
	Purpose      Purpose
	FinishReason FinishReason
}

// Fake 按脚本返回响应，不生成真实文本，也不消耗模型 token。
// 当前只用于串行图，每次 run 新建实例；I5 并行评审前改为按请求匹配。
type Fake struct {
	steps []Step
	next  int
}

var _ ChatModel = (*Fake)(nil)

func NewFake(steps []Step) *Fake {
	return &Fake{steps: append([]Step(nil), steps...)}
}

func (f *Fake) Generate(ctx context.Context, in Input) (Output, Usage, error) {
	if err := ctx.Err(); err != nil {
		return Output{}, Usage{}, err
	}
	if f.next >= len(f.steps) {
		return Output{}, Usage{}, fmt.Errorf("fake script exhausted for %q", in.Role)
	}
	step := f.steps[f.next]
	if step.Role != in.Role {
		return Output{}, Usage{}, fmt.Errorf("fake expected role %q, got %q", step.Role, in.Role)
	}
	purpose := step.Purpose
	if purpose == "" {
		purpose = Generate
	}
	if in.Purpose != purpose {
		return Output{}, Usage{}, fmt.Errorf("fake expected purpose %q, got %q", purpose, in.Purpose)
	}
	f.next++
	finish := step.FinishReason
	if finish == "" {
		finish = Complete
	}
	return Output{Content: step.Content, FinishReason: finish}, Usage{Known: true}, nil
}
