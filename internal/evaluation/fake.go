package evaluation

import (
	"encoding/json"
	"inkloom/internal/agents/model"
	"inkloom/internal/demo"
)

// Scripted 验证评测管线能跑，不能用来报告真实模型准确率。
func Scripted(c Case) (model.ChatModel, error) {
	steps := []model.Step{}
	if c.ExpectSearch {
		steps = append(steps, model.Step{Role: "hard_consistency", FinishReason: model.ToolRequested, ToolCalls: []model.ToolCall{{ID: "eval-query", Name: "search_memory", Arguments: `{"query":"第三章 旧闸 铁锁"}`}}})
	}
	content := `{"findings":[]}`
	switch c.Expect {
	case "insufficient":
		content = `{"decision":"insufficient"}`
	case "human_lie":
		_, fixture, err := demo.Load("dialogue-lie")
		if err != nil {
			return nil, err
		}
		content = fixture[1].Content
	case "hard_conflict":
		raw, _ := json.Marshal(map[string]any{"findings": []any{map[string]any{"id": "hard-lock", "critic": "hard_consistency", "severity": "P0", "segmentId": "ch7-beat-1-seg-1", "quote": "铁锁当时已经断了", "evidenceRefs": []string{"ch7-beat-1-seg-1", c.ExpectedRule}, "reason": "前章明确记录锁完好，当前回忆相反。", "suggestion": "核对锁的状态，保留当前事件结果。", "repairScope": "beat", "draftVersion": 1, "ruleRef": c.ExpectedRule, "ruleQuote": "铁锁完好，没有断裂", "evidenceStatus": "confirmed", "possibleDialogueLie": false, "requiresHuman": false}}})
		content = string(raw)
	}
	steps = append(steps, model.Step{Role: "hard_consistency", Content: content})
	return model.NewFake(steps), nil
}
