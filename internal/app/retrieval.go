package app

import (
	"fmt"
	"inkloom/internal/config"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/embedding"
	"inkloom/internal/retrieval"
)

func NewRetrieval(cfg config.Config, repo retrieval.Repository) (*retrieval.Service, error) {
	s := &retrieval.Service{Repo: repo}
	switch cfg.Embedder {
	case "", "none":
	case "fake":
		if cfg.Model != "fake" {
			return nil, fmt.Errorf("Fake embedding requires Fake chat")
		}
		s.Embedder = embedding.Fake{}
	case "zhipu":
		e, err := embedding.NewZhipu(cfg.EmbeddingKey, cfg.EmbeddingRevision, cfg.EmbeddingDimensions)
		if err != nil {
			return nil, err
		}
		s.Embedder = e
	default:
		return nil, fmt.Errorf("unknown embedding provider")
	}
	return s, nil
}

// MemoryView derives authorization from a frozen task, never from a model query.
func MemoryView(b manuscript.ContextBundle) (memory.View, error) {
	if b.WritingTask == nil {
		v := CurrentMemoryView()
		if b.ProjectID != v.ProjectID || b.BranchID != v.BranchID || b.ChapterID != "ch7" {
			return memory.View{}, ErrContextMismatch
		}
		return v, nil
	}
	t := b.WritingTask
	if b.POVCharacterID == "" || t.ChapterNumber < 1 || t.StoryTime < 0 {
		return memory.View{}, ErrContextMismatch
	}
	v := memory.View{ProjectID: b.ProjectID, BranchID: b.BranchID, POV: b.POVCharacterID, At: memory.Moment{Chapter: t.ChapterNumber, StoryTime: t.StoryTime}, CatalogBound: true, Knowledge: t.Knowledge}
	for _, p := range t.Publications {
		v.Publications = append(v.Publications, memory.PublicationRef{ID: p.ID, ChapterID: p.ChapterID, Version: p.Version})
	}
	return v, nil
}

// CurrentMemoryView 仍是 ch7/main 学习切片的服务端创作位置，不接受浏览器扩大权限。
func CurrentMemoryView() memory.View {
	return memory.View{ProjectID: "zhuoliu", BranchID: "main", POV: "character-shenyan", At: memory.Moment{Chapter: 7, StoryTime: 420}}
}
