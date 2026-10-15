package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"inkloom/internal/embedding"
	"inkloom/internal/retrieval"
	"reflect"
)

func (s *Store) CachedVectors(ctx context.Context, keys []string, model string) (map[string][]float32, error) {
	out := map[string][]float32{}
	rows, err := s.pool.Query(ctx, `SELECT digest,embedding::text FROM memory_embeddings WHERE digest=ANY($1) AND model=$2`, keys, model)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key, raw string
		if err = rows.Scan(&key, &raw); err != nil {
			return nil, err
		}
		var v []float32
		if err = json.Unmarshal([]byte(raw), &v); err != nil {
			return nil, err
		}
		out[key] = v
	}
	return out, rows.Err()
}
func (s *Store) SaveVector(ctx context.Context, key, model string, v []float32) error {
	if model == "" {
		return fmt.Errorf("embedding identity required")
	}
	if err := embedding.Validate(v, 0); err != nil {
		return err
	}
	raw, _ := json.Marshal(v)
	tag, err := s.pool.Exec(ctx, `INSERT INTO memory_embeddings VALUES($1,$2,$3,$4::vector) ON CONFLICT DO NOTHING`, key, model, len(v), string(raw))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		cached, e := s.CachedVectors(ctx, []string{key}, model)
		if e != nil {
			return e
		}
		if !reflect.DeepEqual(cached[key], v) {
			return fmt.Errorf("embedding changed under same model revision")
		}
	}
	return nil
}
func (s *Store) Nearest(ctx context.Context, keys []string, model string, q []float32, limit int) ([]retrieval.Ranked, error) {
	if err := embedding.Validate(q, 0); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 20 {
		return nil, fmt.Errorf("invalid vector limit")
	}
	raw, _ := json.Marshal(q)
	// 先限定已通过可见性规则的 digest 集合，再排序；不从全库召回后随意删几条。
	rows, err := s.pool.Query(ctx, `SELECT digest,1-(embedding <=> $3::vector) AS score FROM memory_embeddings WHERE digest=ANY($1) AND model=$2 AND dimensions=$4 ORDER BY embedding <=> $3::vector,digest LIMIT $5`, keys, model, string(raw), len(q), limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (retrieval.Ranked, error) {
		var r retrieval.Ranked
		e := row.Scan(&r.Digest, &r.Score)
		return r, e
	})
}
