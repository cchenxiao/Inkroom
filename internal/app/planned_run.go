package app

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"inkloom/internal/agents/model"
	"inkloom/internal/config"
	"inkloom/internal/contextassembly"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/planning"
	"strings"
)

// PlannedRunRequest 只传预期版本和操作权限；上游材料由仓储读取。
type PlannedRunRequest struct {
	EnhancedContinuity bool                         `json:"enhancedContinuity,omitempty"`
	Recheck            bool                         `json:"recheck,omitempty"`
	Mode               string                       `json:"mode,omitempty"`
	FromRunID          string                       `json:"fromRunId,omitempty"`
	SourceVersion      int                          `json:"sourceVersion,omitempty"`
	Rewrite            *manuscript.AuthorRewrite    `json:"rewrite,omitempty"`
	BeatID             string                       `json:"beatId,omitempty"`
	RequestID          string                       `json:"requestId"`
	ChapterID          string                       `json:"chapterId"`
	Expected           planning.ChapterPlanVersions `json:"expected"`
	PlanVersion        int                          `json:"planVersion"`
	DraftVersion       int                          `json:"draftVersion"`
	AutoRevise         bool                         `json:"autoRevise"`
}
type PlannedRunBinding struct {
	Scope     string                        `json:"scope"`
	Request   PlannedRunRequest             `json:"request"`
	Selection planning.ChapterPlanSelection `json:"selection"`
}

// 单段与整章候选使用独立稿本；整章用 ChapterBeatID，采用后按 BeatID 组稿。
func PlannedDraftID(scope, chapter, beat string) string {
	hash := sha256.Sum256([]byte(scope + "\x00" + chapter + "\x00" + beat))
	return fmt.Sprintf("planned-%x", hash[:16])
}
func PreparePlannedContext(cfg config.Config, scope, runID string, base int, p planning.ChapterPlanSelection, target ...string) (manuscript.FrozenInput, error) {
	var empty manuscript.FrozenInput
	project, branch, validScope := strings.Cut(scope, "/")
	if !validScope || project == "" || branch != "main" || !p.Confirmed || p.Version < 1 || p.ChapterID != p.Input.ChapterID || p.Versions != p.Input.Versions() || p.Content.Validate(p.Input) != nil {
		return empty, ErrVersionMismatch
	}
	if p.Input.Outline.Content.Chapters[0].ID != p.ChapterID {
		return empty, fmt.Errorf("后续章尚未接入前章定稿来源；当前只支持第一章选定 Beat")
	}
	selectedBeat := p.Content.Brief.SelectedBeatID
	if len(target) > 0 && target[0] != "" {
		selectedBeat = target[0]
	}
	var scene planning.PlannedScene
	var beat planning.PlannedBeat
	for _, s := range p.Content.Scenes {
		for _, b := range s.Beats {
			if b.ID == selectedBeat {
				scene = s
				beat = b
			}
		}
	}
	if beat.ID == "" || scene.StoryTime == nil {
		return empty, fmt.Errorf("请先确认选定 Beat 所属场景的故事时间（分钟）")
	}
	core, err := p.Input.Base.Confirmed()
	if err != nil {
		return empty, err
	}
	known := map[string]bool{}
	for _, k := range p.Content.Knowledge(p.Input) {
		if k.SceneID == scene.ID {
			for _, id := range k.KnownFactIDs {
				known[id] = true
			}
		}
	}
	b := manuscript.ContextBundle{ProjectID: project, BranchID: "main", ChapterID: PlannedDraftID(scope, p.ChapterID, beat.ID), POVCharacterID: scene.POVCharacterID,
		Beat:       manuscript.Beat{ID: beat.ID, SceneID: scene.ID, Version: p.Version, Locked: true, Title: beat.Title, Description: beat.Action + "；变化：" + beat.Turn},
		Characters: []manuscript.CharacterFacts{}, Facts: []manuscript.SourceRef{}, Sources: []manuscript.SourceRef{}, BannedPhrases: p.Input.Base.Style.Rules.BannedPhrases, ProtectedTerms: []string{},
	}
	for _, c := range core.Characters {
		present := false
		for _, id := range scene.CharacterIDs {
			if id == c.ID {
				present = true
			}
		}
		if !present {
			continue
		}
		b.Characters = append(b.Characters, manuscript.CharacterFacts{ID: c.ID, Name: c.Name, Version: p.Versions.Planning.Core, HardTraits: []manuscript.SourceRef{}, Knows: []manuscript.SourceRef{}})
		b.ProtectedTerms = append(b.ProtectedTerms, c.Name)
		if c.ID == scene.POVCharacterID {
			b.POV = p.Input.Base.Style.Rules.POV + "；视角人物：" + c.Name
		}
	}
	for _, f := range core.WorldFacts {
		if known[f.ID] {
			b.Facts = append(b.Facts, manuscript.SourceRef{ID: "initial-setting/" + f.ID, Version: p.Versions.Planning.Core, Text: f.Text})
		}
	}
	if len(b.Facts) == 0 {
		return empty, fmt.Errorf("当前 POV/故事时间没有可用的已确认事实，请核对设定的 knownBy 与获知时间")
	}
	sourceDigest, err := manuscript.ContentDigest(p)
	if err != nil {
		return empty, err
	}
	voices := map[string][]string{}
	for _, c := range core.Characters {
		for _, id := range scene.CharacterIDs {
			if id == c.ID {
				voices[id] = c.Voice
			}
		}
	}
	rules := p.Input.Base.Style.Rules
	style := manuscript.WritingStyle{POV: rules.POV, Tense: rules.Tense, Tone: rules.Tone, SentenceLength: manuscript.WritingRange(rules.SentenceLength), DialogueRatio: manuscript.WritingRange(rules.DialogueRatio), BannedPhrases: rules.BannedPhrases, StyleArc: rules.StyleArc}
	b.WritingTask = &manuscript.WritingTask{ExperimentalContinuity: cfg.ExperimentalContinuity, Scope: scope, ChapterID: p.ChapterID, Versions: map[string]int{"input": p.Versions.Planning.Input, "direction": p.Versions.Planning.Direction, "style": p.Versions.Planning.Style, "core": p.Versions.Planning.Core, "outline": p.Versions.Outline, "bindings": p.Versions.Bindings}, PlanVersion: p.Version, SourceDigest: sourceDigest, Opening: true, StoryTime: *scene.StoryTime, Brief: manuscript.WritingBrief(p.Content.Brief), Style: style, SceneGoal: scene.Goal, SceneConflict: scene.Conflict, SceneOutcome: scene.Outcome, Voices: voices}
	if chapter, ok := p.Input.Chapter(); ok {
		b.WritingTask.ChapterTargetWords = chapter.TargetWords
		beatCount := 0
		for _, plannedScene := range p.Content.Scenes {
			beatCount += len(plannedScene.Beats)
		}
		if beatCount > 0 {
			b.WritingTask.BeatTargetWords = (chapter.TargetWords + beatCount - 1) / beatCount
		}
	}
	b.WritingTask.Brief.SelectedBeatID = beat.ID
	// Intake 的类型作为创作任务传入；不包含参考原文或未来章纲。
	b.WritingTask.Genre = p.Input.Base.Source.Intake.Genres
	budget, output := cfg.ContextTokens, cfg.MaxOutputTokens
	if budget == 0 {
		budget = 32768
	}
	if output == 0 {
		output = 8192
	}
	return contextassembly.Assemble(b, contextassembly.PreviousChapter{}, contextassembly.Options{RunID: runID, BaseDraftVersion: base, Budget: budget, ReservedOutputTokens: output, Excluded: []manuscript.ExcludedSource{
		{Title: "前章定稿", Reason: "第一章无前章；未引用演示 ch7 的前情"},
		{Title: "跨章检索", Reason: "本轮只核对固定的初始设定，尚未接入全书检索"},
		{Title: "非当前角色知识", Reason: "未确认项、未知/未来获知时点、其他 POV 事实与未来章规划未送入模型"},
	}})
}

// Fake 仅是管线样例，文字不假称模型已创作；避免沿用演示小说正文与证据引用。
func plannedFakeSteps(b manuscript.ContextBundle) []model.Step {
	content := mustJSON(map[string]string{"text": "流程样例：" + b.Beat.Description})
	if len(b.Targets) > 0 {
		parts := []map[string]string{}
		for _, t := range b.Targets {
			parts = append(parts, map[string]string{"beatId": t.Beat.ID, "text": "流程样例：" + t.Beat.Description})
		}
		content = mustJSON(map[string]any{"parts": parts})
	}
	return []model.Step{
		{Role: "planned_writer", Content: content},
		{Role: "hard_consistency", Content: `{"findings":[]}`}, {Role: "ai_taste", Content: `{"findings":[]}`},
	}
}
func mustJSON(v any) string { raw, _ := json.Marshal(v); return string(raw) }
func ValidPlannedRequest(r PlannedRunRequest) bool {
	return (r.Mode == "" || r.Mode == "beat" || r.Mode == "chapter") && (!(r.Rewrite != nil || r.Recheck) || (r.FromRunID != "" && r.SourceVersion > 0 && (r.Mode != "chapter" || r.Recheck) && !r.AutoRevise)) && !(r.Rewrite != nil && r.Recheck) && (r.FromRunID == "" || r.Rewrite != nil || r.Recheck) && len(r.FromRunID) <= 100 && len(r.BeatID) <= 80 && len(r.RequestID) > 0 && len(r.RequestID) <= 80 && strings.TrimSpace(r.ChapterID) != "" && len(r.ChapterID) <= 80 && r.PlanVersion > 0 && r.DraftVersion >= 0
}

type PlannedRunSource struct {
	EnhancedContinuity bool                         `json:"enhancedContinuity,omitempty"`
	NeighborPolicy     string                       `json:"neighborPolicy,omitempty"`
	Baseline           []manuscript.Passage         `json:"baseline,omitempty"`
	FromRunID          string                       `json:"fromRunId,omitempty"`
	SourceVersion      int                          `json:"sourceVersion,omitempty"`
	Mode               string                       `json:"mode,omitempty"`
	Neighbors          []manuscript.Passage         `json:"neighbors,omitempty"`
	Knowledge          *memory.KnowledgeRef         `json:"knowledge,omitempty"`
	Scope              string                       `json:"scope"`
	ChapterID          string                       `json:"chapterId"`
	BeatID             string                       `json:"beatId"`
	Expected           planning.ChapterPlanVersions `json:"expected"`
	PlanVersion        int                          `json:"planVersion"`
}
type AdoptedPassageStatus struct {
	Version        int  `json:"version"`
	MatchesWorking bool `json:"matchesWorking"`
}

type PlannedRunReadiness struct {
	Adopted      *AdoptedPassageStatus        `json:"adopted,omitempty"`
	Working      *manuscript.Passage          `json:"working,omitempty"`
	BeatID       string                       `json:"beatId"`
	Ready        bool                         `json:"ready"`
	Reason       string                       `json:"reason"`
	DraftID      string                       `json:"draftId"`
	DraftVersion int                          `json:"draftVersion"`
	PlanVersion  int                          `json:"planVersion"`
	Expected     planning.ChapterPlanVersions `json:"expected"`
	Runs         []Run                        `json:"runs"`
}

var ErrPlanningNotReady = errors.New("规划材料尚未就绪")

func ReassemblePlanned(in manuscript.FrozenInput) (manuscript.FrozenInput, error) {
	m := in.Manifest
	return contextassembly.Assemble(in.Bundle, contextassembly.PreviousChapter{}, contextassembly.Options{RunID: m.RunID, BaseDraftVersion: m.BaseDraftVersion, Budget: m.Budget, ReservedOutputTokens: m.ReservedOutputTokens, Excluded: m.Excluded})
}
