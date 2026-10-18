package memory

import (
	"encoding/hex"
	"fmt"
	"math"
	"strings"
)

// ValidateRetrieval 用保存的范围与 Pin 再验一次，防止装配或恢复时把规划/越界片段混进去。
func ValidateRetrieval(c RetrievalContext) error {
	if strings.TrimSpace(c.Query) == "" || c.Ranker != "rrf60-coverage-v1" || (c.Mode != "keyword" && c.Mode != "hybrid_fake" && c.Mode != "hybrid_zhipu") {
		return fmt.Errorf("invalid retrieval metadata")
	}
	v := c.View
	v.Pins = map[string]Pin{}
	records := []Record{}
	for _, h := range c.Hits {
		if h.Method != c.Mode || math.IsNaN(h.Score) || math.IsInf(h.Score, 0) || h.Score < 0 || (h.Origin != "commit" && h.Origin != "publication" && h.Origin != "teaching_seed" && h.Origin != "knowledge") || ((h.Origin == "commit" || h.Origin == "publication") && h.CommitID == "") || (h.Origin != "commit" && h.Origin != "publication" && h.CommitID != "") {
			return fmt.Errorf("invalid retrieval provenance")
		}
		if v.CatalogBound && h.Origin != "publication" && h.Origin != "knowledge" {
			return fmt.Errorf("planned retrieval contains an unpinned source origin")
		}
		if v.CatalogBound && h.Origin == "knowledge" && (v.Knowledge == nil || h.Record.Knowledge == nil || *v.Knowledge != *h.Record.Knowledge) {
			return fmt.Errorf("retrieval knowledge version mismatch")
		}
		if h.Origin == "publication" {
			found := false
			for _, p := range v.Publications {
				if p.ID == h.CommitID && p.ChapterID == h.Record.ChapterID && p.Version == h.Record.Version && strings.HasPrefix(h.Record.ID, "publication/"+p.ID+"/") {
					found = true
				}
			}
			if !v.CatalogBound || !found {
				return fmt.Errorf("publication not pinned in retrieval scope")
			}
		}
		k := h.Record.Knowledge
		if h.Origin == "knowledge" && k == nil {
			return fmt.Errorf("missing knowledge snapshot provenance")
		}
		if k != nil {
			digest, err := hex.DecodeString(k.Digest)
			if err != nil || len(digest) != 32 || k.Version != h.Record.Version || k.Version < 1 || !strings.HasPrefix(h.Record.ID, "knowledge/") || h.Record.Kind != Fact || h.Origin == "commit" {
				return fmt.Errorf("invalid knowledge snapshot provenance")
			}
		}
		v.Pins[h.Record.ID] = Pin{Version: h.Record.Version, Digest: h.Digest}
		records = append(records, h.Record)
	}
	selected, err := Select(v, records)
	if err != nil {
		return err
	}
	if len(selected.Excluded) > 0 || len(selected.AuthorPlans) > 0 || len(selected.CharacterContext) != len(c.Hits) {
		return fmt.Errorf("retrieved material violates visibility policy")
	}
	return nil
}
