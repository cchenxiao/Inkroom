// Package manuscript 定义正文结构，不依赖 Eino、数据库或 HTTP。
package manuscript

type Beat struct {
	ID          string `json:"id"`
	SceneID     string `json:"sceneId"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// Segment 是当前增量需要的最小正文模型；I3 对接 HTTP 时补齐 DTO。
type Segment struct {
	ID        string `json:"id"`
	ChapterID string `json:"chapterId"`
	SceneID   string `json:"sceneId"`
	BeatID    string `json:"beatId"`
	Order     int    `json:"order"`
	Text      string `json:"text"`
	POV       string `json:"pov"`
	Version   int    `json:"version"`
}

// SourceRef 固定基础设定的来源版本，与每轮变化的正文版本分开。
type SourceRef struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
	Text    string `json:"text"`
}

// ContextBundle 是给 Writer 的材料包，不是数据库查询器。
type ContextBundle struct {
	BannedPhrases  []string    `json:"bannedPhrases"`
	ProtectedTerms []string    `json:"protectedTerms"`
	ChapterID      string      `json:"chapterId"`
	BranchID       string      `json:"branchId"`
	Beat           Beat        `json:"beat"`
	POV            string      `json:"pov"`
	Sources        []SourceRef `json:"sources"`
}
