package app

import (
	"context"
	"fmt"
	"inkloom/internal/config"
	"inkloom/internal/demo"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/embedding"
	"inkloom/internal/retrieval"
	"time"
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
func PrepareRetrievedContext(ctx context.Context, cfg config.Config, scenario, runID string, base int, s *retrieval.Service) (manuscript.FrozenInput, error) {
	bundle, _, err := demo.Load(scenario)
	if err != nil {
		return manuscript.FrozenInput{}, err
	}
	query := bundle.Beat.Title + " " + bundle.Beat.Description
	lookup, stop := context.WithTimeout(ctx, 10*time.Second)
	defer stop()
	result, err := s.Search(lookup, CurrentMemoryView(), query, 3)
	if err != nil {
		return manuscript.FrozenInput{}, err
	}
	return prepareContext(cfg, scenario, runID, base, &result)
}
