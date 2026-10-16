package planning

import (
	"fmt"
	"reflect"
	"strings"
)

// TemporaryBeat 仅供比较文风；不分配正式 chapter/segment ID，也不写入事实库。
type TemporaryBeat struct {
	Summary string   `json:"summary"`
	Facts   []string `json:"facts"`
	Outcome string   `json:"outcome"`
	POV     string   `json:"pov"`
	Tense   string   `json:"tense"`
}

// TrialStyle 是作者要求，不是模型实测指标，也不是已采用的 StyleProfile。
type TrialStyle struct {
	ID            string   `json:"id"`
	Label         string   `json:"label"`
	Instructions  string   `json:"instructions"`
	AnchorText    string   `json:"anchorText"` // 可选 few-shot 范文，只借表达方法，不借人物/事实。
	BannedPhrases []string `json:"bannedPhrases"`
}
type TrialInput struct {
	Source    InputSnapshot `json:"source"`
	Selection Selection     `json:"selection"`
	Beat      TemporaryBeat `json:"beat"`
	Variants  []TrialStyle  `json:"variants"`
}

func (in TrialInput) Validate() error {
	if err := in.Source.Intake.Validate(); err != nil {
		return err
	}
	expectedSource := Snapshot(in.Source.Version, in.Source.Intake)
	if !reflect.DeepEqual(in.Source.EffectivePacks, expectedSource.EffectivePacks) {
		return fmt.Errorf("来源模板快照与立意不匹配")
	}
	if in.Source.Version < 1 || in.Selection.Version < 1 || in.Selection.InputVersion != in.Source.Version || in.Selection.InputDigest != in.Source.Digest || in.Source.Digest != expectedSource.Digest {
		return fmt.Errorf("试笔需要与当前立意版本匹配的已选方向；旧方向请先复核")
	}
	if err := in.Selection.Direction.Validate(); err != nil {
		return err
	}
	if !bounded(in.Beat.Summary, 3000, true) || !bounded(in.Beat.Outcome, 1200, true) || !bounded(in.Beat.POV, 300, true) || !bounded(in.Beat.Tense, 100, true) || len(in.Beat.Facts) > 12 {
		return fmt.Errorf("临时场景、固定结果、视角和时态必填，且不得超长")
	}
	for _, f := range in.Beat.Facts {
		if !bounded(f, 900, true) {
			return fmt.Errorf("临时事实不能为空或过长")
		}
	}
	if len(in.Variants) != 2 {
		return fmt.Errorf("同场景试笔恰好需要两套风格要求")
	}
	for n, v := range in.Variants {
		if !bounded(v.ID, 80, true) || !bounded(v.Label, 200, true) || !bounded(v.Instructions, 2000, true) || !bounded(v.AnchorText, 6000, false) || len(v.BannedPhrases) > 30 {
			return fmt.Errorf("风格要求不完整或过长")
		}
		for _, p := range v.BannedPhrases {
			if !bounded(p, 150, true) {
				return fmt.Errorf("禁用表达不能为空或过长")
			}
		}
		if n == 1 && (v.ID == in.Variants[0].ID || strings.TrimSpace(v.Instructions) == strings.TrimSpace(in.Variants[0].Instructions)) {
			return fmt.Errorf("两个方案的 ID 和风格要求必须不同")
		}
	}
	return nil
}
