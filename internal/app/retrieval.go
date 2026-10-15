package app

import (
	"fmt"
	"inkloom/internal/config"
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

// CurrentMemoryView 仍是 ch7/main 学习切片的服务端创作位置，不接受浏览器扩大权限。
func CurrentMemoryView() memory.View {
	return memory.View{ProjectID: "zhuoliu", BranchID: "main", POV: "character-shenyan", At: memory.Moment{Chapter: 7, StoryTime: 420}}
}
