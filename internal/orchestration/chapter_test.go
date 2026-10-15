package orchestration_test

import (
	"context"
	"inkloom/internal/agents/model"
	"inkloom/internal/demo"
	"inkloom/internal/orchestration"
	"testing"
)

type counted struct {
	inner model.ChatModel
	roles map[string]int
}

func (c *counted) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	c.roles[in.Role]++
	return c.inner.Generate(ctx, in)
}

// 只固定循环边界与授权，避免用真实模型的随机文本做测试断言。
func TestRevisionLoop(t *testing.T) {
	cases := []struct {
		name                            string
		max                             int
		auto                            bool
		status                          string
		round, version, polish, critics int
	}{
		{"normal", 2, true, "completed", 1, 2, 1, 2},
		{"revise-limit", 2, true, "escalated", 2, 3, 2, 3},
		{"revise-limit", 3, true, "escalated", 3, 4, 3, 4},
		{"normal", 2, false, "waiting_human", 0, 1, 0, 1},
		{"revise-stale", 2, true, "waiting_human", 1, 1, 1, 1},
		{"revise-unsafe", 2, true, "waiting_human", 1, 1, 1, 1},
		{"p3-only", 2, true, "completed", 0, 1, 0, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			bundle, steps, err := demo.Load(tc.name)
			if err != nil {
				t.Fatal(err)
			}
			chat := &counted{model.NewFake(steps), map[string]int{}}
			g, err := orchestration.NewChapter(ctx, chat, orchestration.Options{MaxRounds: tc.max, AutoRevise: tc.auto})
			if err != nil {
				t.Fatal(err)
			}
			result, err := g.Invoke(ctx, bundle)
			if err != nil {
				t.Fatal(err)
			}
			if result.Status != tc.status || result.ReviseRound != tc.round || result.DraftVersion != tc.version {
				t.Fatalf("unexpected state: %s round=%d version=%d", result.Status, result.ReviseRound, result.DraftVersion)
			}
			if chat.roles["polisher"] != tc.polish || chat.roles["ai_taste"] != tc.critics {
				t.Fatalf("unexpected calls: %v", chat.roles)
			}
			if result.Report.DraftVersion != result.DraftVersion {
				t.Fatal("review is stale")
			}
			if result.Status == "completed" {
				for _, m := range result.Metrics {
					if len(m.Hits) > 0 {
						t.Fatal("banned phrase survived successful review")
					}
				}
			}
		})
	}
}
