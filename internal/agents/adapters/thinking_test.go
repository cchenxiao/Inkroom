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

func TestThinkingWireFlagAndHiddenReasoningBoundary(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		t.Run(map[bool]string{true: "enabled", false: "disabled"}[enabled], func(t *testing.T) {
			var got struct {
				MaxTokens int `json:"max_tokens"`
				Thinking  struct {
					Type string `json:"type"`
				} `json:"thinking"`
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
					t.Error(err)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"test","choices":[{"index":0,"message":{"role":"assistant","content":"{\"text\":\"正确正文\"}","reasoning_content":"private-model-reasoning"},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":250,"total_tokens":350}}`))
			}))
			defer server.Close()
			chat, err := NewDeepSeek(config.Config{BaseURL: server.URL, APIKey: "test", ModelName: "test", CallTimeout: time.Second, MaxOutputTokens: 512})
			if err != nil {
				t.Fatal(err)
			}
			out, u, err := chat.Generate(context.Background(), model.Input{OutputTokens: 30000, CallTimeout: 2 * time.Second, Thinking: enabled, SystemPrompt: "test", UserPrompt: "test"})
			want := "disabled"
			if enabled {
				want = "enabled"
			}
			if err != nil || got.MaxTokens != 30000 || got.Thinking.Type != want || out.Content != `{"text":"正确正文"}` || u.OutputTokens != 250 {
				t.Fatalf("wire=%+v out=%+v usage=%+v err=%v", got, out, u, err)
			}
		})
	}
}
