package manuscript

import "testing"

func TestReplacementBoundaryPreservesUnselectedText(t *testing.T) {
	for _, tc := range []struct {
		original          string
		start, end        int
		replacement, want string
	}{
		{"前文。陆青说完，像是觉得这话太实，又添了半句，后文。", 3, 22, "陆青说完，又补了半句，", "前文。陆青说完，又补了半句，后文。"},
		{"甲，旧句。乙", 2, 4, "，新句。", "甲，新句。乙"},
		{"他🙂开门。她等着。", 2, 4, "敲门。", "他🙂敲门。她等着。"},
		{"甲……旧句……乙", 3, 5, "……", "甲………………乙"},
		{"甲。删掉这句。乙。", 2, 7, "", "甲。乙。"},
	} {
		req := AuthorRewrite{Original: tc.original, Start: tc.start, End: tc.end}
		replacement := NormalizeReplacementBoundary(req, tc.replacement)
		got, err := ApplyAuthorReplacement(tc.original, req, replacement)
		if err != nil || got != tc.want {
			t.Fatalf("got %q want %q error %v", got, tc.want, err)
		}
	}
}
