package model

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

type Step struct {
	Role         string
	Content      string
	Purpose      Purpose
	FinishReason FinishReason
	DraftVersion int // 0 表示不约束；评审和修订演示按正文版本精确匹配。
}

// Fake 按 role/purpose/draftVersion 匹配并消费响应，不依赖 goroutine 到达顺序。
// 每个 run 独立实例；同一匹配键的多次请求仍按脚本顺序消费。
type Fake struct {
	mu    sync.Mutex
	steps []Step
	used  []bool
}

var _ ChatModel = (*Fake)(nil)

func NewFake(steps []Step) *Fake {
	return &Fake{steps: append([]Step(nil), steps...), used: make([]bool, len(steps))}
}
func (f *Fake) Generate(ctx context.Context, in Input) (Output, Usage, error) {
	if err := ctx.Err(); err != nil {
		return Output{}, Usage{}, err
	}
	var material struct {
		DraftVersion int `json:"draftVersion"`
	}
	_ = json.Unmarshal(in.Material, &material)
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, step := range f.steps {
		purpose := step.Purpose
		if purpose == "" {
			purpose = Generate
		}
		if f.used[i] || step.Role != in.Role || purpose != in.Purpose || (step.DraftVersion != 0 && step.DraftVersion != material.DraftVersion) {
			continue
		}
		f.used[i] = true
		finish := step.FinishReason
		if finish == "" {
			finish = Complete
		}
		return Output{Content: step.Content, FinishReason: finish}, Usage{Known: true}, nil
	}
	return Output{}, Usage{}, fmt.Errorf("fake has no response for role=%q purpose=%q draftVersion=%d", in.Role, in.Purpose, material.DraftVersion)
}
