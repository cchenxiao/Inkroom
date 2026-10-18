package manuscript

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// ApplyManualEdits validates every target before returning an isolated copy.
// Callers bind the request to a source version and commit the complete set atomically.
func ApplyManualEdits(source []Segment, edits map[string]string) ([]Segment, error) {
	if len(edits) == 0 {
		return nil, fmt.Errorf("没有需要保存的正文修改")
	}
	out := append([]Segment{}, source...)
	found := 0
	changed := false
	for i := range out {
		text, ok := edits[out[i].ID]
		if !ok {
			continue
		}
		if strings.TrimSpace(text) == "" || utf8.RuneCountInString(text) > 20000 {
			return nil, fmt.Errorf("正文需为 1–20000 字")
		}
		found++
		changed = changed || text != out[i].Text
		out[i].Text = text
	}
	if found != len(edits) {
		return nil, fmt.Errorf("修改目标不属于当前正文，请刷新后对照本地修改")
	}
	if !changed {
		return nil, fmt.Errorf("正文没有变化")
	}
	return out, nil
}
