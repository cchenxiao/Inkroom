package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/domain/manuscript"
	"strings"
)

// WriteScope keeps one author role; the contract declares beat or full chapter scope.
func WriteScope(ctx context.Context, chat model.ChatModel, b manuscript.ContextBundle) ([]manuscript.Segment, model.Usage, error) {
	if b.Rewrite != nil {
		updated, usage, err := RewriteAuthor(ctx, chat, b.Original, b, *b.Rewrite)
		return updated, usage, err
	}
	if len(b.Original) > 0 {
		return append([]manuscript.Segment{}, b.Original...), model.Usage{Known: true}, nil
	}
	if len(b.Targets) == 0 {
		s, u, e := Write(ctx, chat, b)
		return []manuscript.Segment{s}, u, e
	}
	type part struct {
		BeatID string `json:"beatId"`
		Text   string `json:"text"`
	}
	type result struct {
		Parts []part `json:"parts"`
	}
	material, err := json.Marshal(b)
	if err != nil {
		return nil, model.Usage{}, err
	}
	task := "targets 中 inherit 列出的字段完整继承顶层同名材料；未列出的字段使用该目标自己的材料，不得混用不同视角的事实。一次生成清单中的全部情节段。neighbors 是已有正文，只读，不得重写或输出；直接衔接已有情节，不要再次发生其中已完成的事件。parts 是一章内指定的情节段，不是多篇各自完整的故事。严格按下面的分段清单推进，每段只完成自己的动作和转折，不能提前写后续段，也不能把第一段写成完整章后再续写新章节。最后一段达到规划终点即结束，不新增后续拜访、证人、调查结果。全章 Brief 是各段共同完成的总目标，不是每段重复完成的任务。"
	if t := b.WritingTask; t != nil && t.ChapterTargetWords > 0 {
		target := 0
		for _, part := range b.Targets {
			if part.WritingTask != nil {
				target += part.WritingTask.BeatTargetWords
			}
		}
		if target == 0 {
			target = t.ChapterTargetWords
		}
		task += fmt.Sprintf("全章目标 %d 字，其中已保留正文 %d 字；控制完成后的全章总量，不得为满足篇幅删改 neighbors。若保留正文已达到目标，用完成剩余情节所需的最少文字，不截断情节。", t.ChapterTargetWords, t.PreservedWords)
		task += fmt.Sprintf("本次待生成部分合计目标 %d 字，按非空白字符（含标点）计数，参考区间 %d–%d 字；这是全部 %d 段的总量，不是单段目标。每段参考 %d 字，先分配篇幅，不重复确认已完成的事件，不截断结尾。", target, target*4/5, target, len(b.Targets), target/len(b.Targets))
	}
	task += "\n按顺序执行的分段清单（beatId 必须逐字复制）：\n"
	for i, target := range b.Targets {
		task += fmt.Sprintf("%d. beatId=%s；标题=%s；本段唯一任务及结束状态=%s\n", i+1, target.Beat.ID, target.Beat.Title, target.Beat.Description)
	}
	task += "输出前核对：每段仅完成对应任务；段与段直接衔接；最后一段没有越过规划终点；全部段落合计符合本次目标篇幅。"
	output, usage, err := parse.Generate[result](ctx, chat, model.Input{Role: "planned_writer", Task: task, Material: material, OutputSchema: contracts.ChapterWriterSchema}, func(out result) error {
		if len(out.Parts) != len(b.Targets) {
			return fmt.Errorf("整章应包含 %d 个情节段，模型只返回了 %d 个；未保存不完整候选", len(b.Targets), len(out.Parts))
		}
		for i, p := range out.Parts {
			if p.BeatID != b.Targets[i].Beat.ID || strings.TrimSpace(p.Text) == "" {
				return fmt.Errorf("第 %d 个情节段与细纲顺序不符或正文为空；未保存错位候选", i+1)
			}
		}
		return nil
	})
	if err != nil {
		return nil, usage, err
	}
	segments := make([]manuscript.Segment, 0, len(output.Parts))
	for i, p := range output.Parts {
		t := b.Targets[i]
		segments = append(segments, manuscript.Segment{ID: p.BeatID + "-seg-1", ChapterID: b.ChapterID, SceneID: t.Beat.SceneID, BeatID: p.BeatID, Order: i + 1, Text: p.Text, POV: t.POV, Version: 1})
	}
	return segments, usage, nil
}
func RewriteAuthor(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, b manuscript.ContextBundle, req manuscript.AuthorRewrite) ([]manuscript.Segment, model.Usage, error) {
	if err := req.Validate(segments); err != nil {
		return nil, model.Usage{}, err
	}
	if len(b.Targets) > 0 {
		for _, segment := range segments {
			if segment.ID == req.SegmentID {
				target, ok := b.ForBeat(segment.BeatID)
				if !ok {
					return nil, model.Usage{}, fmt.Errorf("unknown rewrite target")
				}
				b = target
				break
			}
		}
	}
	// Prior author requests remain in the frozen audit record, but are not instructions for this rewrite.
	b.Rewrite, b.RevisionRequest, b.Original = nil, nil, nil
	original := []rune(req.Original)
	material, err := json.Marshal(struct {
		Context  manuscript.ContextBundle `json:"context"`
		Segments []manuscript.Segment     `json:"segments"`
		Request  manuscript.AuthorRewrite `json:"rewrite"`
		Selected string                   `json:"selectedText"`
		Before   string                   `json:"readOnlyBefore"`
		After    string                   `json:"readOnlyAfter"`
	}{b, segments, req, string(original[req.Start:req.End]), string(original[max(0, req.Start-160):req.Start]), string(original[req.End:min(len(original), req.End+160)])})
	if err != nil {
		return nil, model.Usage{}, err
	}
	type replacementOutput struct {
		Text *string `json:"text"`
	}
	out, u, err := parse.Generate[replacementOutput](ctx, chat, model.Input{Role: "planned_writer", Task: "按 rewrite.instruction 重写指定范围。作者本次明确的篇幅、删减与结构要求优先于 context 中生成原稿时的目标字数；压缩时允许重组整个选区，不要为了保留原句而保留重复动作、问答和总结。先分配所要求的篇幅，输出前按非空白字符（含标点）核对。start/end 是原文 Unicode 码点偏移，end 不包含。selectedText 是唯一可替换的原文。只返回这个范围的替换正文 text，不包含前后缀。readOnlyBefore 和 readOnlyAfter 会由程序原样拼接，禁止把其中已有的句子再输出；要求“直接接后文”时，删除选区即可，不要复制后文。注意选区外已有的标点，避免拼接后重复；若要求删除选区内容，text 可为空字符串。其他正文与 neighbors 只读；后文不是角色已知事实。", Material: material, OutputSchema: contracts.ReplacementSchema}, func(out replacementOutput) error {
		if out.Text == nil {
			return fmt.Errorf("模型未返回替换正文 text")
		}
		if copiesReadOnlyBoundary(req, *out.Text) {
			return fmt.Errorf("模型把选区外已有的句子重复写入了替换内容，本次正文未改变；请重新生成局部修改")
		}
		if manuscript.NormalizeReplacementBoundary(req, *out.Text) == string([]rune(req.Original)[req.Start:req.End]) {
			return fmt.Errorf("模型没有修改选中的正文，本次结果未保存，请补充要求后重试")
		}
		return nil
	})
	if err != nil {
		return nil, u, err
	}
	replacement := manuscript.NormalizeReplacementBoundary(req, *out.Text)
	text, err := manuscript.ApplyAuthorReplacement(req.Original, req, replacement)
	if err != nil {
		return nil, u, err
	}
	updated := append([]manuscript.Segment{}, segments...)
	for i, s := range updated {
		if s.ID == req.SegmentID {
			updated[i].Text = text
			updated[i].Version++
		}
	}
	return updated, u, nil
}

// Reject newly duplicated adjacent sentences instead of silently changing the
// author's text or allowing a local fix to manufacture the next review issue.
func copiesReadOnlyBoundary(req manuscript.AuthorRewrite, replacement string) bool {
	source := []rune(req.Original)
	selected := strings.TrimSpace(string(source[req.Start:req.End]))
	out := []rune(strings.TrimSpace(replacement))
	before := []rune(strings.TrimSpace(string(source[:req.Start])))
	after := []rune(strings.TrimSpace(string(source[req.End:])))
	substantial := func(s string) bool { return strings.ContainsAny(s, "。！？!?\n") }
	for n := 8; n <= min(len(out), len(after)); n++ {
		part := string(after[:n])
		if substantial(part) && string(out[len(out)-n:]) == part && !strings.HasSuffix(selected, part) {
			return true
		}
	}
	for n := 8; n <= min(len(out), len(before)); n++ {
		part := string(before[len(before)-n:])
		if substantial(part) && string(out[:n]) == part && !strings.HasPrefix(selected, part) {
			return true
		}
	}
	return false
}
