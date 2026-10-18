package planning

import "testing"

func TestChapterWordTargetDefaultsToThreeThousand(t *testing.T) {
	for _, c := range []struct{ outline, override, want int }{{8000, 0, 3000}, {600, 0, 600}, {8000, 2400, 2400}, {8000, 4000, 4000}} {
		if got := ChapterWordTarget(c.outline, c.override); got != c.want {
			t.Fatal(c, got)
		}
	}
}
