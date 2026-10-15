package demo

import (
	"encoding/json"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"inkloom/internal/domain/revision"
)

func consistencyScenario(name string, b manuscript.ContextBundle) (manuscript.ContextBundle, []model.Step, bool) {
	switch name {
	case "hard-conflict", "scene-gap", "cross-chapter", "dialogue-lie", "handedness", "critic-failed", "invalid-rule", "rewrite-stale", "rewrite-unsafe":
	default:
		return b, nil, false
	}
	b.Characters[0].HardTraits = append(b.Characters[0].HardTraits, manuscript.SourceRef{ID: "fact-hand-injury", Version: 2, Text: "第七章沈砚右手肌腱断裂，无法握刀；本场不会痊愈。"})
	before := "陆青把铜扣放在桌沿。沈砚右手握刀，挑开扣眼里的泥。他没抬头，只问：哪来的？陆青看着窗外，没有回答。"
	after := "陆青把铜扣放在桌沿。沈砚用左手拈住铜扣，拨开扣眼里的泥。他没抬头，只问：哪来的？陆青看着窗外，没有回答。"
	f := review.Finding{ID: "hard-hand-1", Critic: "hard_consistency", Severity: review.P0, SegmentID: "ch7-beat-1-seg-1", Quote: "沈砚右手握刀", EvidenceRefs: []string{"ch7-beat-1-seg-1", "fact-hand-injury"}, Reason: "本章右手无法握刀，正文中的动作违反明确伤势约束。", Suggestion: "保留交还铜扣的事件，改为使用左手检查铜扣。", RepairScope: "beat", DraftVersion: 1, RuleRef: "fact-hand-injury", RuleQuote: "第七章沈砚右手肌腱断裂，无法握刀", EvidenceStatus: "confirmed"}
	role := "structural_reviser"
	switch name {
	case "scene-gap":
		before = "铜扣仍在陆青口袋里。沈砚伸手要她交还父亲的铜扣。陆青把它放到桌沿，没有回答他的问题。"
		b.Facts = append(b.Facts, manuscript.SourceRef{ID: "fact-scene-cause", Version: 1, Text: "沈砚事前不知道陆青带来铜扣；看见它后才会要求交还。"})
		f.ID = "hard-cause-1"
		f.Severity = review.P1
		f.Quote = "沈砚伸手要她交还父亲的铜扣"
		f.RuleRef = "fact-scene-cause"
		f.RuleQuote = "沈砚事前不知道陆青带来铜扣"
		f.EvidenceRefs = []string{f.SegmentID, f.RuleRef}
		f.RepairScope = "scene"
		f.Reason = "缺少看见铜扣的触发动作，要求交还发生得过早。"
		f.Suggestion = "先呈现陆青拿出铜扣，再让沈砚伸手追问。"
		role = "scene_reviser"
	case "cross-chapter":
		f.RepairScope = "cross_chapter"
		f.RequiresHuman = true
		f.Suggestion = "需要调整前章受伤情节，须先由作者选择是否修改设定。"
	case "handedness":
		b.Characters[0].HardTraits = b.Characters[0].HardTraits[:1]
		f.RuleRef = "fact-left-handed"
		f.RuleQuote = "沈砚惯用左手"
		f.EvidenceRefs = []string{f.SegmentID, f.RuleRef}
		f.Severity = review.P3
		f.EvidenceStatus = "uncertain"
		f.Reason = "惯用左手不排除右手动作，证据不足以认定硬伤。"
		f.Suggestion = "可请作者核实动作习惯，不阻断当前候选。"
	case "dialogue-lie":
		before = "陆青把铜扣放到桌沿。沈砚藏着受伤的右手，说：“我的右手早好了。”陆青没有接话。"
		f.Quote = "我的右手早好了"
		f.Severity = review.P3
		f.EvidenceStatus = "uncertain"
		f.PossibleDialogueLie = true
		f.RequiresHuman = true
		f.Reason = "台词与伤势不同，可能是沈砚在隐瞒，不能自动当世界事实改写。"
		f.Suggestion = "请作者确认这是故意撒谎还是正文错误。"
	case "invalid-rule":
		f.RuleQuote = "沈砚右手已经痊愈"
	}
	marshal := func(v any) string { raw, _ := json.Marshal(v); return string(raw) }
	hard := model.Step{Role: "hard_consistency", DraftVersion: 1, Content: marshal(map[string]any{"findings": []review.Finding{f}})}
	// hard schema 要求 false 值显式出现，领域序列化的 omitempty 仅用于 API 简洁显示。
	var payload map[string]any
	_ = json.Unmarshal([]byte(hard.Content), &payload)
	item := payload["findings"].([]any)[0].(map[string]any)
	item["possibleDialogueLie"] = f.PossibleDialogueLie
	item["requiresHuman"] = f.RequiresHuman
	hard.Content = marshal(payload)
	if name == "critic-failed" {
		hard.FinishReason = model.Refused
	}
	steps := []model.Step{{Role: "writer", Content: marshal(map[string]string{"text": before})}, hard, {Role: "ai_taste", DraftVersion: 1, Content: `{"findings":[]}`}}
	p := revision.Proposal{BasedOnDraftVersion: 1, Patches: []revision.Patch{{FindingID: f.ID, SegmentID: f.SegmentID, ChangeType: "replace", OldText: before, NewText: after, Reason: f.Suggestion}}}
	if name == "rewrite-stale" {
		p.BasedOnDraftVersion = 9
	}
	if name == "rewrite-unsafe" {
		p.Patches[0].SegmentID = "ch3-seg-14"
	}
	steps = append(steps, model.Step{Role: role, DraftVersion: 1, Content: marshal(p)}, model.Step{Role: "hard_consistency", DraftVersion: 2, Content: `{"findings":[]}`}, model.Step{Role: "ai_taste", DraftVersion: 2, Content: `{"findings":[]}`})
	return b, steps, true
}
