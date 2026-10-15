package demo

import (
	"encoding/json"
	"fmt"
	"inkloom/internal/agents/model"
)

// WithBaseVersion 只移动 Fake 脚本的相对版本；真实模型会直接看到正确的输入版本。
// 故意损坏的 JSON 保持原样，其格式修复响应再按同样规则平移。
func WithBaseVersion(steps []model.Step, base int) ([]model.Step, error) {
	if base < 0 {
		return nil, fmt.Errorf("invalid base draft version")
	}
	out := append([]model.Step{}, steps...)
	if base == 0 {
		return out, nil
	}
	var shift func(any)
	shift = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			for k, v := range x {
				if k == "draftVersion" || k == "basedOnDraftVersion" {
					if n, ok := v.(float64); ok {
						x[k] = n + float64(base)
					}
				} else {
					shift(v)
				}
			}
		case []any:
			for _, v := range x {
				shift(v)
			}
		}
	}
	for i := range out {
		if out[i].DraftVersion > 0 {
			out[i].DraftVersion += base
		}
		var value any
		if json.Unmarshal([]byte(out[i].Content), &value) != nil {
			continue
		}
		shift(value)
		raw, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		out[i].Content = string(raw)
	}
	return out, nil
}
