package planning

import (
	"fmt"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/style"
	"math"
	"time"
)

type TrialSample struct {
	Variant TrialStyle  `json:"variant"`
	Text    string      `json:"text"`
	Stats   style.Stats `json:"stats"`
}
type TrialReport struct {
	Status      string             `json:"status"`
	Model       string             `json:"model"`
	Input       TrialInput         `json:"input"`
	InputDigest string             `json:"inputDigest"`
	Samples     []TrialSample      `json:"samples"`
	Calls       []model.CallRecord `json:"calls"`
	Usage       model.Usage        `json:"usage"`
	Message     string             `json:"message"`
}

// StartTrialRequest 只接受版本与临时素材，正式方向一律由仓储读取。
type StartTrialRequest struct {
	RequestID                string        `json:"requestId"`
	ExpectedInputVersion     int           `json:"expectedInputVersion"`
	ExpectedDirectionVersion int           `json:"expectedDirectionVersion"`
	Beat                     TemporaryBeat `json:"beat"`
	Variants                 []TrialStyle  `json:"variants"`
}
type StyleJob struct {
	ID            string            `json:"id"`
	Version       int               `json:"version"`
	Request       StartTrialRequest `json:"request"`
	Report        TrialReport       `json:"report"`
	PromptVersion string            `json:"promptVersion"`
	SchemaVersion string            `json:"schemaVersion"`
	CreatedAt     time.Time         `json:"createdAt"`
}

// NumberRange 是作者软目标，不参与门禁，不由样本统计冒充确认值。
type NumberRange struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
}
type StyleRules struct {
	POV            string      `json:"pov"`
	Tense          string      `json:"tense"`
	Tone           string      `json:"tone"`
	SentenceLength NumberRange `json:"sentenceLength"`
	DialogueRatio  NumberRange `json:"dialogueRatio"`
	BannedPhrases  []string    `json:"bannedPhrases"`
	StyleArc       string      `json:"styleArc"` // 叙事阶段文字；M0.4 再绑定章节。
}

func (r StyleRules) Validate() error {
	if !bounded(r.POV, 300, true) || !bounded(r.Tense, 100, true) || !bounded(r.Tone, 2400, true) || !bounded(r.StyleArc, 2400, false) || len(r.BannedPhrases) > 30 {
		return fmt.Errorf("风格规矩不完整或过长")
	}
	validRange := func(r NumberRange, max float64) bool {
		return !math.IsNaN(r.Min) && !math.IsNaN(r.Max) && r.Min >= 0 && r.Min <= r.Max && r.Max <= max
	}
	if !validRange(r.SentenceLength, 300) || r.SentenceLength.Max == 0 || !validRange(r.DialogueRatio, 1) {
		return fmt.Errorf("句长范围应在 0–300 字之间，对话占比应在 0–1 之间，且最小值不大于最大值")
	}
	for _, p := range r.BannedPhrases {
		if !bounded(p, 150, true) {
			return fmt.Errorf("禁用表达为空或过长")
		}
	}
	return nil
}

type StyleSelectionRequest struct {
	AnalysisID               string     `json:"analysisId"`
	AnalysisVersion          int        `json:"analysisVersion"`
	SourceStyleVersion       int        `json:"sourceStyleVersion"` // 编辑/复核既有风格时保留来源链。
	ExpectedInputVersion     int        `json:"expectedInputVersion"`
	ExpectedDirectionVersion int        `json:"expectedDirectionVersion"`
	ExpectedStyleVersion     int        `json:"expectedStyleVersion"`
	JobID                    string     `json:"jobId"`
	CandidateVersion         int        `json:"candidateVersion"`
	VariantID                string     `json:"variantId"`
	AnchorText               string     `json:"anchorText"`
	Rules                    StyleRules `json:"rules"`
}
type StyleSelection struct {
	AnalysisID         string     `json:"analysisId"`
	AnalysisVersion    int        `json:"analysisVersion"`
	SourceStyleVersion int        `json:"sourceStyleVersion"`
	Version            int        `json:"version"`
	InputVersion       int        `json:"inputVersion"`
	DirectionVersion   int        `json:"directionVersion"`
	AnchorVersion      int        `json:"anchorVersion"` // 与 profile 原子发布；不是正文段落版本。
	JobID              string     `json:"jobId"`
	CandidateVersion   int        `json:"candidateVersion"`
	VariantID          string     `json:"variantId"`
	AnchorText         string     `json:"anchorText"`
	Rules              StyleRules `json:"rules"`
	CreatedAt          time.Time  `json:"createdAt"`
}

func (r StyleSelectionRequest) Validate() error {
	if !bounded(r.AnchorText, 12000, true) || !bounded(r.JobID, 80, false) || !bounded(r.VariantID, 80, false) {
		return fmt.Errorf("请选择试笔并填写锚文本，最多 12000 字节")
	}
	if !bounded(r.AnalysisID, 80, false) || (r.AnalysisID == "" && r.AnalysisVersion != 0) || (r.AnalysisID != "" && (r.AnalysisVersion < 1 || r.JobID != "")) {
		return fmt.Errorf("风格分析来源无效或与试笔来源冲突")
	}
	if r.SourceStyleVersion < 0 {
		return fmt.Errorf("来源风格版本无效")
	}
	if r.JobID == "" && (r.CandidateVersion != 0 || r.VariantID != "") {
		return fmt.Errorf("作者直接提供范文时不得伪造候选来源")
	}
	if r.JobID != "" && (r.CandidateVersion < 1 || r.VariantID == "") {
		return fmt.Errorf("候选来源不完整")
	}
	return r.Rules.Validate()
}
