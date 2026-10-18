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
	return s.search(ctx, v, query, limit, false)
}

// SearchForAuthor is not an agent tool. Results may include material unknown to
// the POV and cannot pass ValidateRetrieval as character context.
func (s Service) SearchForAuthor(ctx context.Context, v memory.View, query string, limit int) (Result, error) {
	return s.search(ctx, v, query, limit, true)
}

func (s Service) search(ctx context.Context, v memory.View, query string, limit int, author bool) (Result, error) {
	result := Result{Excluded: []memory.Exclusion{}}
	if s.Repo == nil || strings.TrimSpace(query) == "" || len(query) > 2000 || limit < 1 || limit > 10 {
		return result, fmt.Errorf("invalid retrieval request")
	}
	snapshot, err := s.Repo.MemorySnapshot(ctx, v)
	if err != nil {
		return result, failed("catalog_unavailable", "无法读取本次写作固定的定稿材料，请更新状态后重试。", err)
	}
	v.Pins = snapshot.Pins
	visible, err := memory.Select(v, snapshot.Records)
	if author {
		visible, err = memory.SelectForAuthor(v, snapshot.Records)
		result.Audience = "author"
	}
	if err != nil {
		return result, failed("visibility_invalid", "前情材料的版本或知情范围不完整，请检查材料来源。", err)
	}
	result.Excluded = visible.Excluded
	result.VisibleCount = len(visible.CharacterContext)
	mode := "keyword"
	if s.Embedder != nil {
		mode = "hybrid_zhipu"
		if strings.HasPrefix((s.Embedder.ID() + ":chunk-mean-v1"), "fake-") {
			mode = "hybrid_fake"
		}
	}
	v.Pins = nil
	result.Context = memory.RetrievalContext{View: v, Query: query, Mode: mode, Ranker: "rrf60-coverage-v1", Hits: []memory.Hit{}}
	if s.Embedder != nil {
		result.Context.EmbeddingModel = (s.Embedder.ID() + ":chunk-mean-v1")
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
		vectors, e := s.Repo.CachedVectors(ctx, keys, (s.Embedder.ID() + ":chunk-mean-v1"))
		if e != nil {
			return result, failed("vector_cache_unavailable", "无法读取前情检索索引，请重试。", e)
		}
		// Bound synchronous work without the demo-only 128-record ceiling.
		if len(keys) > 4096 {
			return result, failed("index_limit", "当前检索范围超过 4096 条材料，需要分批建立索引。当前查询未截断材料。", fmt.Errorf("visible corpus %d", len(keys)))
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
			batch, e := embedTexts(ctx, s.Embedder, texts)
			if e != nil {
				return result, failed("embedding_failed", "向量服务未能处理前情材料，请检查向量模型连接后重试。", e)
			}
			if len(batch) != len(texts) {
				return result, fmt.Errorf("embedding batch size mismatch")
			}
			for i, vector := range batch {
				if e = embedding.Validate(vector, 0); e != nil {
					return result, e
				}
				vectors[missing[start+i]] = vector
				if e = s.Repo.SaveVector(ctx, missing[start+i], s.Embedder.ID()+":chunk-mean-v1", vector); e != nil {
					return result, failed("vector_cache_write_failed", "前情材料已读取，但检索索引保存失败，请重试；正文未改变。", e)
				}
			}
		}
		q, e := embedTexts(ctx, s.Embedder, []string{query})
		if e != nil {
			return result, failed("query_embedding_failed", "向量服务未能处理查询，请检查向量模型连接后重试。", e)
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
		semantic, e = s.Repo.Nearest(ctx, keys, (s.Embedder.ID() + ":chunk-mean-v1"), q[0], 20)
		if e != nil {
			return result, failed("vector_search_failed", "前情检索索引查询失败，请重试。", e)
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
