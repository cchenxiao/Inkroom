package adapters

import (
	"context"
	"encoding/json"
	"inkloom/internal/agents/model"
	"inkloom/internal/config"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNativeToolProtocol(t *testing.T) {
	var got struct {
		Messages []struct {
			Role       string `json:"role"`
			ToolCallID string `json:"tool_call_id"`
			ToolCalls  []any  `json:"tool_calls"`
		} `json:"messages"`
		Tools          []any `json:"tools"`
		ResponseFormat struct {
			Type string `json:"type"`
		} `json:"response_format"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"test","choices":[{"index":0,"message":{"role":"assistant","content":"","tool_calls":[{"id":"new","type":"function","function":{"name":"search_memory","arguments":"{\"query\":\"铜扣\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}`))
	}))
	defer server.Close()
	chat, err := NewDeepSeek(config.Config{BaseURL: server.URL, APIKey: "test-only", ModelName: "test", CallTimeout: time.Second, MaxOutputTokens: 256})
	if err != nil {
		t.Fatal(err)
	}
	out, u, err := chat.Generate(context.Background(), model.Input{SystemPrompt: "instructions", UserPrompt: "materials", Tools: []model.ToolDefinition{{Name: "search_memory", Parameters: json.RawMessage(`{"type":"object","properties":{"query":{"type":"string"}}}`)}}, Messages: []model.Message{{Role: "assistant", ToolCalls: []model.ToolCall{{ID: "old", Name: "search_memory", Arguments: `{"query":"雨"}`}}}, {Role: "tool", ToolCallID: "old", Content: `{"hits":[]}`}}})
	if err != nil || out.FinishReason != model.ToolRequested || len(out.ToolCalls) != 1 || out.ToolCalls[0].ID != "new" || !u.Known {
		t.Fatalf("response %+v %+v %v", out, u, err)
	}
	if len(got.Tools) != 1 || len(got.Messages) != 4 || got.Messages[2].Role != "assistant" || len(got.Messages[2].ToolCalls) != 1 || got.Messages[3].ToolCallID != "old" || got.ResponseFormat.Type == "json_object" {
		t.Fatalf("invalid protocol %+v", got)
	}
}
