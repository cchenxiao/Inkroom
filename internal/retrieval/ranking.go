package retrieval

import (
	"sort"
	"strings"
	"unicode"
)

// Terms 对中文取相邻双字，对拉丁文本取词。先用可解释的最小分词，避免依赖英语 FTS。
func Terms(text string) []string {
	set := map[string]bool{}
	var han []rune
	var word []rune
	flushHan := func() {
		if len(han) == 1 {
			set[string(han)] = true
		}
		for i := 1; i < len(han); i++ {
			set[string(han[i-1:i+1])] = true
		}
		han = nil
	}
	flushWord := func() {
		if len(word) > 0 {
			set[string(word)] = true
		}
		word = nil
	}
	for _, r := range strings.ToLower(text) {
		switch {
		case unicode.Is(unicode.Han, r):
			flushWord()
			han = append(han, r)
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			flushHan()
			word = append(word, r)
		default:
			flushHan()
			flushWord()
		}
	}
	flushHan()
	flushWord()
	out := make([]string, 0, len(set))
	for s := range set {
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}
func coverage(query, text string) float64 {
	terms := Terms(query)
	if len(terms) == 0 {
		return 0
	}
	found := 0
	text = strings.ToLower(text)
	for _, term := range terms {
		if strings.Contains(text, term) {
			found++
		}
	}
	return float64(found) / float64(len(terms))
}
func ordered(scores map[string]float64) []Ranked {
	out := make([]Ranked, 0, len(scores))
	for id, score := range scores {
		out = append(out, Ranked{id, score})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].Digest < out[j].Digest
		}
		return out[i].Score > out[j].Score
	})
	return out
}

// RRF 不把词面分和余弦相似度直接相加，而是融合两个通道里的名次。
func fuse(channels ...[]Ranked) map[string]float64 {
	scores := map[string]float64{}
	for _, channel := range channels {
		for i, r := range channel {
			scores[r.Digest] += 1 / float64(60+i+1)
		}
	}
	return scores
}
