package knowledge

import (
	"fmt"
	"slices"

	"inkloom/internal/domain/memory"
)

// Project 只接收可信仓储提供的已确认快照；不能传入搜索结果并自封为已确认。
// Project 用于离线预览；持久化发布通过 Records 生成目录，并固定整个 Snapshot 的版本/摘要。
// 返回值不含作者台账、读者所知或误解文本，不能把作者预览整包交给 Writer。
func Project(s Snapshot, v memory.View) (memory.Selection, error) {
	if err := s.Validate(); err != nil {
		return memory.Selection{}, err
	}
	if v.ProjectID != s.ProjectID || v.BranchID != s.BranchID || !slices.Contains(s.Characters, v.POV) {
		return memory.Selection{}, fmt.Errorf("knowledge view must match snapshot scope and a character POV")
	}
	records, err := Records(s)
	if err != nil {
		return memory.Selection{}, err
	}
	v.Pins = map[string]memory.Pin{}
	for _, r := range records {
		v.Pins[r.ID] = memory.Pin{Version: r.Version, Digest: memory.Digest(r)}
	}

	return memory.Select(v, records)
}

// Records 仅投影事实及已确认的获知时点；不携带读者所知、误解、事件摘要或伏笔用途。
// 调用方仍须经过 memory.Select，不能把返回的全量记录直接交给模型。
func Records(s Snapshot) ([]memory.Record, error) {
	if err := s.Validate(); err != nil {
		return nil, err
	}
	records := make([]memory.Record, 0, len(s.Facts))
	for _, f := range s.Facts {
		at := f.Source.At
		r := memory.Record{Initial: f.Source.Initial, ID: f.ID, ProjectID: s.ProjectID, BranchID: s.BranchID, Version: f.Version, Kind: memory.Fact, Status: memory.Confirmed, ChapterID: f.Source.ChapterID, SegmentID: f.Source.SegmentID, At: &at, Text: f.Text, KnownBy: []memory.Knowledge{}}
		for _, i := range s.Information {
			if i.FactID == f.ID && i.State == Known && i.SubjectID != "reader" {
				since := i.Source.At
				r.KnownBy = append(r.KnownBy, memory.Knowledge{CharacterID: i.SubjectID, Since: &since})
			}
		}
		records = append(records, r)
	}
	return records, nil
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
