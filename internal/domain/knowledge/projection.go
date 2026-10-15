package knowledge

import (
	"fmt"
	"slices"

	"inkloom/internal/domain/memory"
)

// Project 只接收可信仓储提供的已确认快照；不能传入搜索结果并自封为已确认。
// I12a 的调用方仅为离线教学入口，未来接入仓储时须固定整个 Snapshot 的版本/摘要。
// 返回值不含作者台账、读者所知或误解文本，不能把作者预览整包交给 Writer。
func Project(s Snapshot, v memory.View) (memory.Selection, error) {
	if err := s.Validate(); err != nil {
		return memory.Selection{}, err
	}
	if v.ProjectID != s.ProjectID || v.BranchID != s.BranchID || !slices.Contains(s.Characters, v.POV) {
		return memory.Selection{}, fmt.Errorf("knowledge view must match snapshot scope and a character POV")
	}
	records := make([]memory.Record, 0, len(s.Facts))
	// 从可信快照生成一份新的固定目录；不接受调用方夹带另一批来源的 Pins。
	v.Pins = map[string]memory.Pin{}
	for _, f := range s.Facts {
		at := f.Source.At
		r := memory.Record{ID: f.ID, ProjectID: s.ProjectID, BranchID: s.BranchID, Version: f.Version, Kind: memory.Fact, Status: memory.Confirmed, ChapterID: f.Source.ChapterID, SegmentID: f.Source.SegmentID, At: &at, Text: f.Text, KnownBy: []memory.Knowledge{}}
		for _, i := range s.Information {
			if i.FactID == f.ID && i.State == Known && i.SubjectID != "reader" {
				since := i.Source.At
				r.KnownBy = append(r.KnownBy, memory.Knowledge{CharacterID: i.SubjectID, Since: &since})
			}
		}
		records = append(records, r)
		v.Pins[r.ID] = memory.Pin{Version: r.Version, Digest: memory.Digest(r)}
	}
	return memory.Select(v, records)
}

// InformationAt 仅用于作者的信息差矩阵。未知不代表事实为假。
// Source 章节/故事时间都到达才显示 known/belief；读取整份快照不能绕过时点。
func (s Snapshot) InformationAt(factID, subjectID string, at memory.Moment) string {
	for _, f := range s.Facts {
		if f.ID != factID {
			continue
		}
		if f.Source.At.Chapter > at.Chapter || f.Source.At.StoryTime > at.StoryTime {
			return "not_known"
		}
		for _, i := range s.Information {
			if i.FactID == factID && i.SubjectID == subjectID && i.Source.At.Chapter <= at.Chapter && i.Source.At.StoryTime <= at.StoryTime {
				return string(i.State)
			}
		}
	}
	return "not_known"
}

// Overdue 按叙事章节判断，跨过计划章才算逾期；不自动变更状态。
func (f Foreshadow) Overdue(chapter int) bool {
	return f.Status == Open && chapter > f.PlanResolveChapter
}
