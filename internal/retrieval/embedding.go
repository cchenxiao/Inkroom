package retrieval

import (
	"context"
	"fmt"
	"inkloom/internal/embedding"
	"math"
	"unicode/utf8"
)

// Keep immutable source text intact. Long sources are embedded in bounded UTF-8
// chunks and pooled; only the embedding algorithm is versioned, not the prose.
func embedTexts(ctx context.Context, e Embedder, texts []string) ([][]float32, error) {
	type chunk struct {
		text   string
		owner  int
		weight float32
	}
	chunks := []chunk{}
	for owner, text := range texts {
		if text == "" {
			return nil, fmt.Errorf("empty embedding source")
		}
		for len(text) > 0 {
			end := min(len(text), 2800)
			for end < len(text) && !utf8.RuneStart(text[end]) {
				end--
			}
			chunks = append(chunks, chunk{text[:end], owner, float32(utf8.RuneCountInString(text[:end]))})
			text = text[end:]
		}
	}
	out := make([][]float32, len(texts))
	for start := 0; start < len(chunks); start += 32 {
		batch := chunks[start:min(start+32, len(chunks))]
		input := make([]string, len(batch))
		for i, c := range batch {
			input[i] = c.text
		}
		vectors, err := e.Embed(ctx, input)
		if err != nil {
			return nil, err
		}
		if len(vectors) != len(batch) {
			return nil, fmt.Errorf("embedding batch size mismatch")
		}
		for i, c := range batch {
			if err = embedding.Validate(vectors[i], 0); err != nil {
				return nil, err
			}
			if out[c.owner] == nil {
				out[c.owner] = make([]float32, len(vectors[i]))
			}
			if len(out[c.owner]) != len(vectors[i]) {
				return nil, fmt.Errorf("embedding dimensions changed")
			}
			for j, v := range vectors[i] {
				out[c.owner][j] += v * c.weight
			}
		}
	}
	for _, vector := range out {
		norm := float64(0)
		for _, v := range vector {
			norm += float64(v) * float64(v)
		}
		norm = math.Sqrt(norm)
		if norm == 0 {
			return nil, fmt.Errorf("pooled embedding is zero")
		}
		for i := range vector {
			vector[i] = float32(float64(vector[i]) / norm)
		}
	}
	return out, nil
}
