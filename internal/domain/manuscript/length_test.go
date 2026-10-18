package manuscript

import "testing"

func TestMeasureLengthScopeUnicodeAndBoundaries(t *testing.T) {
	b := ContextBundle{WritingTask: &WritingTask{ChapterTargetWords: 2400, BeatTargetWords: 800}}
	s := []Segment{{Text: "他 🙂\n开门。"}}
	if got := MeasureLength(s, b); got.Actual != 5 || got.Scope != "beat" || got.Target != 800 || got.Status != "short" {
		t.Fatal(got)
	}
	b.Targets = []ContextBundle{{}}
	if got := MeasureLength(s, b); got.Scope != "chapter" || got.Lower != 1800 || got.Upper != 3000 {
		t.Fatal(got)
	}
	if MeasureLength(nil, b) != nil || MeasureLength(s, ContextBundle{}) != nil {
		t.Fatal("invented missing target")
	}
	for _, n := range []int{1799, 1800, 3000, 3001} {
		chars := make([]rune, n)
		for i := range chars {
			chars[i] = '字'
		}
		got := MeasureLength([]Segment{{Text: string(chars)}}, b)
		want := "within"
		if n < 1800 {
			want = "short"
		}
		if n > 3000 {
			want = "long"
		}
		if got.Status != want {
			t.Fatal(n, got)
		}
	}
}

func TestPartialChapterLengthExcludesPreservedBeats(t *testing.T) {
	b := ContextBundle{WritingTask: &WritingTask{ChapterTargetWords: 8000}, Targets: []ContextBundle{
		{WritingTask: &WritingTask{BeatTargetWords: 2000}}, {WritingTask: &WritingTask{BeatTargetWords: 2000}}, {WritingTask: &WritingTask{BeatTargetWords: 2000}},
	}}
	if got := MeasureLength([]Segment{{Text: "正文"}}, b); got.Target != 6000 {
		t.Fatal(got)
	}
}
