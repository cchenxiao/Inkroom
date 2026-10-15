package main

import (
	"fmt"
	"io"
	"slices"

	"inkloom/internal/demo"
	"inkloom/internal/domain/knowledge"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
)

func knowledgePreview(w io.Writer, pov string, chapter int, storyTime int64) error {
	s, err := demo.KnowledgeSnapshot()
	if err != nil {
		return err
	}
	at := memory.Moment{Chapter: chapter, StoryTime: storyTime}
	selected, err := knowledge.Project(s, memory.View{ProjectID: s.ProjectID, BranchID: s.BranchID, POV: pov, At: at})
	if err != nil {
		return err
	}
	digest, err := manuscript.ContentDigest(s)
	if err != nil {
		return err
	}
	names := map[string]string{"character-shenyan": "沈砚", "character-luqing": "陆青", "reader": "读者"}
	fmt.Fprintf(w, "知识建模演示 · 第 %d 章 · 故事时点 %d · %s视角\n", chapter, storyTime, names[pov])
	fmt.Fprintf(w, "独立教学快照 · %s/%s v%d · %s\n", s.ProjectID, s.BranchID, s.Version, digest[:12])
	fmt.Fprintln(w, "不读取密钥、不调用模型、不写数据库。下方作者台账不可整包传给 Writer。")
	fmt.Fprintf(w, "\n角色可用事实（%d 条）\n", len(selected.CharacterContext))
	for _, m := range selected.CharacterContext {
		fmt.Fprintf(w, "- %s\n  来源 %s/%s · v%d\n", m.Text, m.ChapterID, m.SegmentID, m.Version)
	}
	fmt.Fprintln(w, "\n未纳入角色材料（只解释原因，不回显秘密）")
	for _, x := range selected.Excluded {
		fmt.Fprintf(w, "- %s：%s\n", x.ID, exclusionLabels[x.Reason])
	}
	fmt.Fprintln(w, "\n作者视图 · 完整时间线（含未来/倒叙资料，按故事时间排序）")
	events := slices.Clone(s.Timeline)
	slices.SortStableFunc(events, func(a, b knowledge.TimelineEvent) int {
		if a.Source.At.StoryTime < b.Source.At.StoryTime {
			return -1
		}
		if a.Source.At.StoryTime > b.Source.At.StoryTime {
			return 1
		}
		return 0
	})
	for _, e := range events {
		fmt.Fprintf(w, "- 时点 %d · 来源第 %d 章/%s · %s\n", e.Source.At.StoryTime, e.Source.At.Chapter, e.Source.SegmentID, e.Summary)
	}
	fmt.Fprintln(w, "\n作者视图 · 当前时点信息差（未获知不等于事实为假）")
	labels := map[string]string{"known": "已知", "belief": "误解/未证实理解", "not_known": "未获知"}
	for _, f := range s.Facts {
		fmt.Fprintf(w, "- %s\n", f.Text)
		for _, subject := range append(slices.Clone(s.Characters), "reader") {
			fmt.Fprintf(w, "  %s：%s", names[subject], labels[s.InformationAt(f.ID, subject, at)])
		}
		fmt.Fprintln(w)
	}
	fmt.Fprintln(w, "\n作者视图 · 伏笔台账（快照状态，不随预览时点重建历史；到期不自动回收）")
	statuses := map[knowledge.ForeshadowStatus]string{knowledge.Open: "待回收", knowledge.Closed: "已回收", knowledge.Abandoned: "已放弃"}
	for _, f := range s.Foreshadows {
		overdue := ""
		if f.Overdue(chapter) {
			overdue = " · 已逾期"
		}
		fmt.Fprintf(w, "- %s · %s · %s%s\n  埋设 %s/%s → 计划第 %d 章 · %s\n", f.Title, f.Importance, statuses[f.Status], overdue, f.Planted.ChapterID, f.Planted.SegmentID, f.PlanResolveChapter, f.Payload)
		if f.Resolved != nil {
			fmt.Fprintf(w, "  回收依据 %s/%s\n", f.Resolved.ChapterID, f.Resolved.SegmentID)
		}
		if f.AbandonReason != "" {
			fmt.Fprintf(w, "  放弃理由：%s\n", f.AbandonReason)
		}
	}
	return nil
}
