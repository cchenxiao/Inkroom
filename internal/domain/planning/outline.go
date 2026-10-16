package planning

import (
	"fmt"
	"inkloom/internal/agents/model"
	"reflect"
	"time"
)

// PlanningVersions 是冻结的直接依赖，不是页面当前章版本。
type PlanningVersions struct {
	Input     int `json:"input"`
	Direction int `json:"direction"`
	Style     int `json:"style"`
	Core      int `json:"core"`
}
type OutlineInput struct {
	Versions     PlanningVersions `json:"versions"`
	Source       InputSnapshot    `json:"source"`
	Direction    Selection        `json:"direction"`
	Style        StyleSelection   `json:"style"`
	Core         CoreSelection    `json:"core"`
	Request      string           `json:"request"`
	ChapterCount int              `json:"chapterCount"`
}

func (in OutlineInput) Confirmed() (CoreSettingsOutput, error) {
	empty := CoreSettingsOutput{Characters: []CharacterDesign{}, WorldFacts: []WorldFactProposal{}, Plans: []FuturePlan{}}
	r := CoreSaveRequest{JobID: in.Core.JobID, CandidateVersion: in.Core.CandidateVersion, Content: in.Core.Content, Decisions: in.Core.Decisions}
	if err := r.Validate(); err != nil {
		return empty, err
	}
	for _, c := range in.Core.Content.Characters {
		if in.Core.Decisions[c.ID] == CoreConfirmed {
			empty.Characters = append(empty.Characters, c)
		}
	}
	for _, f := range in.Core.Content.WorldFacts {
		if in.Core.Decisions[f.ID] == CoreConfirmed {
			empty.WorldFacts = append(empty.WorldFacts, f)
		}
	}
	for _, p := range in.Core.Content.Plans {
		if in.Core.Decisions[p.ID] == CoreConfirmed {
			empty.Plans = append(empty.Plans, p)
		}
	}
	if len(empty.Characters) == 0 {
		return empty, fmt.Errorf("至少确认一位人物后才能规划章纲")
	}
	return empty, empty.Validate()
}
func (in OutlineInput) Validate() error {
	if err := (CoreSettingsInput{Source: in.Source, Selection: in.Direction, Style: in.Style, Request: in.Request}).Validate(); err != nil {
		return err
	}
	if in.ChapterCount < 2 || in.ChapterCount > 12 {
		return fmt.Errorf("本次生成 2–12 章的简要章纲")
	}
	v := in.Versions
	if !reflect.DeepEqual(v, PlanningVersions{in.Source.Version, in.Direction.Version, in.Style.Version, in.Core.Version}) || v.Core < 1 || in.Core.InputVersion != v.Input || in.Core.DirectionVersion != v.Direction || in.Core.StyleVersion != v.Style {
		return fmt.Errorf("核心设定依赖已过期")
	}
	_, err := in.Confirmed()
	return err
}

type OutlineAct struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Purpose string `json:"purpose"`
}
type OutlineChapter struct {
	ID           string   `json:"id"`
	ActID        string   `json:"actId"`
	Title        string   `json:"title"`
	Purpose      string   `json:"purpose"`
	Event        string   `json:"event"`
	Arc          string   `json:"arc"`
	Reveal       string   `json:"reveal"`
	Withhold     string   `json:"withhold"`
	CharacterIDs []string `json:"characterIds"`
	TargetWords  int      `json:"targetWords"`
	StoryTime    *int64   `json:"storyTime"`
}
type OutlineStyleBinding struct {
	ChapterID string `json:"chapterId"`
	Guidance  string `json:"guidance"`
}
type OutlinePlanBinding struct {
	PlanID     string   `json:"planId"`
	ChapterIDs []string `json:"chapterIds"`
	Purpose    string   `json:"purpose"`
}

// 配套章节安排保持单向依赖，不回写 StyleProfile 或 CoreSelection。
type OutlineBindings struct {
	Style []OutlineStyleBinding `json:"style"`
	Plans []OutlinePlanBinding  `json:"plans"`
}
type OutlineContent struct {
	Acts     []OutlineAct     `json:"acts"`
	Chapters []OutlineChapter `json:"chapters"`
	Bindings OutlineBindings  `json:"bindings"`
}

func (out OutlineContent) Validate(in OutlineInput) error {
	confirmed, err := in.Confirmed()
	if err != nil {
		return err
	}
	if len(out.Acts) < 1 || len(out.Acts) > 5 || len(out.Chapters) < 2 || len(out.Chapters) > 12 || out.Bindings.Style == nil || out.Bindings.Plans == nil || len(out.Bindings.Style) > 12 || len(out.Bindings.Plans) > 4 {
		return fmt.Errorf("章纲需 1–5 幕、2–12 章与明确的绑定数组")
	}
	ids := map[string]bool{}
	acts := map[string]bool{}
	chapters := map[string]bool{}
	chars := map[string]bool{}
	plans := map[string]bool{}
	add := func(id string) bool {
		if !bounded(id, 80, true) || ids[id] {
			return false
		}
		ids[id] = true
		return true
	}
	for _, c := range confirmed.Characters {
		chars[c.ID] = true
	}
	for _, p := range confirmed.Plans {
		plans[p.ID] = true
	}
	for _, a := range out.Acts {
		if !add(a.ID) || !bounded(a.Title, 150, true) || !bounded(a.Purpose, 600, true) {
			return fmt.Errorf("幕标识或内容无效")
		}
		acts[a.ID] = true
	}
	usedActs := map[string]bool{}
	for _, c := range out.Chapters {
		if !add(c.ID) || !acts[c.ActID] || !bounded(c.Title, 150, true) || c.TargetWords < 100 || c.TargetWords > 20000 || c.CharacterIDs == nil || len(c.CharacterIDs) < 1 || len(c.CharacterIDs) > 3 || c.StoryTime != nil && *c.StoryTime < 0 {
			return fmt.Errorf("章节标识、幕引用、字数或故事时间无效")
		}
		for _, s := range []string{c.Purpose, c.Event, c.Arc} {
			if !bounded(s, 600, true) {
				return fmt.Errorf("章节目的、事件或弧光缺失或过长")
			}
		}
		if !bounded(c.Reveal, 600, false) || !bounded(c.Withhold, 600, false) {
			return fmt.Errorf("披露安排过长")
		}
		seen := map[string]bool{}
		for _, id := range c.CharacterIDs {
			if !chars[id] || seen[id] {
				return fmt.Errorf("章节引用了未确认或重复的人物")
			}
			seen[id] = true
		}
		chapters[c.ID] = true
		usedActs[c.ActID] = true
	}
	if len(usedActs) != len(acts) {
		return fmt.Errorf("每幕至少保留一个章节")
	}
	seenStyle := map[string]bool{}
	for _, b := range out.Bindings.Style {
		if !chapters[b.ChapterID] || seenStyle[b.ChapterID] || !bounded(b.Guidance, 600, true) {
			return fmt.Errorf("风格章节绑定无效或重复")
		}
		seenStyle[b.ChapterID] = true
	}
	seenPlan := map[string]bool{}
	for _, b := range out.Bindings.Plans {
		if !plans[b.PlanID] || seenPlan[b.PlanID] || len(b.ChapterIDs) < 1 || len(b.ChapterIDs) > 12 || !bounded(b.Purpose, 600, true) {
			return fmt.Errorf("计划绑定必须引用已确认计划与有效章节")
		}
		seenPlan[b.PlanID] = true
		seen := map[string]bool{}
		for _, id := range b.ChapterIDs {
			if !chapters[id] || seen[id] {
				return fmt.Errorf("计划章节引用悬空或重复")
			}
			seen[id] = true
		}
	}
	return nil
}

type OutlineStartRequest struct {
	RequestID    string           `json:"requestId"`
	Expected     PlanningVersions `json:"expected"`
	Request      string           `json:"request"`
	ChapterCount int              `json:"chapterCount"`
}
type OutlineJob struct {
	ID            string              `json:"id"`
	Version       int                 `json:"version"`
	Status        string              `json:"status"`
	Request       OutlineStartRequest `json:"request"`
	Input         OutlineInput        `json:"input"`
	Output        *OutlineContent     `json:"output"`
	Model         string              `json:"model"`
	PromptVersion string              `json:"promptVersion"`
	SchemaVersion string              `json:"schemaVersion"`
	Calls         []model.CallRecord  `json:"calls"`
	Message       string              `json:"message"`
	CreatedAt     time.Time           `json:"createdAt"`
}
type OutlineSaveRequest struct {
	Expected               PlanningVersions `json:"expected"`
	ExpectedOutlineVersion int              `json:"expectedOutlineVersion"`
	SourceOutlineVersion   int              `json:"sourceOutlineVersion"`
	JobID                  string           `json:"jobId"`
	CandidateVersion       int              `json:"candidateVersion"`
	Content                OutlineContent   `json:"content"`
	Confirmed              bool             `json:"confirmed"`
}
type OutlineSelection struct {
	Version              int              `json:"version"`
	BindingsVersion      int              `json:"bindingsVersion"`
	Versions             PlanningVersions `json:"versions"`
	SourceOutlineVersion int              `json:"sourceOutlineVersion"`
	JobID                string           `json:"jobId"`
	CandidateVersion     int              `json:"candidateVersion"`
	Content              OutlineContent   `json:"content"`
	Confirmed            bool             `json:"confirmed"`
	CreatedAt            time.Time        `json:"createdAt"`
}
