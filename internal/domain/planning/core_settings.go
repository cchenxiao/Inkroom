package planning

import (
	"fmt"
	"reflect"
)

// CoreSettingsInput 的风格版本必须依赖同一立意/方向；文件输入只证明内部一致。
type CoreSettingsInput struct {
	Source    InputSnapshot  `json:"source"`
	Selection Selection      `json:"selection"`
	Style     StyleSelection `json:"style"`
	Request   string         `json:"request"` // 本次需要的人物与世界范围，避免一次铺满全书。
}

func (in CoreSettingsInput) Validate() error {
	if in.Source.Intake.Validate() != nil || in.Selection.Direction.Validate() != nil || in.Style.Rules.Validate() != nil {
		return fmt.Errorf("需要有效的立意、已选方向和已确认风格")
	}
	expected := Snapshot(in.Source.Version, in.Source.Intake)
	if in.Source.Version < 1 || in.Source.Digest != expected.Digest || !reflect.DeepEqual(in.Source.EffectivePacks, expected.EffectivePacks) || in.Selection.Version < 1 || in.Selection.InputVersion != in.Source.Version || in.Selection.InputDigest != in.Source.Digest || in.Style.Version < 1 || in.Style.AnchorVersion < 1 || in.Style.InputVersion != in.Source.Version || in.Style.DirectionVersion != in.Selection.Version {
		return fmt.Errorf("核心设定依赖的立意、方向或风格版本过期")
	}
	if !bounded(in.Request, 2400, true) {
		return fmt.Errorf("请限定本次补齐的设定范围")
	}
	return nil
}

// CharacterDesign 永远是作者视角创作元数据；不实现 memory.Record 转换，不能作为角色已知事实。
type CharacterDesign struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Role        string   `json:"role"`
	Want        string   `json:"want"`
	Need        string   `json:"need"`
	Flaw        string   `json:"flaw"`
	ArcIntent   string   `json:"arcIntent"`
	Voice       []string `json:"voice"`
	HardFactIDs []string `json:"hardFactIds"`
}
type ProposedKnowledge struct {
	CharacterID string `json:"characterId"`
	LearnedAt   *int64 `json:"learnedAt"`
}
type WorldFactProposal struct {
	ID        string              `json:"id"`
	Subject   string              `json:"subject"` // world 或某个候选人物 ID。
	Text      string              `json:"text"`
	Rigidity  string              `json:"rigidity"`
	StoryTime *int64              `json:"storyTime"` // 尚未确定时为 null，不能默认为故事起点。
	KnownBy   []ProposedKnowledge `json:"knownBy"`   // 无信息为空，不能推断全员知晓。
}
type FuturePlan struct {
	ID      string `json:"id"`
	Subject string `json:"subject"`
	Intent  string `json:"intent"`
}
type CoreSettingsOutput struct {
	Characters []CharacterDesign   `json:"characters"`
	WorldFacts []WorldFactProposal `json:"worldFacts"`
	Plans      []FuturePlan        `json:"plans"`
}

func (out CoreSettingsOutput) Validate() error {
	if len(out.Characters) < 1 || len(out.Characters) > 3 || len(out.WorldFacts) > 8 || len(out.Plans) > 4 {
		return fmt.Errorf("仅生成 1–3 位主要人物、最多 8 条事实提案与 4 条计划")
	}
	ids := map[string]bool{"world": true}
	chars := map[string]bool{}
	facts := map[string]bool{}
	add := func(id string) bool {
		if !bounded(id, 80, true) || ids[id] {
			return false
		}
		ids[id] = true
		return true
	}
	for _, c := range out.Characters {
		if !add(c.ID) || len(c.Voice) < 1 || len(c.Voice) > 5 || len(c.HardFactIDs) > 8 {
			return fmt.Errorf("人物 ID、声音或事实引用无效")
		}
		chars[c.ID] = true
		for _, s := range []string{c.Name, c.Role, c.Want, c.Need, c.Flaw, c.ArcIntent} {
			if !bounded(s, 600, true) {
				return fmt.Errorf("人物创作设定缺失或过长")
			}
		}
		for _, s := range c.Voice {
			if !bounded(s, 300, true) {
				return fmt.Errorf("人物声音标签无效")
			}
		}
	}
	validSubject := func(s string) bool { return s == "world" || chars[s] }
	for _, f := range out.WorldFacts {
		if !add(f.ID) || !validSubject(f.Subject) || !bounded(f.Text, 900, true) || (f.Rigidity != "hard" && f.Rigidity != "soft") || len(f.KnownBy) > 3 || f.StoryTime != nil && *f.StoryTime < 0 {
			return fmt.Errorf("事实提案或故事时间无效")
		}
		facts[f.ID] = f.Rigidity == "hard"
		seen := map[string]bool{}
		for _, k := range f.KnownBy {
			if !chars[k.CharacterID] || seen[k.CharacterID] || k.LearnedAt != nil && (*k.LearnedAt < 0 || f.StoryTime != nil && *k.LearnedAt < *f.StoryTime) {
				return fmt.Errorf("知情主体、时点或重复知情记录无效")
			}
			seen[k.CharacterID] = true
		}
	}
	for _, c := range out.Characters {
		for _, ref := range c.HardFactIDs {
			if !facts[ref] {
				return fmt.Errorf("人物硬特质必须引用存在的硬事实提案")
			}
		}
	}
	for _, p := range out.Plans {
		if !add(p.ID) || !validSubject(p.Subject) || !bounded(p.Intent, 900, true) {
			return fmt.Errorf("未来计划引用或内容无效")
		}
	}
	return nil
}
