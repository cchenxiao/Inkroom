// Package model 是项目自己的模型端口，不把供应商或 Eino 类型传进领域层。
package model

import (
	"context"
	"encoding/json"
)

type Input struct {
	Thinking bool // Stateless author correction and its verification only.
	Tools    []ToolDefinition
	Messages []Message
	Role     string
	Task     string
	Material json.RawMessage
	// OutputSchema 交给供应商适配器施加结构约束；本地仍要再次校验。
	OutputSchema  json.RawMessage
	Purpose       Purpose
	SystemPrompt  string
	UserPrompt    string
	PromptVersion string
	SchemaVersion string
	Temperature   float32
}

type Purpose string

const (
	Generate Purpose = "generate"
	Repair   Purpose = "repair"
)

type FinishReason string

const (
	ToolRequested FinishReason = "tool_calls"
	Complete      FinishReason = "complete"
	Refused       FinishReason = "refused"
	Truncated     FinishReason = "truncated"
)

type Output struct {
	ToolCalls []ToolCall
	Content   string
	// 由适配器映射供应商元数据，不能让正文 JSON 自报“生成完整”。
	FinishReason FinishReason
}

type Usage struct {
	InputTokens  int  `json:"inputTokens"`
	OutputTokens int  `json:"outputTokens"`
	Known        bool `json:"known"`
}

// ChatModel 只规定调用能力；实现此方法即可接入，无需 implements 声明。
type ChatModel interface {
	Generate(context.Context, Input) (Output, Usage, error)
}
