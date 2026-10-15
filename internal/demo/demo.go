// Package demo 放离线演示材料，与生产 Agent 逻辑隔离。
package demo

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"inkloom/internal/domain/revision"
	"strings"

	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
)

//go:embed chapter.json
var chapter []byte

var Scenarios = []string{
	"hard-conflict", "scene-gap", "cross-chapter", "dialogue-lie", "handedness", "critic-failed", "invalid-rule", "rewrite-stale", "rewrite-unsafe",
	"normal", "no-findings", "revise-limit", "revise-stale", "revise-unsafe", "revise-declined", "p3-only", "bad-json-repaired", "writer-repaired",
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
	if b, s, ok := consistencyScenario(scenario, fixture.Context); ok {
		return b, s, nil
	}
	writer := model.Step{Role: "writer", Content: string(fixture.Writer)}
	critic := model.Step{Role: "ai_taste", Content: string(fixture.Critic)}
	steps := []model.Step{writer}
	var repair *model.Step
	switch scenario {
	case "normal", "revise-limit", "revise-stale", "revise-unsafe", "revise-declined":
	case "no-findings", "p3-only":
		var clean struct {
			Text string `json:"text"`
		}
		_ = json.Unmarshal(fixture.Writer, &clean)
		clean.Text = strings.ReplaceAll(clean.Text, "一股难以言喻的情绪涌上心头", "")
		raw, _ := json.Marshal(clean)
		steps[0].Content = string(raw)
		critic.Content = `{"findings":[]}`
		if scenario == "p3-only" {
			raw, err := changeFinding(fixture.Critic, "severity", "P3")
			if err != nil {
				return manuscript.ContextBundle{}, nil, err
			}
			raw, err = changeFinding([]byte(raw), "quote", "窗外的雨敲着铁皮")
			if err != nil {
				return manuscript.ContextBundle{}, nil, err
			}
			critic.Content = raw
		}
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
	switch scenario {
	case "normal", "bad-json-repaired", "writer-repaired", "revise-limit", "revise-stale", "revise-unsafe", "revise-declined":
		rounds := 1
		if scenario == "revise-limit" {
			rounds = 3
		}
		old := "一股难以言喻的情绪涌上心头"
		for round := 1; round <= rounds; round++ {
			next := ""
			if scenario == "revise-limit" {
				next = "嘴角勾起一抹冷笑"
				if old == next {
					next = "一股难以言喻的情绪涌上心头"
				}
			}
			if scenario == "revise-unsafe" {
				next = "沈砚离开了渡口"
			}
			kind := "delete"
			if next != "" {
				kind = "replace"
			}
			proposal := revision.Proposal{BasedOnDraftVersion: round, Patches: []revision.Patch{{FindingID: "finding-ai-taste-1", SegmentID: "ch7-beat-1-seg-1", ChangeType: kind, OldText: old, NewText: next, Reason: "删改命中的套话"}}}
			if scenario == "revise-stale" {
				proposal.BasedOnDraftVersion = 99
			}
			if scenario == "revise-declined" {
				proposal.Patches = []revision.Patch{}
			}
			if next == "" && len(proposal.Patches) > 0 {
				proposal.Patches[0].OldText = "，" + old
			}
			raw, _ := json.Marshal(proposal)
			steps = append(steps, model.Step{Role: "polisher", Content: string(raw)})
			after := `{"findings":[]}`
			if scenario == "revise-limit" {
				changed, _ := changeFinding(fixture.Critic, "quote", next)
				after, _ = changeFinding([]byte(changed), "draftVersion", round+1)
			}
			steps = append(steps, model.Step{Role: "ai_taste", Content: after})
			old = next
		}
	}
	// 每个评审版本补齐独立的一致性响应，按角色/版本匹配，不与 AI 味争抢队列。
	initial := len(steps)
	for i := 0; i < initial; i++ {
		if steps[i].Role == "ai_taste" && steps[i].Purpose != model.Repair {
			version := 1
			var payload struct {
				Findings []struct {
					DraftVersion int `json:"draftVersion"`
				} `json:"findings"`
			}
			_ = json.Unmarshal([]byte(steps[i].Content), &payload)
			if len(payload.Findings) > 0 {
				version = payload.Findings[0].DraftVersion
			}
			// 空列表复检的版本由前面的 polisher 基准决定。
			for j := 0; j < i; j++ {
				if steps[j].Role == "polisher" {
					var p revision.Proposal
					_ = json.Unmarshal([]byte(steps[j].Content), &p)
					version = p.BasedOnDraftVersion + 1
				}
			}
			// 故障脚本可故意在输出里给错误版本；输入匹配仍是实际轮次。
			if scenario == "invalid-version" {
				version = 1
			}
			steps[i].DraftVersion = version
			steps = append(steps, model.Step{Role: "hard_consistency", DraftVersion: version, Content: `{"findings":[]}`})
		}
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
