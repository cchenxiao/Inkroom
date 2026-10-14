package parse

import "fmt"

type Kind string

const (
	Empty          Kind = "empty_response"
	Refused        Kind = "model_refused"
	Truncated      Kind = "model_truncated"
	InvalidStatus  Kind = "invalid_finish_reason"
	TooLarge       Kind = "response_too_large"
	InvalidJSON    Kind = "invalid_json"
	InvalidSchema  Kind = "invalid_schema"
	InvalidContent Kind = "invalid_content"
)

// Error 可被 errors.As 识别，调用方不用通过搜索错误字符串做决策。
type Error struct {
	Kind Kind
	Err  error
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %v", e.Kind, e.Err) }
func (e *Error) Unwrap() error { return e.Err }
