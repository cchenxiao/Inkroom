package contextassembly_test

import (
	"testing"

	"inkloom/internal/contextassembly"
	"inkloom/internal/demo"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
)

func TestPinnedAssemblyBoundaries(t *testing.T) {
	b, _, err := demo.Load("normal")
	if err != nil {
		t.Fatal(err)
	}
	opts := contextassembly.Options{RunID: "test", Budget: 8000, ReservedOutputTokens: 2048, Excluded: demo.ExcludedContext()}
	frozen, err := contextassembly.Assemble(b, demo.PreviousChapter(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(frozen.Manifest.Excluded) == 0 || frozen.Bundle.PreviousEnding == nil {
		t.Fatal("missing context accounting")
	}
	original := frozen.Bundle.Characters[0].HardTraits[0].Text
	b.Characters[0].HardTraits[0].Text = "作者随后改了设定"
	if frozen.Bundle.Characters[0].HardTraits[0].Text != original {
		t.Fatal("input was not copied")
	}
	if err = frozen.Validate(); err != nil {
		t.Fatal(err)
	}
	changed := frozen
	changed.Manifest.Digest = "wrong"
	if changed.Validate() == nil {
		t.Fatal("changed input digest accepted")
	}
	opts.Budget = 1
	if _, err = contextassembly.Assemble(b, demo.PreviousChapter(), opts); err == nil {
		t.Fatal("silently dropped required constraints")
	}
	opts.Budget = 8000
	prior := demo.PreviousChapter()
	prior.Confirmed = false
	if _, err = contextassembly.Assemble(b, prior, opts); err == nil {
		t.Fatal("unconfirmed previous draft leaked")
	}
	prior = demo.PreviousChapter()
	prior.BranchID = "other"
	if _, err = contextassembly.Assemble(b, prior, opts); err == nil {
		t.Fatal("other branch leaked")
	}
	b.Beat.Locked = false
	if _, err = contextassembly.Assemble(b, demo.PreviousChapter(), opts); err == nil {
		t.Fatal("unlocked beat accepted")
	}
}

func TestRetrievedFactsAlreadyInFrozenInputAreNotDuplicated(t *testing.T) {
	b, _, _ := demo.Load("normal")
	v, records, err := demo.MemoryPreview("character-shenyan")
	if err != nil {
		t.Fatal(err)
	}
	b.POVCharacterID = v.POV
	var hit memory.Hit
	selected, err := memory.Select(v, records)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range records {
		for _, m := range selected.CharacterContext {
			if r.ID == m.ID && r.Kind == memory.Fact {
				hit = memory.Hit{Record: r, Digest: memory.Digest(r), Origin: "teaching_seed", Method: "keyword", Score: 1}
				break
			}
		}
	}
	if hit.Record.ID == "" {
		t.Fatal("fixture fact missing")
	}
	b.Facts = append(b.Facts, manuscript.SourceRef{ID: hit.Record.ID, Version: hit.Record.Version, Text: hit.Record.Text})
	r := memory.RetrievalContext{View: v, Query: "前情", Mode: "keyword", Ranker: "rrf60-coverage-v1", Hits: []memory.Hit{hit}}
	opts := contextassembly.Options{RunID: "dedup", Budget: 16000, ReservedOutputTokens: 2048, Memory: &r}
	got, err := contextassembly.Assemble(b, demo.PreviousChapter(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Bundle.Retrieval.Hits) != 0 {
		t.Fatal("duplicate source attached")
	}
	r.Hits[0].Record.Text += "changed"
	r.Hits[0].Digest = memory.Digest(r.Hits[0].Record)
	if _, err = contextassembly.Assemble(b, demo.PreviousChapter(), opts); err == nil {
		t.Fatal("conflicting record silently discarded")
	}
}
