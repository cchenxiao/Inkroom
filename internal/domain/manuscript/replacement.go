package manuscript

import (
	"fmt"
	"strings"
)

// NormalizeReplacementBoundary only removes duplicate single punctuation from
// the model's replacement. The pinned prefix/suffix remain byte-for-byte intact.
// Repeated dots, ellipses and dashes are intentional sequences and excluded.
func NormalizeReplacementBoundary(req AuthorRewrite, replacement string) string {
	original, out := []rune(req.Original), []rune(replacement)
	single := func(r rune) bool { return strings.ContainsRune("，。；：！？、,;:!?", r) }
	if req.Start > 0 {
		for len(out) > 0 && single(original[req.Start-1]) && out[0] == original[req.Start-1] {
			out = out[1:]
		}
	}
	if req.End < len(original) {
		for len(out) > 0 && single(original[req.End]) && out[len(out)-1] == original[req.End] {
			out = out[:len(out)-1]
		}
	}
	return string(out)
}
func ApplyAuthorReplacement(original string, req AuthorRewrite, replacement string) (string, error) {
	chars := []rune(original)
	if original != req.Original || req.Start < 0 || req.End <= req.Start || req.End > len(chars) {
		return "", fmt.Errorf("选区原文或版本已变化")
	}
	if replacement == string(chars[req.Start:req.End]) {
		return "", fmt.Errorf("选中的正文没有变化")
	}
	result := string(chars[:req.Start]) + replacement + string(chars[req.End:])
	if strings.TrimSpace(result) == "" || len([]rune(result)) > 20000 {
		return "", fmt.Errorf("正文需为 1–20000 字")
	}
	return result, nil
}
