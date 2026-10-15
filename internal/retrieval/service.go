package retrieval

import (
	"context"
	"fmt"
	"strings"

	"inkloom/internal/domain/memory"
	"inkloom/internal/embedding"
)

// Search 的范围只能由后端创建。先过滤再把材料交给向量模型，禁止外部重排绕过过滤。
func (s Service) Search(ctx context.Context, v memory.View, query string, limit int) (Result, error) {
	result := Result{Excluded: []memory.Exclusion{}}
	if s.Repo == nil || strings.TrimSpace(query) == "" || len(query) > 2000 || limit < 1 || limit > 10 {
		return result, fmt.Errorf("invalid retrieval request")
	}
	snapshot, err := s.Repo.MemorySnapshot(ctx, v)
	if err != nil {
		return result, err
	}
	v.Pins = snapshot.Pins
	visible, err := memory.Select(v, snapshot.Records)
	if err != nil {
		return result, err
	}
	result.Excluded = visible.Excluded
	result.VisibleCount = len(visible.CharacterContext)
	mode := "keyword"
	if s.Embedder != nil {
		mode = "hybrid_zhipu"
		if strings.HasPrefix(s.Embedder.ID(), "fake-") {
			mode = "hybrid_fake"
		}
	}
	v.Pins = nil
	result.Context = memory.RetrievalContext{View: v, Query: query, Mode: mode, Ranker: "rrf60-coverage-v1", Hits: []memory.Hit{}}
	if s.Embedder != nil {
		result.Context.EmbeddingModel = s.Embedder.ID()
	}
	if len(visible.CharacterContext) == 0 {
		return result, nil
	}
	byDigest := map[string]memory.Record{}
	origins := map[string]Origin{}
	records := map[string]memory.Record{}
	for _, r := range snapshot.Records {
		records[memory.Digest(r)] = r
	}
	keys := []string{}
	keyword := map[string]float64{}
	for _, m := range visible.CharacterContext {
		byDigest[m.Digest] = records[m.Digest]
		origins[m.Digest] = snapshot.Origins[m.ID]
		keys = append(keys, m.Digest)
		if n := coverage(query, m.Text); n > 0 {
			keyword[m.Digest] = n
		}
	}
	kw := ordered(keyword)
	if len(kw) > 20 {
		kw = kw[:20]
	}
	var semantic []Ranked
	if s.Embedder != nil {
		vectors, e := s.Repo.CachedVectors(ctx, keys, s.Embedder.ID())
		if e != nil {
			return result, e
		}
		// 限制单次查询最多处理 128 个可见片段，超限明确返回，不暗中截断来源。
		if len(keys) > 128 {
			return result, fmt.Errorf("visible corpus exceeds synchronous embedding limit (128)")
		}
		missing := []string{}
		for _, key := range keys {
			if _, ok := vectors[key]; !ok {
				missing = append(missing, key)
			}
		}
		for start := 0; start < len(missing); start += 32 {
			end := min(start+32, len(missing))
			texts := []string{}
			for _, key := range missing[start:end] {
				texts = append(texts, byDigest[key].Text)
			}
			batch, e := s.Embedder.Embed(ctx, texts)
			if e != nil {
				return result, e
			}
			if len(batch) != len(texts) {
				return result, fmt.Errorf("embedding batch size mismatch")
			}
			for i, vector := range batch {
				if e = embedding.Validate(vector, 0); e != nil {
					return result, e
				}
				vectors[missing[start+i]] = vector
			}
		}
		q, e := s.Embedder.Embed(ctx, []string{query})
		if e != nil {
			return result, e
		}
		if len(q) != 1 {
			return result, fmt.Errorf("query embedding missing")
		}
		if e = embedding.Validate(q[0], 0); e != nil {
			return result, e
		}
		for _, key := range keys {
			if e = embedding.Validate(vectors[key], len(q[0])); e != nil {
				return result, fmt.Errorf("embedding space mismatch: %w", e)
			}
		}
		for _, key := range missing {
			if e = s.Repo.SaveVector(ctx, key, s.Embedder.ID(), vectors[key]); e != nil {
				return result, e
			}
		}
		semantic, e = s.Repo.Nearest(ctx, keys, s.Embedder.ID(), q[0], 20)
		if e != nil {
			return result, e
		}
	}
	scores := fuse(kw, semantic)
	// 小规模确定性重排：融合排名为主，加少量精确词面覆盖度；不伪装成 cross-encoder。
	for key, score := range scores {
		scores[key] = score + 0.005*coverage(query, byDigest[key].Text)
	}
	for _, r := range ordered(scores) {
		if len(result.Context.Hits) >= limit {
			break
		}
		record, ok := byDigest[r.Digest]
		if !ok {
			return result, fmt.Errorf("vector store returned an unapproved source")
		}
		origin := origins[r.Digest]
		result.Context.Hits = append(result.Context.Hits, memory.Hit{Record: record, Digest: r.Digest, Origin: origin.Kind, CommitID: origin.CommitID, Method: mode, Score: r.Score})
	}
	return result, nil
}
