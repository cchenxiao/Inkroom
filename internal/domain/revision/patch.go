// Package revision 负责验证与应用 patch，模型只提议，版本由程序递增。
package revision

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

type Patch struct {
	FindingID  string `json:"findingId"`
	SegmentID  string `json:"segmentId"`
	ChangeType string `json:"changeType"`
	OldText    string `json:"oldText"`
	NewText    string `json:"newText"`
	Reason     string `json:"reason"`
}
type Proposal struct {
	BasedOnDraftVersion int     `json:"basedOnDraftVersion"`
	Patches             []Patch `json:"patches"`
}
type Revision struct {
	Round       int     `json:"round"`
	FromVersion int     `json:"fromVersion"`
	ToVersion   int     `json:"toVersion"`
	Patches     []Patch `json:"patches"`
}

var numbers = regexp.MustCompile(`[0-9]+(?:[.：:][0-9]+)*|[零一二三四五六七八九十百千万两]+[年月日点岁时分秒米里人次枚个辆把章节艘条件支颗座间本张份只匹杯克吨斤盒袋瓶块页封户位所笔套盏根朵批轮层台部架]`)
var negations = regexp.MustCompile(`没有|不是|不能|不会|未曾|并非|从未|不曾|不|没|未`)

// Apply 全量验证后一次性应用；失败返回原稿，不允许部分 patch 先落入候选。
// I4 只支持原 quote 的唯一命中；复杂事实语义交 I5 一致性 Critic，不声称这里能证明语义等价。
func Apply(segments []manuscript.Segment, findings []review.Finding, version int, p Proposal, protected []string) ([]manuscript.Segment, error) {
	fail := func(reason string) ([]manuscript.Segment, error) { return segments, fmt.Errorf("%s", reason) }
	if p.BasedOnDraftVersion != version {
		return fail("修订基准版本已失效")
	}
	if len(p.Patches) == 0 {
		return fail("修订 Agent 未提供可安全应用的 patch")
	}
	fs := map[string]review.Finding{}
	for _, f := range findings {
		if _, ok := fs[f.ID]; ok {
			return fail("问题 ID 重复，无法唯一定位修订目标")
		}
		fs[f.ID] = f
	}
	type located struct {
		patch      Patch
		start, end int
	}
	grouped := map[string][]located{}
	seen := map[string]bool{}
	for _, patch := range p.Patches {
		f, ok := fs[patch.FindingID]
		if !ok || seen[patch.FindingID] || f.Severity != review.P2 || f.Critic != "ai_taste" || f.RepairScope != "phrase" || f.DraftVersion != version || f.SegmentID != patch.SegmentID {
			return fail("修订超出本轮 P2 句级授权范围")
		}
		seen[patch.FindingID] = true
		if patch.OldText == "" || !matchesQuote(patch.OldText, f.Quote) || patch.NewText == patch.OldText || strings.TrimSpace(patch.Reason) == "" {
			return fail("patch 必须准确匹配问题引文并产生有效修改")
		}
		if patch.ChangeType != "replace" && patch.ChangeType != "delete" {
			return fail("当前只授权替换或删除问题引文")
		}
		if (patch.ChangeType == "delete") != (patch.NewText == "") {
			return fail("patch 类型与替换内容不一致")
		}
		if strings.ContainsAny(patch.NewText, "\r\n") || utf8.RuneCountInString(patch.NewText) > 2*utf8.RuneCountInString(patch.OldText)+32 {
			return fail("patch 超出局部字句范围")
		}
		for _, term := range protected {
			if term != "" && strings.Count(patch.OldText, term) != strings.Count(patch.NewText, term) {
				return fail("patch 改变了受保护实体或事实词")
			}
		}
		for _, rx := range []*regexp.Regexp{numbers, negations} {
			if !slices.Equal(rx.FindAllString(patch.OldText, -1), rx.FindAllString(patch.NewText, -1)) {
				return fail("patch 改变了数字、时间或否定关系")
			}
		}
		idx := slices.IndexFunc(segments, func(s manuscript.Segment) bool { return s.ID == patch.SegmentID })
		if idx < 0 || !uniqueMatch(segments[idx].Text, patch.OldText) {
			return fail("问题引文缺失或重复，无法唯一定位")
		}
		start := strings.Index(segments[idx].Text, patch.OldText)
		// 删除句末套语时不能一并拿走句号、把前面的逗号悬空。
		if patch.ChangeType == "delete" && strings.HasSuffix(patch.OldText, "。") && strings.HasSuffix(segments[idx].Text[:start], "，") {
			return fail("删除套话会留下悬空逗号，请保留句号并调整引文前的逗号")
		}
		grouped[patch.SegmentID] = append(grouped[patch.SegmentID], located{patch, start, start + len(patch.OldText)})
	}
	out := append([]manuscript.Segment(nil), segments...)
	for i, s := range out {
		edits := grouped[s.ID]
		slices.SortFunc(edits, func(a, b located) int { return a.start - b.start })
		for j := 1; j < len(edits); j++ {
			if edits[j].start < edits[j-1].end {
				return fail("patch 范围重叠，需人工确认")
			}
		}
		for j := len(edits) - 1; j >= 0; j-- {
			e := edits[j]
			s.Text = s.Text[:e.start] + e.patch.NewText + s.Text[e.end:]
		}
		if strings.TrimSpace(s.Text) == "" {
			return fail("句级修订不能清空正文段")
		}
		for _, term := range protected {
			if term != "" && strings.Count(segments[i].Text, term) != strings.Count(s.Text, term) {
				return fail("修订边界改变了受保护词")
			}
		}
		for _, rx := range []*regexp.Regexp{numbers, negations} {
			if !slices.Equal(rx.FindAllString(segments[i].Text, -1), rx.FindAllString(s.Text, -1)) {
				return fail("修订边界改变了数字或否定关系")
			}
		}
		if len(edits) > 0 {
			s.Version = version + 1
		}
		out[i] = s
	}
	return out, nil
}

// 允许把紧邻引文的逗号/句末标点纳入 patch，避免删除后留下“，。”；不可扩到其他文字。
func matchesQuote(old, quote string) bool {
	if quote == "" || strings.Count(old, quote) != 1 {
		return false
	}
	before, after, _ := strings.Cut(old, quote)
	return strings.Trim(before, "，,。.;；") == "" && strings.Trim(after, "，,。.;；") == ""
}

// strings.Count 不计重叠命中；“哈哈哈”里的“哈哈”不能被视作唯一锚点。
func uniqueMatch(text, fragment string) bool {
	if fragment == "" {
		return false
	}
	first := strings.Index(text, fragment)
	return first >= 0 && !strings.Contains(text[first+1:], fragment)
}
