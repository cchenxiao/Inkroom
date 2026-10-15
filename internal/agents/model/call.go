package model

// CallRecord 不保存密钥、提示词正文或模型隐藏推理。
// started 先落库；进程中断后没有 finished 的调用只能标记结果未知。
type CallRecord struct {
	ReservedTokens int          `json:"reservedTokens"`
	Number         int          `json:"number"`
	Attempt        int          `json:"attempt"`
	Role           string       `json:"role"`
	Purpose        Purpose      `json:"purpose"`
	PromptVersion  string       `json:"promptVersion"`
	SchemaVersion  string       `json:"schemaVersion"`
	Model          string       `json:"model"`
	Phase          string       `json:"phase"`
	ElapsedMs      int64        `json:"elapsedMs"`
	FinishReason   FinishReason `json:"finishReason"`
	Success        bool         `json:"success"`
	Usage          Usage        `json:"usage"`
}
