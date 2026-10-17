package app

import (
	"context"
	"errors"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
)

// ChapterFactFailure contains only application-owned text. Never persist provider
// responses, JSON values, or arbitrary error strings in the user-visible job.
type ChapterFactFailure struct {
	Stage   string `json:"stage"`
	Code    string `json:"code"`
	Message string `json:"message"`
}
type chapterFactError struct {
	Failure ChapterFactFailure
	cause   error
}

func (e *chapterFactError) Error() string { return e.Failure.Message }
func (e *chapterFactError) Unwrap() error { return e.cause }
func factError(stage, code, message string, cause error) error {
	return &chapterFactError{ChapterFactFailure{stage, code, message}, cause}
}

func ClassifyChapterFactFailure(err error) *ChapterFactFailure {
	if err == nil {
		return nil
	}
	var owned *chapterFactError
	if errors.As(err, &owned) {
		f := owned.Failure
		return &f
	}
	f := ChapterFactFailure{Stage: "internal", Code: "unclassified", Message: "事实整理遇到内部错误，尚未生成可确认的候选。"}
	var output *parse.Error
	var provider *model.ProviderError
	switch {
	case errors.Is(err, context.Canceled):
		f = ChapterFactFailure{"interrupted", "canceled", "事实整理已中断；不会自动重发模型请求。"}
	case errors.Is(err, context.DeadlineExceeded):
		f = ChapterFactFailure{"model", "timeout", "模型请求超时，结果尚未确认；不会自动重发请求。"}
	case errors.Is(err, model.ErrBudgetExhausted):
		f = ChapterFactFailure{"budget", "budget_exhausted", "事实整理达到调用或用量上限，未继续请求模型。"}
	case errors.As(err, &output):
		f.Code = string(output.Kind)
		f.Stage = "response"
		switch output.Kind {
		case parse.Empty:
			f.Message = "模型未返回候选内容。"
		case parse.Refused:
			f.Message = "模型未处理本次事实整理请求。"
		case parse.Truncated:
			f.Message = "模型回答未完整结束，不能作为事实候选。"
		case parse.InvalidStatus:
			f.Message = "无法确认模型回答是否完整，未采用返回内容。"
		case parse.TooLarge:
			f.Message = "模型回答超过允许长度，未载入候选。"
		case parse.InvalidJSON:
			f.Stage = "parse"
			f.Message = "模型回答无法解析，格式修复后仍未得到有效结果。"
		case parse.InvalidSchema:
			f.Stage = "schema"
			f.Message = "模型已返回内容，但候选字段或数量不符合要求。"
		case parse.InvalidContent:
			f.Stage = "validation"
			f.Message = "模型已返回内容，但事实候选未通过原文与知识引用校验。"
		}
	case errors.As(err, &provider):
		f = ChapterFactFailure{"model", "provider_error", "模型服务暂时无法完成事实整理。"}
		if provider.Status == 401 || provider.Status == 403 {
			f.Code = "provider_access"
			f.Message = "模型服务拒绝访问，请检查模型访问配置。"
		}
		if provider.Status == 429 {
			f.Code = "provider_rate_limit"
			f.Message = "模型服务请求过于频繁，请稍后重试。"
		}
	}
	return &f
}
