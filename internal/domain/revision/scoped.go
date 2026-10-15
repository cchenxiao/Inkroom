package revision

import (
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

// ApplyScoped 只应用通过授权路由的本场/Beat 替换。事实语义由随后两个 Critic 复检，不能当作已定稿。
func ApplyScoped(segments []manuscript.Segment, report review.Report, route review.Decision, p Proposal) ([]manuscript.Segment, error) {
	fail := func(msg string) ([]manuscript.Segment, error) { return segments, fmt.Errorf("%s", msg) }
	if route.NeedsHuman || (route.Kind != "structural" && route.Kind != "scene") {
		return fail("未授权局部重写")
	}
	if p.BasedOnDraftVersion != report.DraftVersion {
		return fail("重写基准版本已失效")
	}
	if len(p.Patches) == 0 {
		return fail("没有可安全应用的局部重写方案")
	}
	out := append([]manuscript.Segment{}, segments...)
	seen := map[string]bool{}
	for _, patch := range p.Patches {
		i := slices.IndexFunc(segments, func(s manuscript.Segment) bool { return s.ID == patch.SegmentID })
		f := slices.IndexFunc(report.Findings, func(f review.Finding) bool { return f.ID == patch.FindingID })
		if i < 0 || f < 0 || !slices.Contains(route.TargetIDs, patch.SegmentID) || !slices.Contains(route.FindingIDs, patch.FindingID) || seen[patch.SegmentID] {
			return fail("重写超出本轮批准范围或重复修改同一段")
		}
		finding := report.Findings[f]
		origin := slices.IndexFunc(segments, func(s manuscript.Segment) bool { return s.ID == finding.SegmentID })
		if finding.DraftVersion != report.DraftVersion || finding.RequiresHuman || finding.PossibleDialogueLie || origin < 0 || (route.Kind == "structural" && (finding.Severity != review.P0 || segments[origin].BeatID != segments[i].BeatID)) || (route.Kind == "scene" && (finding.Severity != review.P1 || segments[origin].SceneID != segments[i].SceneID)) {
			return fail("重写与当前问题范围不匹配")
		}
		if patch.ChangeType != "replace" || patch.OldText != segments[i].Text || patch.NewText == patch.OldText || strings.TrimSpace(patch.NewText) == "" || strings.TrimSpace(patch.Reason) == "" || utf8.RuneCountInString(patch.NewText) > 2*utf8.RuneCountInString(patch.OldText)+400 {
			return fail("重写必须准确匹配原段且保持有界的有效正文")
		}
		seen[patch.SegmentID] = true
		out[i].Text = patch.NewText
		out[i].Version = report.DraftVersion + 1
	}
	return out, nil
}
