package agents

import (
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"strings"
	"unicode"
)

// Restore only uniquely matching whitespace changes in model citations. Words,
// punctuation, segment identity and ambiguous citations remain strict errors.
func restoreQuoteWhitespace(findings []review.Finding, segments []manuscript.Segment) {
	for i := range findings {
		f := &findings[i]
		for _, s := range segments {
			if s.ID != f.SegmentID || strings.Contains(s.Text, f.Quote) {
				continue
			}
			q := []rune{}
			for _, r := range f.Quote {
				if !unicode.IsSpace(r) {
					q = append(q, r)
				}
			}
			if len(q) == 0 {
				continue
			}
			text := []rune(s.Text)
			flat := []rune{}
			positions := []int{}
			for p, r := range text {
				if !unicode.IsSpace(r) {
					flat = append(flat, r)
					positions = append(positions, p)
				}
			}
			start, count := -1, 0
			for p := 0; p+len(q) <= len(flat); p++ {
				if string(flat[p:p+len(q)]) == string(q) {
					start = p
					count++
				}
			}
			if count == 1 {
				f.Quote = string(text[positions[start] : positions[start+len(q)-1]+1])
			}
		}
	}
}
