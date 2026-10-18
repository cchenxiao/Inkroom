package agents

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
)

type scopeRecorder struct {
	next   model.ChatModel
	inputs []model.Input
}

func (r *scopeRecorder) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	r.inputs = append(r.inputs, in)
	return r.next.Generate(ctx, in)
}

func TestChapterWriterOneCallPreservesEveryTarget(t *testing.T) {
	b := manuscript.ContextBundle{ChapterID: "chapter", Targets: []manuscript.ContextBundle{{Beat: manuscript.Beat{ID: "a", SceneID: "scene-a"}, POV: "甲"}, {Beat: manuscript.Beat{ID: "b", SceneID: "scene-b"}, POV: "乙"}}}
	chat := &scopeRecorder{next: model.NewFake([]model.Step{{Role: "planned_writer", Content: `{"parts":[{"beatId":"a","text":"甲走进屋子。"},{"beatId":"b","text":"乙听见脚步。"}]}`}})}
	got, _, err := WriteScope(context.Background(), chat, b)
	if err != nil || len(got) != 2 || len(chat.inputs) != 1 || got[1].BeatID != "b" || got[1].POV != "乙" || got[1].ChapterID != "chapter" {
		t.Fatal(got, err)
	}
	if !strings.Contains(chat.inputs[0].Task, "beatId=a") || !strings.Contains(chat.inputs[0].Task, "beatId=b") || !strings.Contains(chat.inputs[0].Task, "不是每段重复完成") {
		t.Fatal("missing per-beat scope instructions")
	}
	for _, bad := range []string{`{"parts":[{"beatId":"b","text":"乱序"},{"beatId":"a","text":"错位"}]}`, `{"parts":[{"beatId":"a","text":"漏段"}]}`, `{"parts":[{"beatId":"a","text":"重复"},{"beatId":"a","text":"重复"}]}`} {
		chat := model.NewFake([]model.Step{{Role: "planned_writer", Content: bad}})
		if _, _, err := WriteScope(context.Background(), chat, b); err == nil {
			t.Fatal("accepted wrong chapter targets", bad)
		}
	}
}
func TestAuthorRewritePreservesUnicodeBoundariesAndOtherSegments(t *testing.T) {
	original := []manuscript.Segment{{ID: "s1", BeatID: "a", Text: "前文。", Version: 2}, {ID: "s2", BeatID: "b", Text: "他🙂开门。她等着。", Version: 3}, {ID: "s3", BeatID: "c", Text: "后文。", Version: 2}}
	req := manuscript.AuthorRewrite{SegmentID: "s2", Original: original[1].Text, Start: 2, End: 4, Instruction: "改为敲门"}
	b := manuscript.ContextBundle{Neighbors: []manuscript.Passage{{BeatID: "a", Position: "before", Version: 2, Segments: original[:1]}, {BeatID: "c", Position: "after", Version: 2, Segments: original[2:]}}}
	chat := &scopeRecorder{next: model.NewFake([]model.Step{{Role: "planned_writer", Content: `{"text":"敲门"}`}})}
	got, _, err := RewriteAuthor(context.Background(), chat, original, b, req)
	if err != nil || got[1].Text != "他🙂敲门。她等着。" || !reflect.DeepEqual(got[0], original[0]) || !reflect.DeepEqual(got[2], original[2]) || original[1].Text != req.Original {
		t.Fatal(got, err)
	}
	var material struct {
		Context manuscript.ContextBundle
		Request manuscript.AuthorRewrite `json:"rewrite"`
	}
	if err = json.Unmarshal(chat.inputs[0].Material, &material); err != nil || len(material.Context.Neighbors) != 2 || material.Request != req {
		t.Fatal("missing pinned material", err)
	}
	for _, bad := range []manuscript.AuthorRewrite{{SegmentID: "s2", Original: "旧正文", Start: 0, End: 1, Instruction: "改"}, {SegmentID: "s2", Original: req.Original, Start: 0, End: 100, Instruction: "改"}, {SegmentID: "unknown", Original: req.Original, Start: 0, End: 1, Instruction: "改"}} {
		if _, _, err = RewriteAuthor(context.Background(), chat, original, b, bad); err == nil {
			t.Fatal("invalid range accepted")
		}
	}
	if len(chat.inputs) != 1 {
		t.Fatal("invalid request invoked model")
	}
}

func TestChapterCriticKeepsPerBeatKnowledgeAndHidesAuthorPlan(t *testing.T) {
	b := manuscript.ContextBundle{Targets: []manuscript.ContextBundle{
		{Beat: manuscript.Beat{ID: "a"}, Facts: []manuscript.SourceRef{{ID: "known", Version: 1, Text: "知道钥匙在桌上"}}, WritingTask: &manuscript.WritingTask{}},
		{Beat: manuscript.Beat{ID: "b"}, Facts: []manuscript.SourceRef{{ID: "future", Version: 1, Text: "后来才知道的秘密"}}},
	}}
	segments := []manuscript.Segment{{ID: "s1", BeatID: "a", Text: "他拿起钥匙。", Version: 1}, {ID: "s2", BeatID: "b", Text: "后来。", Version: 1}}
	invalid := `{"findings":[{"id":"hard-1","critic":"hard_consistency","severity":"P1","segmentId":"s1","quote":"拿起钥匙","evidenceRefs":["s1","future"],"reason":"与后文知识冲突","suggestion":"改掉动作","repairScope":"segment","draftVersion":1,"ruleRef":"future","ruleQuote":"后来才知道的秘密","evidenceStatus":"confirmed","possibleDialogueLie":false,"requiresHuman":false}]}`
	if _, _, err := CheckConsistency(context.Background(), model.NewFake([]model.Step{{Role: "hard_consistency", Content: invalid}}), segments, 1, b); err == nil {
		t.Fatal("used another beat's knowledge as confirmed evidence")
	}
	chat := &scopeRecorder{next: model.NewFake([]model.Step{{Role: "hard_consistency", Content: `{"findings":[]}`}})}
	if _, _, err := CheckConsistency(context.Background(), chat, segments, 1, b); err != nil {
		t.Fatal(err)
	}
	var material map[string]any
	if err := json.Unmarshal(chat.inputs[0].Material, &material); err != nil {
		t.Fatal(err)
	}
	for _, target := range material["targets"].([]any) {
		if _, exists := target.(map[string]any)["writingTask"]; exists {
			t.Fatal("critic received author outline")
		}
	}
}
