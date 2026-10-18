package manuscript

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestCompactChapterContextRetainsDistinctPOVEvidence(t *testing.T) {
	source := SourceRef{ID: "fact", Version: 1, Text: "already confirmed"}
	b := ContextBundle{PreviousEnding: &source, Facts: []SourceRef{source}, Targets: []ContextBundle{
		{PreviousEnding: &source, Facts: []SourceRef{source}},
		{PreviousEnding: &source, Facts: []SourceRef{{ID: "other", Version: 2, Text: "different POV"}}},
	}}
	legacy, _ := json.Marshal(b)
	b.CompactTargets = true
	raw, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) >= len(legacy) {
		t.Fatal("common context not shared")
	}
	var restored ContextBundle
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(b, restored) {
		t.Fatalf("lost or leaked evidence: %+v", restored)
	}
	again, _ := json.Marshal(restored)
	if string(raw) != string(again) {
		t.Fatal("unstable digest")
	}
	b.CompactTargets = false
	unchanged, _ := json.Marshal(b)
	if string(legacy) != string(unchanged) {
		t.Fatal("legacy digest changed")
	}
}
