package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/eino-contrib/jsonschema"
	"net/http"
	"net/url"

	deepseek "github.com/cloudwego/eino-ext/components/model/deepseek"
	"github.com/cloudwego/eino/schema"
	sdk "github.com/cohesion-org/deepseek-go"
	"inkloom/internal/agents/model"
	"inkloom/internal/config"
)

type DeepSeek struct{ cfg config.Config }

var _ model.ChatModel = (*DeepSeek)(nil)

func NewDeepSeek(cfg config.Config) (*DeepSeek, error) {
	u, err := url.Parse(cfg.BaseURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("invalid DEEPSEEK_BASE_URL")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1")) {
		return nil, fmt.Errorf("model endpoint must use HTTPS or localhost HTTP")
	}
	return &DeepSeek{cfg: cfg}, nil
}

func (d *DeepSeek) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	format := deepseek.ResponseFormatType(deepseek.ResponseFormatTypeJSONObject)
	if len(in.Tools) > 0 || len(in.Messages) > 0 {
		format = deepseek.ResponseFormatTypeText
	}
	cm, err := deepseek.NewChatModel(ctx, &deepseek.ChatModelConfig{
		APIKey: d.cfg.APIKey, BaseURL: d.cfg.BaseURL, Model: d.cfg.ModelName,
		Timeout: d.cfg.CallTimeout, MaxTokens: d.cfg.MaxOutputTokens, Temperature: in.Temperature,
		ThinkingConfig:     &deepseek.ThinkingConfig{Type: "disabled"},
		ResponseFormatType: format,
		HTTPClient:         &http.Client{Timeout: d.cfg.CallTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
	})
	if err != nil {
		return model.Output{}, model.Usage{}, fmt.Errorf("cannot initialize DeepSeek adapter")
	}
	if len(in.Tools) > 0 {
		definitions := make([]*schema.ToolInfo, 0, len(in.Tools))
		for _, tool := range in.Tools {
			var params jsonschema.Schema
			if err := json.Unmarshal(tool.Parameters, &params); err != nil {
				return model.Output{}, model.Usage{}, fmt.Errorf("invalid tool schema")
			}
			definitions = append(definitions, &schema.ToolInfo{Name: tool.Name, Desc: tool.Description, ParamsOneOf: schema.NewParamsOneOfByJSONSchema(&params)})
		}
		if err := cm.BindTools(definitions); err != nil {
			return model.Output{}, model.Usage{}, fmt.Errorf("cannot bind tools")
		}
	}
	messages := []*schema.Message{schema.SystemMessage(in.SystemPrompt), schema.UserMessage(in.UserPrompt)}
	for _, item := range in.Messages {
		msg := &schema.Message{Role: schema.RoleType(item.Role), Content: item.Content, ToolCallID: item.ToolCallID}
		for _, call := range item.ToolCalls {
			msg.ToolCalls = append(msg.ToolCalls, schema.ToolCall{ID: call.ID, Type: "function", Function: schema.FunctionCall{Name: call.Name, Arguments: call.Arguments}})
		}
		messages = append(messages, msg)
	}
	msg, err := cm.Generate(ctx, messages)
	if err != nil {
		if ctx.Err() != nil {
			return model.Output{}, model.Usage{}, ctx.Err()
		}
		var apiErr *sdk.APIError
		if errors.As(err, &apiErr) {
			return model.Output{}, model.Usage{}, &model.ProviderError{Status: apiErr.StatusCode}
		}
		return model.Output{}, model.Usage{}, fmt.Errorf("DeepSeek request failed; response or usage unknown")
	}
	if msg == nil || msg.ResponseMeta == nil {
		return model.Output{}, model.Usage{}, fmt.Errorf("DeepSeek returned no response metadata")
	}
	usage := model.Usage{}
	// SDK 的 usage 是值类型，字段缺失时 Eino 仍可能构造非空零值指针。
	// 此处非空 JSON 生成必有输入/输出 token；零值不能当成免费调用。
	if u := msg.ResponseMeta.Usage; u != nil && u.PromptTokens > 0 && u.CompletionTokens > 0 {
		usage = model.Usage{InputTokens: u.PromptTokens, OutputTokens: u.CompletionTokens, Known: true}
	}
	finish := model.FinishReason(msg.ResponseMeta.FinishReason)
	switch msg.ResponseMeta.FinishReason {
	case "stop":
		finish = model.Complete
	case "length":
		finish = model.Truncated
	case "content_filter":
		finish = model.Refused
	}
	// 不读取或记录模型隐藏推理内容。
	calls := make([]model.ToolCall, 0, len(msg.ToolCalls))
	for _, c := range msg.ToolCalls {
		calls = append(calls, model.ToolCall{ID: c.ID, Name: c.Function.Name, Arguments: c.Function.Arguments})
	}
	return model.Output{Content: msg.Content, FinishReason: finish, ToolCalls: calls}, usage, nil
}
