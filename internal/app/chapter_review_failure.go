package app

import (
	"context"
	"errors"
	"strings"

	"inkloom/internal/agents/parse"
)

// Failure is safe for the author-facing UI; Error retains technical diagnostics separately.
type ChapterReviewFailure struct {
	Stage   string `json:"stage"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Finding int    `json:"finding,omitempty"`
}
type chapterFindingError struct{ ChapterReviewFailure }

func (e *chapterFindingError) Error() string { return e.Code + ": " + e.Message }
func findingError(index int, code, message string) error {
	return &chapterFindingError{ChapterReviewFailure{Stage: "结果校验", Code: code, Message: message, Finding: index + 1}}
}
func DescribeChapterReviewFailure(err error) *ChapterReviewFailure {
	if err == nil {
		return nil
	}
	var finding *chapterFindingError
	if errors.As(err, &finding) {
		detail := finding.ChapterReviewFailure
		return &detail
	}
	detail := &ChapterReviewFailure{Stage: "复审执行", Code: "review_failed", Message: "本次复审未完成，历史记录未提供可定位的原因。可重试整章复审；已采用正文保留。"}
	var output *parse.Error
	if errors.As(err, &output) {
		detail.Stage, detail.Code = "结果校验", string(output.Kind)
		switch output.Kind {
		case parse.InvalidContent:
			detail.Message = "模型返回的审查意见未通过正文、版本或证据校验，不能作为审核结论。"
		case parse.InvalidJSON, parse.InvalidSchema:
			detail.Message = "模型返回的审查结果格式不符合约定，未能读取有效意见。"
		case parse.Truncated:
			detail.Message = "模型输出被截断，审查结果不完整。"
		case parse.Empty:
			detail.Message = "模型没有返回审查内容。"
		case parse.Refused:
			detail.Message = "模型拒绝了本次审查请求。"
		default:
			detail.Message = "模型返回的结果未通过格式或完成状态校验。"
		}
	}
	// Compatibility for persisted errors from earlier versions (no typed error retained).
	text := err.Error()
	switch {
	case strings.Contains(text, "unknown or fabricated evidence"):
		detail.Stage, detail.Code, detail.Message = "结果校验", "evidence_invalid", "模型的证据引用未通过校验：可能是来源编号、引用顺序或逐字原文不匹配。旧记录未保存具体条目，无法进一步定位；这不表示正文没有问题。"
	case strings.Contains(text, "invalid finding target, role, version or quote"):
		detail.Stage, detail.Code, detail.Message = "结果校验", "finding_invalid", "模型意见的目标段落、审查角色、稿本版本或原文引用不匹配。旧记录未保存具体条目。"
	case errors.Is(err, context.DeadlineExceeded), strings.Contains(text, "context deadline exceeded"):
		detail.Stage, detail.Code, detail.Message = "模型调用", "timeout", "审查超过等待时限，未取得完整结果。"
	case strings.Contains(text, "invalid_schema"), strings.Contains(text, "invalid_json"):
		detail.Stage, detail.Code, detail.Message = "结果校验", "output_format", "模型返回的审查结果格式不符合约定，未能读取有效意见。"
	case strings.Contains(text, "model_truncated"):
		detail.Stage, detail.Code, detail.Message = "模型调用", "truncated", "模型输出被截断，审查结果不完整。"
	case strings.HasPrefix(text, "整章双路复审预估需 "):
		detail.Stage, detail.Code, detail.Message = "调用预算", "budget", text
	}
	return detail
}
