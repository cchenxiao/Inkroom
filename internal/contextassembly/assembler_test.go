package contextassembly_test

import (
	"testing"

	"inkloom/internal/contextassembly"
	"inkloom/internal/demo"
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
