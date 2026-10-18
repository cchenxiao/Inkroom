package postgres

import (
	"context"
	"encoding/json"
	"inkloom/internal/app"
	"inkloom/internal/domain/knowledge"
	"inkloom/internal/domain/memory"
	"inkloom/internal/retrieval"
)

// Read only exact published inputs. Projection is immediately available for old
// and new publications without mutating the input knowledge head or re-adopting prose.
func (s *Store) plannedMemorySnapshot(ctx context.Context, v memory.View) (retrieval.Snapshot, error) {
	out := retrieval.Snapshot{Records: []memory.Record{}, Pins: map[string]memory.Pin{}, Origins: map[string]retrieval.Origin{}}
	add := func(r memory.Record, origin retrieval.Origin) {
		out.Records = append(out.Records, r)
		out.Pins[r.ID] = memory.Pin{Version: r.Version, Digest: memory.Digest(r)}
		out.Origins[r.ID] = origin
	}
	if v.Knowledge != nil {
		k, err := s.GetKnowledge(ctx, v.ProjectID, v.BranchID, v.Knowledge.Version)
		if err != nil {
			return out, err
		}
		if k.Digest != v.Knowledge.Digest {
			return out, app.ErrContextMismatch
		}
		records, err := knowledge.Records(k.Snapshot)
		if err != nil {
			return out, err
		}
		for _, r := range records {
			r.ID = "knowledge/" + r.ID
			r.Version = k.Snapshot.Version
			r.Knowledge = v.Knowledge
			add(r, retrieval.Origin{Kind: "knowledge"})
		}
	}
	seen := map[string]bool{}
	for i, ref := range v.Publications {
		if seen[ref.ID] {
			return out, app.ErrContextMismatch
		}
		seen[ref.ID] = true
		var raw []byte
		if err := s.pool.QueryRow(ctx, "SELECT record FROM chapter_publications WHERE id=$1 AND scope=$2 AND chapter_id=$3 AND version=$4", ref.ID, v.ProjectID+"/"+v.BranchID, ref.ChapterID, ref.Version).Scan(&raw); err != nil {
			return out, err
		}
		var pub app.ChapterPublication
		if err := json.Unmarshal(raw, &pub); err != nil {
			return out, err
		}
		records, err := app.PublicationMemory(pub, i+1)
		if err != nil {
			return out, err
		}
		for _, r := range records {
			add(r, retrieval.Origin{Kind: "publication", CommitID: pub.ID})
		}
	}
	return out, nil
}
