package retrieval

import (
	"context"
	"fmt"
	"inkloom/internal/domain/memory"
	"reflect"
)

// Session 固定一次准备阶段的来源目录。多次查询复用相同记录/Pin，不追逐最新头。
func (s Service) Session(ctx context.Context, v memory.View) (*Service, error) {
	snapshot, err := s.Repo.MemorySnapshot(ctx, v)
	if err != nil {
		return nil, failed("memory_catalog_failed", "读取当前版本的前情材料失败，请重试", err)
	}
	s.Repo = &sessionRepository{Repository: s.Repo, snapshot: snapshot, view: v}
	return &s, nil
}

type sessionRepository struct {
	Repository
	snapshot Snapshot
	view     memory.View
}

func (s *sessionRepository) MemorySnapshot(_ context.Context, v memory.View) (Snapshot, error) {
	if v.ProjectID != s.view.ProjectID || v.BranchID != s.view.BranchID || v.POV != s.view.POV || v.At != s.view.At || v.CatalogBound != s.view.CatalogBound || !reflect.DeepEqual(v.Knowledge, s.view.Knowledge) || !reflect.DeepEqual(v.Publications, s.view.Publications) {
		return Snapshot{}, fmt.Errorf("lookup session scope mismatch")
	}
	return s.snapshot, nil
}
