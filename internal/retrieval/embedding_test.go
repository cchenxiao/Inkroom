package retrieval

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"
)

type boundedEmbedding struct{ sizes []int }

func (e *boundedEmbedding) ID() string { return "bounded" }
func (e *boundedEmbedding) Embed(_ context.Context, texts []string) ([][]float32, error) {
	e.sizes = append(e.sizes, len(texts))
	out := [][]float32{}
	for _, s := range texts {
		if len(s) > 2800 || !utf8.ValidString(s) {
			panic("invalid source chunk")
		}
		out = append(out, []float32{1, 2})
	}
	return out, nil
}
func TestLongSourcesKeepOneVectorPerOriginal(t *testing.T) {
	e := &boundedEmbedding{}
	got, err := embedTexts(context.Background(), e, []string{strings.Repeat("渡口", 20000), "钥匙"})
	if err != nil || len(got) != 2 || len(got[0]) != 2 {
		t.Fatal(got, err)
	}
	if len(e.sizes) < 2 {
		t.Fatal("long corpus not batched")
	}
	for _, n := range e.sizes {
		if n > 32 {
			t.Fatal("provider batch overflow", n)
		}
	}
}
