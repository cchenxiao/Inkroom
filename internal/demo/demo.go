// Package demo 放离线演示材料，与生产 Agent 逻辑隔离。
package demo

import (
	_ "embed"
	"encoding/json"
	"fmt"

	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
)

//go:embed chapter.json
var chapter []byte

var Scenarios = []string{
	"normal", "no-findings", "bad-json-repaired", "writer-repaired",
	"repair-exhausted", "repair-invalid-quote", "missing-field", "invalid-enum",
	"invalid-scope", "invalid-version", "invalid-quote", "refused", "truncated", "empty",
}

func Load(scenario string) (manuscript.ContextBundle, []model.Step, error) {
	var fixture struct {
		Context manuscript.ContextBundle `json:"context"`
		Writer  json.RawMessage          `json:"writer"`
		Critic  json.RawMessage          `json:"critic"`
	}
	if err := json.Unmarshal(chapter, &fixture); err != nil {
		return manuscript.ContextBundle{}, nil, fmt.Errorf("load demo: %w", err)
	}
	writer := model.Step{Role: "writer", Content: string(fixture.Writer)}
	critic := model.Step{Role: "ai_taste", Content: string(fixture.Critic)}
	steps := []model.Step{writer}
	var repair *model.Step
	switch scenario {
	case "normal":
	case "no-findings":
		critic.Content = `{"findings":[]}`
	case "bad-json-repaired", "repair-exhausted", "repair-invalid-quote":
		critic.Content = "```json\n" + string(fixture.Critic) + "\n```"
		repair = &model.Step{Role: "ai_taste", Purpose: model.Repair, Content: string(fixture.Critic)}
		if scenario == "repair-exhausted" {
			repair.Content = `{"findings": [`
		}
		if scenario == "repair-invalid-quote" {
			content, err := changeFinding(fixture.Critic, "quote", "沈砚拔出手枪")
			if err != nil {
				return manuscript.ContextBundle{}, nil, err
			}
			repair.Content = content
		}
	case "writer-repaired":
		steps[0].Content = "```json\n" + string(fixture.Writer) + "\n```"
		steps = append(steps, model.Step{Role: "writer", Purpose: model.Repair, Content: string(fixture.Writer)})
	case "missing-field":
		critic.Content = `{}`
	case "invalid-quote", "invalid-version", "invalid-enum", "invalid-scope":
		field, value := "quote", any("沈砚拔出手枪")
		switch scenario {
		case "invalid-version":
			field, value = "draftVersion", 99
		case "invalid-enum":
			field, value = "severity", "P9"
		case "invalid-scope":
			field, value = "repairScope", "delete_project"
		}
		content, err := changeFinding(fixture.Critic, field, value)
		if err != nil {
			return manuscript.ContextBundle{}, nil, err
		}
		critic.Content = content
	case "refused":
		// 即使正文长得像合法 JSON，供应商的拒答元数据仍优先。
		critic.FinishReason = model.Refused
	case "truncated":
		critic.FinishReason = model.Truncated
		critic.Content = `{"findings": [`
	case "empty":
		critic.Content = "  \n"
	default:
		return manuscript.ContextBundle{}, nil, fmt.Errorf("unknown scenario %q: see -list-scenarios", scenario)
	}
	steps = append(steps, critic)
	if repair != nil {
		steps = append(steps, *repair)
	}
	return fixture.Context, steps, nil
}

// changeFinding 只用于构造演示中的错误回答，不属于生产解析逻辑。
func changeFinding(raw []byte, field string, value any) (string, error) {
	var payload map[string][]map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", err
	}
	if len(payload["findings"]) == 0 {
		return "", fmt.Errorf("demo fixture requires a finding")
	}
	payload["findings"][0][field] = value
	data, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
