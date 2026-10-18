// Package retrieval 把可见性、召回、融合与重排串起来；不决定剧情，也不调用 Writer。
package retrieval

import (
	"context"
	"inkloom/internal/domain/memory"
)

type Origin struct {
	Kind     string
	CommitID string
}
type Snapshot struct {
	Records []memory.Record
	Pins    map[string]memory.Pin
	Origins map[string]Origin
}
type Ranked struct {
	Digest string
	Score  float64
}
type Repository interface {
	MemorySnapshot(context.Context, memory.View) (Snapshot, error)
	CachedVectors(context.Context, []string, string) (map[string][]float32, error)
	SaveVector(context.Context, string, string, []float32) error
	Nearest(context.Context, []string, string, []float32, int) ([]Ranked, error)
}
type Embedder interface {
	ID() string
	Embed(context.Context, []string) ([][]float32, error)
}
type Result struct {
	Audience     string                  `json:"audience,omitempty"`
	Context      memory.RetrievalContext `json:"context"`
	Excluded     []memory.Exclusion      `json:"excluded"`
	VisibleCount int                     `json:"visibleCount"`
}
type Service struct {
	Repo     Repository
	Embedder Embedder
}
