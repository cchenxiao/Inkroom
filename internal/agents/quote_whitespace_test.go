package agents

import (
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"testing"
)

func TestQuoteWhitespaceRestoresOnlyUniqueExactCharacters(t *testing.T) {
	for _, c := range []struct{ text, quote, want string }{
		{"前文。\n\n后文。", "前文。后文。", "前文。\n\n后文。"},
		{"前文。后文。", "前文，后文。", "前文，后文。"},
		{"旧 句。旧\n句。", "旧句。", "旧句。"},
	} {
		fs := []review.Finding{{SegmentID: "s", Quote: c.quote}}
		restoreQuoteWhitespace(fs, []manuscript.Segment{{ID: "s", Text: c.text}})
		if fs[0].Quote != c.want {
			t.Fatal(c, fs)
		}
	}
}
