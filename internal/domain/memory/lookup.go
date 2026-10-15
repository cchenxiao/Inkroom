package memory

// LookupTrace 只记录公开工具行为，输入/结果有界，缺失材料不在错误诊断中回显。
type LookupTrace struct {
	Steps []LookupStep `json:"steps"`
	Stop  string       `json:"stop,omitempty"`
}
type LookupRef struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
	Digest  string `json:"digest"`
}
type LookupStep struct {
	CallID     string      `json:"callId"`
	Query      string      `json:"query"`
	Status     string      `json:"status"` // started/completed/rejected/failed
	NewSources int         `json:"newSources"`
	Refs       []LookupRef `json:"refs"`
}
