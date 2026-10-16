// Package knowledge 把作者确认的时间线、伏笔和知情记录投影成受限角色材料。
// 不从正文自动猜测事实，不执行模型调用，也不负责保存作者修改。
package knowledge

import "inkloom/internal/domain/memory"

// Location 的章节是来源元数据，不拼进人物回忆或台词。
// At.Chapter 是叙事披露位置；At.StoryTime 是项目内统一的故事时间刻度。
type Location struct {
	Initial   *memory.InitialSetting `json:"initial,omitempty"`
	ChapterID string                 `json:"chapterId"`
	SegmentID string                 `json:"segmentId"`
	At        memory.Moment          `json:"at"`
}

type Fact struct {
	ID      string   `json:"id"`
	Version int      `json:"version"`
	Text    string   `json:"text"`
	Source  Location `json:"source"`
}

type TimelineEvent struct {
	ID           string   `json:"id"`
	Summary      string   `json:"summary"`
	Source       Location `json:"source"`
	FactIDs      []string `json:"factIds"`
	CausalBefore []string `json:"causalBefore"` // 本事件必须先于哪些事件；不能构成环。
}

type KnowledgeState string

const (
	Known  KnowledgeState = "known"
	Belief KnowledgeState = "belief"
)

// InfoState 是一份固定版本中，一个主体对一个事实的知情记录。
// Source 是获知/产生误解的正文依据，和 Fact.Source（事实来源）分开。
// 每对主体/事实只保留一条；历史修正将通过后续版本保存，不在此实现状态事件流。
// reader 单独表示读者，不能被当作任一角色。
type InfoState struct {
	FactID    string         `json:"factId"`
	SubjectID string         `json:"subjectId"`
	State     KnowledgeState `json:"state"`
	Source    Location       `json:"source"`
	Belief    string         `json:"belief,omitempty"` // 人物的理解；不会成为世界事实。
}

type ForeshadowStatus string

const (
	Open      ForeshadowStatus = "open"
	Closed    ForeshadowStatus = "closed"
	Abandoned ForeshadowStatus = "abandoned"
)

type Foreshadow struct {
	ID                 string           `json:"id"`
	Title              string           `json:"title"`
	Planted            Location         `json:"planted"`
	Payload            string           `json:"payload"` // 作者知道的用途/真相，永不投影到角色上下文。
	PlanResolveChapter int              `json:"planResolveChapter"`
	Status             ForeshadowStatus `json:"status"`
	Importance         string           `json:"importance"`         // P0 | P1 | P2
	Resolved           *Location        `json:"resolved,omitempty"` // closed 必须有正文定位，计划到期不自动关闭。
	AbandonReason      string           `json:"abandonReason,omitempty"`
}

type PlanningSource struct {
	Input      int    `json:"input"`
	Direction  int    `json:"direction"`
	Style      int    `json:"style"`
	Core       int    `json:"core"`
	CoreDigest string `json:"coreDigest"`
}

type Snapshot struct {
	Planning    *PlanningSource `json:"planning,omitempty"`
	ProjectID   string          `json:"projectId"`
	BranchID    string          `json:"branchId"`
	Version     int             `json:"version"`
	Confirmed   bool            `json:"confirmed"`
	Characters  []string        `json:"characters"`
	Facts       []Fact          `json:"facts"`
	Timeline    []TimelineEvent `json:"timeline"`
	Information []InfoState     `json:"information"`
	Foreshadows []Foreshadow    `json:"foreshadows"`
}
