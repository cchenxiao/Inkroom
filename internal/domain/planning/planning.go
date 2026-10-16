// Package planning 描述作品准备产物，版本独立于章节 draftVersion。
package planning

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"inkloom/internal/agents/model"
)

type Reference struct {
	Title     string `json:"title"`
	Dimension string `json:"dimension"`
}
type PackRef struct {
	ID        string            `json:"id"`
	Version   int               `json:"version"`
	Overrides map[string]string `json:"overrides,omitempty"`
}
type Pack struct {
	ID       string `json:"id"`
	Version  int    `json:"version"`
	Name     string `json:"name"`
	Guidance string `json:"guidance"`
}

// Catalog 只是可选创作提示，不是质量检查器，也不自动成为硬门禁。
func Catalog() []Pack {
	return []Pack{
		{"relationships", 1, "人物关系", "以欲望冲突、关系代价和选择后的变化构成推进；不强制和解。"},
		{"mystery", 1, "悬念与揭示", "明确读者想追问的问题，线索与揭示要有因果；不强制反转。"},
		{"comedy", 1, "幽默与反差", "幽默来自人物立场、处境错位和回扣；避免机械堆梗或破坏情绪。"},
	}
}

type Intake struct {
	Premise     string      `json:"premise"`
	Genres      string      `json:"genres"`
	TargetWords string      `json:"targetWords"`
	Narrative   string      `json:"narrative"`
	Preferences string      `json:"preferences"`
	References  []Reference `json:"references"`
	Packs       []PackRef   `json:"packs"`
}
type Direction struct {
	Title            string `json:"title"`
	Logline          string `json:"logline"`
	CoreConflict     string `json:"coreConflict"`
	CharacterDilemma string `json:"characterDilemma"`
	ReaderAppeal     string `json:"readerAppeal"`
	Tone             string `json:"tone"`
	Narrative        string `json:"narrative"`
	Tradeoff         string `json:"tradeoff"`
}
type Output struct {
	Directions []Direction `json:"directions"`
}
type InputSnapshot struct {
	Version        int    `json:"version"`
	Digest         string `json:"digest"`
	Intake         Intake `json:"intake"`
	EffectivePacks []Pack `json:"effectivePacks"`
}

func Snapshot(version int, in Intake) InputSnapshot {
	packs := []Pack{}
	for _, ref := range in.Packs {
		for _, p := range Catalog() {
			if p.ID == ref.ID && p.Version == ref.Version {
				packs = append(packs, p)
			}
		}
	}
	s := InputSnapshot{Version: version, Intake: in, EffectivePacks: packs}
	raw, _ := json.Marshal(s)
	s.Digest = fmt.Sprintf("%x", sha256.Sum256(raw))
	return s
}

type Job struct {
	ID            string             `json:"id"`
	Version       int                `json:"version"` // 候选批次不可变，v1；状态变更不冒充内容新版本。
	Status        string             `json:"status"`  // running | completed | failed | interrupted
	Input         InputSnapshot      `json:"input"`
	Model         string             `json:"model"`
	PromptVersion string             `json:"promptVersion"`
	SchemaVersion string             `json:"schemaVersion"`
	Directions    []Direction        `json:"directions"`
	Message       string             `json:"message"`
	CreatedAt     time.Time          `json:"createdAt"`
	Calls         []model.CallRecord `json:"calls"`
}
type Selection struct {
	Version          int       `json:"version"`
	InputVersion     int       `json:"inputVersion"`
	InputDigest      string    `json:"inputDigest"`
	JobID            string    `json:"jobId"` // 空值表示作者直接提供已有方向。
	CandidateVersion int       `json:"candidateVersion"`
	CandidateIndex   int       `json:"candidateIndex"`
	Direction        Direction `json:"direction"`
	CreatedAt        time.Time `json:"createdAt"`
}
type State struct {
	ChapterPlans     []ChapterPlanSelection `json:"chapterPlans"`
	ChapterPlanJobs  []ChapterPlanJob       `json:"chapterPlanJobs"`
	OutlineVersion   int                    `json:"outlineVersion"`
	OutlineSelection *OutlineSelection      `json:"outlineSelection"`
	OutlineJobs      []OutlineJob           `json:"outlineJobs"`
	CoreVersion      int                    `json:"coreVersion"`
	CoreSelection    *CoreSelection         `json:"coreSelection"`
	CoreJobs         []CoreJob              `json:"coreJobs"`
	StyleVersion     int                    `json:"styleVersion"`
	StyleSelection   *StyleSelection        `json:"styleSelection"`
	StyleJobs        []StyleJob             `json:"styleJobs"`
	Input            InputSnapshot          `json:"input"`
	DirectionVersion int                    `json:"directionVersion"`
	Selection        *Selection             `json:"selection"`
	Jobs             []Job                  `json:"jobs"`
	Packs            []Pack                 `json:"packs"`
}
type SelectRequest struct {
	ExpectedInputVersion     int       `json:"expectedInputVersion"`
	ExpectedDirectionVersion int       `json:"expectedDirectionVersion"`
	JobID                    string    `json:"jobId"`
	CandidateVersion         int       `json:"candidateVersion"`
	CandidateIndex           int       `json:"candidateIndex"`
	Direction                Direction `json:"direction"`
}

func bounded(s string, n int, required bool) bool {
	return len(s) <= n && (!required || strings.TrimSpace(s) != "")
}
func (i Intake) Validate() error {
	if !bounded(i.Premise, 6000, true) || !bounded(i.Genres, 300, false) || !bounded(i.TargetWords, 100, false) || !bounded(i.Narrative, 500, false) || !bounded(i.Preferences, 3000, false) || len(i.References) > 5 || len(i.Packs) > 3 {
		return fmt.Errorf("立意必填，输入过长或条目过多")
	}
	for _, r := range i.References {
		if !bounded(r.Title, 300, true) || !bounded(r.Dimension, 1000, true) {
			return fmt.Errorf("参考作品需填写作品名与参考维度")
		}
	}
	seen := map[string]bool{}
	for _, ref := range i.Packs {
		found := false
		for _, p := range Catalog() {
			if ref.ID == p.ID && ref.Version == p.Version {
				found = true
			}
		}
		if !found || seen[ref.ID] || len(ref.Overrides) > 8 {
			return fmt.Errorf("创作模板版本无效或重复")
		}
		seen[ref.ID] = true
		for k, v := range ref.Overrides {
			if !bounded(k, 100, true) || !bounded(v, 1000, true) {
				return fmt.Errorf("模板覆盖项无效")
			}
		}
	}
	return nil
}
func (d Direction) Validate() error {
	for _, s := range []string{d.Title, d.Logline, d.CoreConflict, d.CharacterDilemma, d.ReaderAppeal, d.Tone, d.Narrative, d.Tradeoff} {
		if !bounded(s, 2400, true) {
			return fmt.Errorf("方向各项必须填写，单项不超过 2400 字节")
		}
	}
	return nil
}
func (o Output) Validate() error {
	if len(o.Directions) < 2 || len(o.Directions) > 3 {
		return fmt.Errorf("需要 2–3 个候选")
	}
	seen := map[string]bool{}
	for _, d := range o.Directions {
		if err := d.Validate(); err != nil {
			return err
		}
		if seen[d.Logline] {
			return fmt.Errorf("候选立意重复")
		}
		seen[d.Logline] = true
	}
	return nil
}
