package orchestration_test

import (
	"context"
	"encoding/json"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/manuscript"
	"strings"
	"sync"
	"testing"
	"time"

	"inkloom/internal/agents/model"
	"inkloom/internal/demo"
	"inkloom/internal/orchestration"
)

// 故意让第一版出现硬伤：语言通过不能替代一致性；修复必须走正确范围。
func TestConsistencyRouting(t *testing.T) {
	for _, tc := range []struct {
		name, status, route string
		local               bool
		version             int
	}{
		{"hard-conflict", "needs_human", "structural", false, 1},
		{"hard-conflict", "completed", "none", true, 2},
		{"scene-gap", "completed", "none", true, 2},
		{"cross-chapter", "needs_human", "structural", true, 1},
		{"dialogue-lie", "needs_human", "human", true, 1},
		{"handedness", "completed", "none", true, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bundle, steps, err := demo.Load(tc.name)
			if err != nil {
				t.Fatal(err)
			}
			graph, err := orchestration.NewChapter(context.Background(), model.NewFake(steps), orchestration.Options{AutoRevise: true, AllowLocalRewrite: tc.local})
			if err != nil {
				t.Fatal(err)
			}
			state, err := graph.Invoke(context.Background(), bundle)
			if err != nil {
				t.Fatal(err)
			}
			if state.Status != tc.status || state.DraftVersion != tc.version || state.Route.Kind != tc.route {
				t.Fatalf("got %s v%d route=%s", state.Status, state.DraftVersion, state.Route.Kind)
			}
			if len(state.CriticReviews) != 2 {
				t.Fatal("required critic missing")
			}
			if tc.version == 1 && len(state.Revisions) > 0 {
				t.Fatal("unauthorized rewrite")
			}
			if tc.version == 2 && (len(state.Reviews) != 2 || len(state.Revisions) != 1) {
				t.Fatal("missing revision or re-review")
			}
		})
	}
}

// 两个必要评审必须真的同时进入模型；若退化为串行，barrier 会在超时处失败。
// Writer 启动后改外部切片，后续 Critic 仍须看到冻结的旧版本。
func TestParallelSnapshotAndFailure(t *testing.T) {
	bundle, steps, err := demo.Load("no-findings")
	if err != nil {
		t.Fatal(err)
	}
	chat := &parallelProbe{inner: model.NewFake(steps), bundle: &bundle, barrier: make(chan struct{}), inputs: map[string]json.RawMessage{}}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	g, err := orchestration.NewChapter(ctx, chat, orchestration.Options{})
	if err != nil {
		t.Fatal(err)
	}
	state, err := g.Invoke(ctx, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != "completed" || state.Context.Characters[0].HardTraits[0].Version != 1 {
		t.Fatal("frozen context was overwritten")
	}
	var ai, hard map[string]json.RawMessage
	_ = json.Unmarshal(chat.inputs["ai_taste"], &ai)
	_ = json.Unmarshal(chat.inputs["hard_consistency"], &hard)
	if ai["characters"] != nil || ai["facts"] != nil || hard["metrics"] != nil || hard["beat"] != nil {
		t.Fatal("critic context isolation lost")
	}
	if string(ai["segments"]) != string(hard["segments"]) || string(ai["draftVersion"]) != string(hard["draftVersion"]) {
		t.Fatal("critics saw different drafts")
	}
	if strings.Contains(string(hard["characters"]), "外部新版本") {
		t.Fatal("critic saw unfrozen facts")
	}
	for _, scenario := range []string{"critic-failed", "invalid-rule", "rewrite-stale", "rewrite-unsafe"} {
		t.Run(scenario, func(t *testing.T) {
			cfg := config.Config{Model: "fake", MaxCalls: 14, MaxTokens: 24000, MaxOutputTokens: 2048, CallTimeout: time.Second}
			result, err := app.ExecuteChapter(context.Background(), cfg, scenario, orchestration.Options{AutoRevise: true, AllowLocalRewrite: true})
			if scenario == "critic-failed" || scenario == "invalid-rule" {
				if err == nil || result.Status != "failed" || len(result.Reviews) > 0 {
					t.Fatal("missing/invalid critic was treated as passing")
				}
			} else if err != nil || result.Status != "needs_human" {
				t.Fatalf("invalid rewrite not blocked: %v %+v", err, result)
			}
			if result.DraftVersion != 1 || len(result.Revisions) != 0 || len(result.Segments) != 1 {
				t.Fatal("failed gate overwrote candidate")
			}
		})
	}
}

type parallelProbe struct {
	inner   model.ChatModel
	bundle  *manuscript.ContextBundle
	mu      sync.Mutex
	inputs  map[string]json.RawMessage
	barrier chan struct{}
}

func (p *parallelProbe) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	if in.Role == "writer" {
		p.bundle.Characters[0].HardTraits[0].Text = "外部新版本"
		p.bundle.Characters[0].HardTraits[0].Version = 99
	}
	if in.Role == "hard_consistency" || in.Role == "ai_taste" {
		p.mu.Lock()
		p.inputs[in.Role] = append(json.RawMessage{}, in.Material...)
		if len(p.inputs) == 2 {
			close(p.barrier)
		}
		p.mu.Unlock()
		select {
		case <-p.barrier:
		case <-ctx.Done():
			return model.Output{}, model.Usage{}, ctx.Err()
		}
	}
	return p.inner.Generate(ctx, in)
}
