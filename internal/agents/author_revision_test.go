package agents

import (
	"context"
	"encoding/json"
	"testing"

	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

func TestAuthorQuestionMustBeAssessedAgainstCurrentTarget(t *testing.T) {
	request := manuscript.AuthorRewrite{SegmentID: "s", Original: "十七页翻过去是十九页，抽走了一张。", Instruction: "中间撕了一张怎么会隔一页呢？"}
	segments := []manuscript.Segment{{ID: "s", Text: "下一张是十九页，中间没有十八，是有人抽走了一张。", Version: 2}}
	for _, tc := range []struct {
		name, output string
		valid        bool
	}{
		{"empty generic findings", `{"findings":[]}`, false},
		{"missing evidence", `{"findings":[],"authorCheck":{"status":"addressed","reason":"已修复","quote":"不存在的句子"}}`, false},
		{"unresolved logic", `{"findings":[],"authorCheck":{"status":"unresolved","reason":"仍把一张纸与一个页码等同，未说明编号依据。","quote":"下一张是十九页"}}`, true},
		{"needs author decision", `{"findings":[],"authorCheck":{"status":"needs_clarification","reason":"需要确认编号规则及后段是否一起改。","quote":"下一张是十九页"}}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			chat := &scopeRecorder{next: model.NewFake([]model.Step{{Role: "hard_consistency", Content: tc.output}})}
			fs, check, _, err := CheckConsistencyRevision(context.Background(), chat, segments, 2, manuscript.ContextBundle{}, &request)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
			var in struct {
				Request manuscript.AuthorRewrite `json:"authorRequest"`
			}
			if err := json.Unmarshal(chat.inputs[0].Material, &in); err != nil || in.Request.Instruction != request.Instruction || in.Request.Original != request.Original {
				t.Fatal("lost original author question", err)
			}
			if tc.valid {
				if check == nil || len(fs) != 1 || !fs[0].RequiresHuman {
					t.Fatal("unresolved request did not block approval", fs, check)
				}
				if _, err := review.Aggregate(fs, segments, 2); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
func TestAuthorRewriteRejectsNoChange(t *testing.T) {
	s := manuscript.Segment{ID: "s", Text: "他🙂开门。"}
	req := manuscript.AuthorRewrite{SegmentID: s.ID, Original: s.Text, Start: 2, End: 4, Instruction: "改成敲门"}
	for _, text := range []string{"开门", "   "} {
		raw, _ := json.Marshal(map[string]string{"text": text})
		_, _, err := RewriteAuthor(context.Background(), model.NewFake([]model.Step{{Role: "planned_writer", Content: string(raw)}}), []manuscript.Segment{s}, manuscript.ContextBundle{}, req)
		if err == nil {
			t.Fatal("unchanged/empty replacement accepted")
		}
	}
}
func TestUnchangedTargetCannotPassAuthorCheck(t *testing.T) {
	s := manuscript.Segment{ID: "s", Text: "原文。", Version: 2}
	req := manuscript.AuthorRewrite{SegmentID: "s", Original: s.Text, Instruction: "修正错误"}
	_, _, _, err := CheckConsistencyRevision(context.Background(), model.NewFake([]model.Step{{Role: "hard_consistency", Content: `{"findings":[],"authorCheck":{"status":"addressed","reason":"已改","quote":"原文"}}`}}), []manuscript.Segment{s}, 2, manuscript.ContextBundle{}, &req)
	if err == nil {
		t.Fatal("unchanged target passed")
	}
}
