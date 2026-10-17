package manuscript

import "inkloom/internal/domain/memory"

// WritingTask 是作者任务，不是角色已知事实。完整规划快照单独存档，不发给 Writer。
type WritingTask struct {
	// ExperimentalContinuity is frozen per run; planned requests opt in explicitly, default off.
	ExperimentalContinuity bool `json:"experimentalContinuity,omitempty"`
	// Soft length guidance derived from the confirmed chapter and its Beat count.
	ChapterTargetWords int                  `json:"chapterTargetWords,omitempty"`
	BeatTargetWords    int                  `json:"beatTargetWords,omitempty"`
	Knowledge          *memory.KnowledgeRef `json:"knowledge,omitempty"`
	Scope              string               `json:"scope"`
	ChapterID          string               `json:"chapterId"`
	Versions           map[string]int       `json:"versions"`
	PlanVersion        int                  `json:"planVersion"`
	SourceDigest       string               `json:"sourceDigest"`
	Opening            bool                 `json:"opening"`
	StoryTime          int64                `json:"storyTime"`
	Genre              string               `json:"genre"`
	Brief              WritingBrief         `json:"brief"`
	Style              WritingStyle         `json:"style"`
	SceneGoal          string               `json:"sceneGoal"`
	SceneConflict      string               `json:"sceneConflict"`
	SceneOutcome       string               `json:"sceneOutcome"`
	Voices             map[string][]string  `json:"voices"`
}

// WritingBrief 是正文侧最小交接契约，避免正文领域反向依赖规划领域。
type WritingBrief struct {
	SelectedBeatID  string `json:"selectedBeatId"`
	MustHappen      string `json:"mustHappen"`
	CannotChange    string `json:"cannotChange"`
	Reveal          string `json:"reveal"`
	Withhold        string `json:"withhold"`
	WritingGuidance string `json:"writingGuidance"`
}

// Typed fields keep the digest stable after PostgreSQL jsonb reorders object keys.
type WritingRange struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
}
type WritingStyle struct {
	POV            string       `json:"pov"`
	Tense          string       `json:"tense"`
	Tone           string       `json:"tone"`
	SentenceLength WritingRange `json:"sentenceLength"`
	DialogueRatio  WritingRange `json:"dialogueRatio"`
	BannedPhrases  []string     `json:"bannedPhrases"`
	StyleArc       string       `json:"styleArc"`
}
