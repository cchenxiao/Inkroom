package agents

import (
	"context"
	"encoding/json"
	"errors"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/domain/manuscript"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

type continuityProbe struct {
	mu         sync.Mutex
	inputs     []model.Input
	barrier    chan struct{}
	failSecond bool
}

func (p *continuityProbe) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	p.mu.Lock()
	p.inputs = append(p.inputs, in)
	if p.barrier != nil && len(p.inputs) == 2 {
		close(p.barrier)
	}
	p.mu.Unlock()
	if p.barrier != nil {
		select {
		case <-p.barrier:
		case <-ctx.Done():
			select {
			case <-p.barrier:
			default:
				return model.Output{}, model.Usage{}, ctx.Err()
			}
		}
	}
	var material struct{ Focus string }
	_ = json.Unmarshal(in.Material, &material)
	u := model.Usage{Known: true, InputTokens: 10, OutputTokens: 20}
	if p.failSecond && material.Focus == "characters" {
		return model.Output{FinishReason: model.Truncated}, u, nil
	}
	return model.Output{FinishReason: model.Complete, Content: `{"checked":["current"],"issues":[{"earlier":"p1","later":"p2","reason":"位置冲突","suggestion":"请核对取回动作","needsAuthor":false}]}`}, u, nil
}
func TestLongContinuityPreservesAllTextAndFailsClosed(t *testing.T) {
	ss := []manuscript.Segment{{ID: "current", Text: "袋子在桌上。"}}
	b := manuscript.ContextBundle{Neighbors: []manuscript.Passage{{BeatID: "before", Version: 1, Position: "before", Segments: []manuscript.Segment{{ID: "left", Text: "袋子锁在柜里。" + strings.Repeat("窗外下雨。", 700)}}}}}
	for _, fail := range []bool{false, true} {
		p := &continuityProbe{failSecond: fail, barrier: make(chan struct{})}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		a, u, err := CheckNarrativeContinuity(ctx, p, ss, 2, b)
		if len(p.inputs) != 2 || !u.Known || u.OutputTokens != 40 {
			t.Fatal(len(p.inputs), u, err)
		}
		var materials [2]struct {
			Focus string          `json:"focus"`
			Lines []narrativeLine `json:"lines"`
		}
		for i, in := range p.inputs {
			if e := json.Unmarshal(in.Material, &materials[i]); e != nil {
				t.Fatal(e)
			}
		}
		sort.Slice(materials[:], func(i, j int) bool { return materials[i].Focus > materials[j].Focus })
		if materials[0].Focus != "objects" || materials[1].Focus != "characters" || !reflect.DeepEqual(materials[0].Lines, materials[1].Lines) || materials[0].Lines[0].Text != b.Neighbors[0].Segments[0].Text || materials[0].Lines[0].Writable || !materials[0].Lines[1].Writable {
			t.Fatal("scope or full evidence lost")
		}
		if fail {
			var pe *parse.Error
			if !errors.As(err, &pe) || pe.Kind != parse.Truncated || len(a.Findings) != 0 || len(a.Continuity) != 0 {
				t.Fatal("partial pass reported", a, err)
			}
		} else if err != nil || len(a.Findings) != 1 || a.Findings[0].SegmentID != "current" || a.Continuity[0].Status != "conflict" {
			t.Fatal(a, err)
		}
	}
	p := &continuityProbe{}
	guard := model.NewGuard(p, model.Limits{Calls: 1, Tokens: 128000, OutputTokens: 8192, Timeout: time.Second})
	a, _, err := CheckNarrativeContinuity(context.Background(), prompts.Bind(guard), ss, 2, b)
	if !errors.Is(err, model.ErrBudgetExhausted) || len(p.inputs) > 1 || len(a.Continuity) != 0 {
		t.Fatal("split bypassed shared budget", a, err)
	}
}
