package planning

import (
	"fmt"
	"inkloom/internal/agents/model"
	"time"
)

// ChapterPlanVersions 固定上游链；细纲另按稳定 chapterId 独立递增版本。
type ChapterPlanVersions struct {
	Planning PlanningVersions `json:"planning"`
	Outline  int              `json:"outline"`
	Bindings int              `json:"bindings"`
}
type ChapterHandoff struct {
	PublicationID string               `json:"publicationId"`
	ChapterID     string               `json:"chapterId"`
	Version       int                  `json:"version"`
	Ending        string               `json:"ending"`
	Facts         []ChapterHandoffFact `json:"facts"`
}
type ChapterHandoffFact struct {
	ID        string   `json:"id"`
	Text      string   `json:"text"`
	StoryTime int64    `json:"storyTime"`
	KnownBy   []string `json:"knownBy"`
}
type ChapterPlanInput struct {
	PreviousChapter *ChapterHandoff  `json:"previousChapter,omitempty"`
	Base            OutlineInput     `json:"base"`
	Outline         OutlineSelection `json:"outline"`
	ChapterID       string           `json:"chapterId"`
	Request         string           `json:"request"`
}

func (in ChapterPlanInput) Versions() ChapterPlanVersions {
	return ChapterPlanVersions{in.Base.Versions, in.Outline.Version, in.Outline.BindingsVersion}
}
func (in ChapterPlanInput) Chapter() (OutlineChapter, bool) {
	for _, c := range in.Outline.Content.Chapters {
		if c.ID == in.ChapterID {
			return c, true
		}
	}
	return OutlineChapter{}, false
}
func (in ChapterPlanInput) Validate() error {
	if err := in.Base.Validate(); err != nil {
		return err
	}
	if !in.Outline.Confirmed || in.Outline.Version < 1 || in.Outline.BindingsVersion < 1 || in.Outline.Versions != in.Base.Versions {
		return fmt.Errorf("需要依赖有效的已确认章纲")
	}
	if err := in.Outline.Content.Validate(in.Base); err != nil {
		return err
	}
	if _, ok := in.Chapter(); !ok {
		return fmt.Errorf("章纲中不存在本章")
	}
	if !bounded(in.Request, 2400, true) {
		return fmt.Errorf("请限定本章展开要求")
	}
	return nil
}

type PlannedBeat struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Action string `json:"action"`
	Turn   string `json:"turn"` // 本节拍带来的局势或认知变化，仍属作者计划。
}
type PlannedScene struct {
	ID             string        `json:"id"`
	Title          string        `json:"title"`
	Goal           string        `json:"goal"`
	Conflict       string        `json:"conflict"`
	Outcome        string        `json:"outcome"`
	POVCharacterID string        `json:"povCharacterId"`
	CharacterIDs   []string      `json:"characterIds"`
	StoryTime      *int64        `json:"storyTime"`
	Beats          []PlannedBeat `json:"beats"`
}
type ChapterBrief struct {
	SelectedBeatID  string `json:"selectedBeatId"`
	MustHappen      string `json:"mustHappen"`
	CannotChange    string `json:"cannotChange"`
	Reveal          string `json:"reveal"`
	Withhold        string `json:"withhold"`
	WritingGuidance string `json:"writingGuidance"`
}
type ChapterPlanContent struct {
	TargetWords int            `json:"targetWords,omitempty"` // Author override for this chapter, without changing the book outline.
	Scenes      []PlannedScene `json:"scenes"`
	Brief       ChapterBrief   `json:"brief"`
}

func (out ChapterPlanContent) Validate(in ChapterPlanInput) error {
	if out.TargetWords != 0 && (out.TargetWords < 200 || out.TargetWords > 12000) {
		return fmt.Errorf("本章目标篇幅应为 200–12000 字")
	}
	if err := in.Validate(); err != nil {
		return err
	}
	ch, _ := in.Chapter()
	allowed := map[string]bool{}
	for _, id := range ch.CharacterIDs {
		allowed[id] = true
	}
	if len(out.Scenes) < 1 || len(out.Scenes) > 4 {
		return fmt.Errorf("仅展开 1–4 场")
	}
	ids := map[string]bool{}
	beats := map[string]bool{}
	count := 0
	add := func(id string) bool {
		if !bounded(id, 80, true) || ids[id] {
			return false
		}
		ids[id] = true
		return true
	}
	for _, s := range out.Scenes {
		if !add(s.ID) || !bounded(s.Title, 150, true) || !bounded(s.Goal, 600, true) || !bounded(s.Conflict, 600, true) || !bounded(s.Outcome, 600, true) {
			return fmt.Errorf("场景 ID 或内容无效")
		}
		if !allowed[s.POVCharacterID] || len(s.CharacterIDs) < 1 || len(s.CharacterIDs) > 3 || s.StoryTime != nil && *s.StoryTime < 0 {
			return fmt.Errorf("场景人物、POV 或时间无效")
		}
		seen := map[string]bool{}
		for _, id := range s.CharacterIDs {
			if !allowed[id] || seen[id] {
				return fmt.Errorf("场景引用了非本章人物或重复人物")
			}
			seen[id] = true
		}
		if !seen[s.POVCharacterID] {
			return fmt.Errorf("POV 必须在本场人物中")
		}
		if len(s.Beats) < 1 || len(s.Beats) > 4 {
			return fmt.Errorf("每场需要 1–4 个 Beat")
		}
		for _, b := range s.Beats {
			if !add(b.ID) || !bounded(b.Title, 150, true) || !bounded(b.Action, 600, true) || !bounded(b.Turn, 600, true) {
				return fmt.Errorf("Beat ID 或内容无效")
			}
			beats[b.ID] = true
			count++
		}
	}
	if count > 8 || !beats[out.Brief.SelectedBeatID] {
		return fmt.Errorf("全章最多 8 个 Beat；选定 Beat 必须存在")
	}
	for _, s := range []string{out.Brief.MustHappen, out.Brief.CannotChange, out.Brief.WritingGuidance} {
		if !bounded(s, 900, true) {
			return fmt.Errorf("Brief 的必发事件、不变约束及写作要求不能为空或超过 900 字节")
		}
	}
	for _, s := range []string{out.Brief.Reveal, out.Brief.Withhold} {
		if !bounded(s, 900, false) {
			return fmt.Errorf("Brief 信息披露过长")
		}
	}
	return nil
}

// PlanningKnowledge 仅供作者核对规划知情时点，不是 memory.Select 的正式检索结果。
type PlanningKnowledge struct {
	SceneID         string   `json:"sceneId"`
	KnownFactIDs    []string `json:"knownFactIds"`
	ExcludedFactIDs []string `json:"excludedFactIds"`
}

func (out ChapterPlanContent) Knowledge(in ChapterPlanInput) []PlanningKnowledge {
	core, _ := in.Base.Confirmed()
	rows := []PlanningKnowledge{}
	for _, s := range out.Scenes {
		row := PlanningKnowledge{SceneID: s.ID, KnownFactIDs: []string{}, ExcludedFactIDs: []string{}}
		for _, f := range core.WorldFacts {
			known := false
			if s.StoryTime != nil && f.StoryTime != nil && *f.StoryTime <= *s.StoryTime {
				for _, k := range f.KnownBy {
					if k.CharacterID == s.POVCharacterID && k.LearnedAt != nil && *k.LearnedAt <= *s.StoryTime {
						known = true
					}
				}
			}
			if known {
				row.KnownFactIDs = append(row.KnownFactIDs, f.ID)
			} else {
				row.ExcludedFactIDs = append(row.ExcludedFactIDs, f.ID)
			}
		}
		rows = append(rows, row)
	}
	return rows
}

type ChapterPlanStartRequest struct {
	RequestID string              `json:"requestId"`
	Expected  ChapterPlanVersions `json:"expected"`
	ChapterID string              `json:"chapterId"`
	Request   string              `json:"request"`
}
type ChapterPlanJob struct {
	ID            string                  `json:"id"`
	Version       int                     `json:"version"`
	Status        string                  `json:"status"`
	Request       ChapterPlanStartRequest `json:"request"`
	Input         ChapterPlanInput        `json:"input"`
	Output        *ChapterPlanContent     `json:"output"`
	Model         string                  `json:"model"`
	PromptVersion string                  `json:"promptVersion"`
	SchemaVersion string                  `json:"schemaVersion"`
	Calls         []model.CallRecord      `json:"calls"`
	Message       string                  `json:"message"`
	CreatedAt     time.Time               `json:"createdAt"`
}
type ChapterPlanSaveRequest struct {
	Expected         ChapterPlanVersions `json:"expected"`
	ChapterID        string              `json:"chapterId"`
	ExpectedVersion  int                 `json:"expectedVersion"`
	SourceVersion    int                 `json:"sourceVersion"`
	JobID            string              `json:"jobId"`
	CandidateVersion int                 `json:"candidateVersion"`
	Content          ChapterPlanContent  `json:"content"`
	Confirmed        bool                `json:"confirmed"`
}
type ChapterPlanSelection struct {
	Version          int                 `json:"version"`
	Versions         ChapterPlanVersions `json:"versions"`
	ChapterID        string              `json:"chapterId"`
	SourceVersion    int                 `json:"sourceVersion"`
	JobID            string              `json:"jobId"`
	CandidateVersion int                 `json:"candidateVersion"`
	Input            ChapterPlanInput    `json:"input"`
	Content          ChapterPlanContent  `json:"content"`
	Knowledge        []PlanningKnowledge `json:"knowledge"`
	Confirmed        bool                `json:"confirmed"`
	CreatedAt        time.Time           `json:"createdAt"`
}
