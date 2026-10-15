package main

import (
	"fmt"
	"io"

	"inkloom/internal/demo"
	"inkloom/internal/domain/memory"
)

func contextPreview(w io.Writer, pov string) error {
	v, records, err := demo.MemoryPreview(pov)
	if err != nil {
		return err
	}
	result, err := memory.Select(v, records)
	if err != nil {
		return err
	}
	name := map[string]string{"character-shenyan": "沈砚", "character-luqing": "陆青"}[pov]
	fmt.Fprintf(w, "材料可见性演示 · 第 %d 章 · %s视角 · 故事时点 %d\n", v.At.Chapter, name, v.At.StoryTime)
	fmt.Fprintln(w, "以下为独立教学记录，不是正式设定；不读取密钥、不调用模型、不写数据库。")
	fmt.Fprintf(w, "\n角色可以使用的材料（%d 条）\n", len(result.CharacterContext))
	kinds := map[memory.Kind]string{memory.Fact: "已确认事实", memory.Passage: "原文/台词，不能当作世界事实", memory.Plan: "作者规划"}
	for _, m := range result.CharacterContext {
		fmt.Fprintf(w, "- [%s] %s\n  来源 %s / %s · v%d · %s\n", kinds[m.Kind], m.Text, m.ChapterID, m.SegmentID, m.Version, m.ID)
	}
	fmt.Fprintf(w, "\n作者规划（%d 条，单独提供，不能混入角色知识）\n", len(result.AuthorPlans))
	for _, m := range result.AuthorPlans {
		fmt.Fprintf(w, "- %s · %s v%d\n", m.Text, m.ID, m.Version)
	}
	fmt.Fprintf(w, "\n未纳入角色材料（%d 条；解释不含被拦截的原文）\n", len(result.Excluded))
	for _, x := range result.Excluded {
		fmt.Fprintf(w, "- %s：%s\n", x.ID, exclusionLabels[x.Reason])
	}
	return nil
}

var exclusionLabels = map[memory.Reason]string{
	memory.OtherProject: "来自其他项目", memory.OtherBranch: "来自其他分支", memory.Unconfirmed: "作者尚未确认",
	memory.NotPinned: "不在本次固定来源清单中", memory.VersionMismatch: "返回版本与本次固定版本不符", memory.DigestMismatch: "内容或可见性元数据已改变",
	memory.InvalidRecord: "缺少有效来源/时间信息或材料类型不受支持", memory.FutureChapter: "在后续章节才出现，当前章不可使用",
	memory.FutureStoryTime: "事情发生在当前故事时间之后", memory.UnknownToPOV: "没有当前角色已获知的可靠记录", memory.KnowledgeLater: "当前角色要到更晚才获知",
}
