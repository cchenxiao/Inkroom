package demo

import (
	"inkloom/internal/contextassembly"
	"inkloom/internal/domain/manuscript"
)

// PreviousChapter 是明确标注的已确认教学种子，来自同一《浊流》第六章示例结尾。
// 生产跨章装配将改为读取指定 commit；不能从仍在编辑的最新 draft 取前情。
func PreviousChapter() contextassembly.PreviousChapter {
	return contextassembly.PreviousChapter{ProjectID: "zhuoliu", BranchID: "main", Confirmed: true, Source: manuscript.SourceRef{ID: "seed-ch6-ending", Version: 1, Text: "陆青把船拴在岸边。‘等水退一点。’她说。沈砚停住，没有再往前。空铃的线索仍藏在他们未说完的话里。"}}
}
func ExcludedContext() []manuscript.ExcludedSource {
	return []manuscript.ExcludedSource{
		{Title: "未确认事实与其他候选稿", Reason: "当前不作可靠设定输入；定稿还需作者核对新事实"},
		{Title: "其他分支、未来章节计划及全书检索", Reason: "I9 仅装配固定项目/分支的必需材料；检索与可见性工具在后续接入"},
	}
}
