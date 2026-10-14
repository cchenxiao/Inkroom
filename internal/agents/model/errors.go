package model

import "fmt"

// ProviderError 只暴露状态码，不把 SDK 原始响应或请求头带进日志。
type ProviderError struct{ Status int }

func (e *ProviderError) Error() string {
	return fmt.Sprintf("model provider returned HTTP %d", e.Status)
}
