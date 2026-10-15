// Package memory 定义跨章材料的可见范围，不依赖模型、数据库或检索算法。
package memory

// Moment 用两根独立的时间轴定位：章节阅读顺序与故事实际时间。
// StoryTime 是项目内统一的时间刻度（教学数据用分钟）；不能拿章节号代替。
type Moment struct {
	Chapter   int   `json:"chapter"`
	StoryTime int64 `json:"storyTime"`
}

type Kind string

const (
	Fact    Kind = "fact"    // 已确认的世界事实。
	Passage Kind = "passage" // 正文/台词片段；被确认的是原文，话中陈述未必是真相。
	Plan    Kind = "plan"    // 作者规划；永远不属于角色当前知识。
)

type Status string

const (
	Confirmed Status = "confirmed"
	Candidate Status = "candidate"
)

type Knowledge struct {
	CharacterID string  `json:"characterId"`
	Since       *Moment `json:"since"` // nil = 获知时点未确认，不能推断为已知。
}

// Record 必须是可独立授权的小片段。段落混有不同知情范围时应先拆分，
// 不能因为角色知道其中一句，就让整段秘密通过。
// 这些元数据由可信资料维护流程提供；本规则不从自然语言自动推断真假/知情。
type Record struct {
	ID        string      `json:"id"`
	ProjectID string      `json:"projectId"`
	BranchID  string      `json:"branchId"`
	Version   int         `json:"version"`
	Kind      Kind        `json:"kind"`
	Status    Status      `json:"status"`
	ChapterID string      `json:"chapterId"`
	SegmentID string      `json:"segmentId,omitempty"`
	At        *Moment     `json:"at"`
	Text      string      `json:"text"`
	KnownBy   []Knowledge `json:"knownBy"`
}

// Pin 固定整条记录的版本与摘要，包括可见性元数据，不能只固定正文。
type Pin struct {
	Version int    `json:"version"`
	Digest  string `json:"digest"`
}

// View 由后端根据当前创作任务构造。未来工具参数不能自行扩大此范围。
type View struct {
	ProjectID string         `json:"projectId"`
	BranchID  string         `json:"branchId"`
	POV       string         `json:"pov"` // 人物 ID，不用显示名匹配。
	At        Moment         `json:"at"`
	Pins      map[string]Pin `json:"-"`
}

// Material 为筛选后可交给装配器的值快照；保留 Kind，台词不能升级成事实。
type Material struct {
	ID        string `json:"id"`
	Version   int    `json:"version"`
	Digest    string `json:"digest"`
	Kind      Kind   `json:"kind"`
	ChapterID string `json:"chapterId"`
	SegmentID string `json:"segmentId,omitempty"`
	Text      string `json:"text"`
}

type Reason string

const (
	OtherProject    Reason = "other_project"
	OtherBranch     Reason = "other_branch"
	Unconfirmed     Reason = "unconfirmed"
	NotPinned       Reason = "not_pinned"
	VersionMismatch Reason = "version_mismatch"
	DigestMismatch  Reason = "digest_mismatch"
	InvalidRecord   Reason = "invalid_record"
	FutureChapter   Reason = "future_chapter"
	FutureStoryTime Reason = "future_story_time"
	UnknownToPOV    Reason = "unknown_to_pov"
	KnowledgeLater  Reason = "knowledge_later"
)

type Exclusion struct {
	ID     string `json:"id"`
	Reason Reason `json:"reason"` // 不返回被排除的原文，避免把秘密塞进解释里。
}

type Selection struct {
	CharacterContext []Material  `json:"characterContext"`
	AuthorPlans      []Material  `json:"authorPlans"` // 单独区域，不可拼进角色知识。
	Excluded         []Exclusion `json:"excluded"`
}
