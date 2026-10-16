package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"inkloom/internal/agents/adapters"
	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/config"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/planning"
	"inkloom/internal/domain/style"
	"strings"
)

type TrialSample = planning.TrialSample
type TrialReport = planning.TrialReport
type trialMaterial struct {
	InputVersion     int                    `json:"inputVersion"`
	DirectionVersion int                    `json:"directionVersion"`
	Direction        planning.Direction     `json:"direction"`
	Beat             planning.TemporaryBeat `json:"beat"`
	Style            planning.TrialStyle    `json:"style"`
}

// GenerateStyleTrials 不依赖仓储。结果永远只是试笔，M0.2b 的采用事务负责校验当前版本。
func GenerateStyleTrials(ctx context.Context, cfg config.Config, input planning.TrialInput, onCall ...func(context.Context, model.CallRecord) error) (TrialReport, error) {
	if err := input.Validate(); err != nil {
		return TrialReport{}, err
	}
	var chat model.ChatModel
	if cfg.Model == "fake" {
		steps := []model.Step{}
		for i := range input.Variants {
			// Fake 只演示材料流动，不假装理解任何类型或作者锚文本。
			text := input.Beat.Summary + "\n" + input.Beat.Outcome
			if i == 1 {
				text = input.Beat.Summary + "\n\n" + input.Beat.Outcome
			}
			raw, _ := json.Marshal(contracts.WriterOutput{Text: text})
			steps = append(steps, model.Step{Role: "trial_writer", Content: string(raw)})
		}
		chat = model.NewFake(steps)
	} else {
		var err error
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return TrialReport{}, err
		}
	}
	return generateStyleTrials(ctx, cfg, input, chat, onCall...)
}

func generateStyleTrials(ctx context.Context, cfg config.Config, input planning.TrialInput, chat model.ChatModel, onCall ...func(context.Context, model.CallRecord) error) (TrialReport, error) {
	if err := input.Validate(); err != nil {
		return TrialReport{}, err
	}
	// 固定两份材料的共同部分，避免两次调用分别读取可变化的外部状态。
	raw, err := json.Marshal(input)
	if err != nil {
		return TrialReport{}, err
	}
	var frozen planning.TrialInput
	if err = json.Unmarshal(raw, &frozen); err != nil {
		return TrialReport{}, err
	}
	report := TrialReport{Status: "running", Model: cfg.ModelName, Input: frozen, InputDigest: fmt.Sprintf("%x", sha256.Sum256(raw)), Samples: []TrialSample{}, Calls: []model.CallRecord{}, Message: "临时试笔，尚未采用；事实与事件结果需作者对照，不由统计量证明。"}
	if cfg.Model == "fake" {
		report.Message = "Fake 流程样例：仅回显临时场景，不评估文风质量，不写入任何正文或事实。"
	}
	guard := model.NewGuard(chat, model.Limits{Calls: min(cfg.MaxCalls, 4), Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName, OnCall: func(ctx context.Context, call model.CallRecord) error {
		report.Calls = append(report.Calls, call)
		if len(onCall) > 0 && onCall[0] != nil {
			return onCall[0](ctx, call)
		}
		return nil
	}})
	for _, variant := range frozen.Variants {
		material, _ := json.Marshal(trialMaterial{frozen.Source.Version, frozen.Selection.Version, frozen.Selection.Direction, frozen.Beat, variant})
		out, _, err := parse.Generate[contracts.WriterOutput](ctx, prompts.Bind(guard), model.Input{Role: "trial_writer", Task: "按这一套风格要求写临时试笔，保持共同场景事实与结果。", Material: material, OutputSchema: contracts.TrialWriterSchema}, func(out contracts.WriterOutput) error {
			if strings.TrimSpace(out.Text) == "" || len([]rune(out.Text)) > 3000 {
				return fmt.Errorf("试笔为空或超过 3000 字安全上限")
			}
			return nil
		})
		report.Usage = guard.Usage()
		if err != nil {
			report.Status = "failed"
			return report, fmt.Errorf("试笔 %s 失败: %w", variant.ID, err)
		}
		stats := style.Analyze([]manuscript.Segment{{ID: "trial-" + variant.ID, Text: out.Text}}, variant.BannedPhrases)[0]
		report.Samples = append(report.Samples, TrialSample{Variant: variant, Text: out.Text, Stats: stats})
	}
	report.Status = "completed"
	return report, nil
}
