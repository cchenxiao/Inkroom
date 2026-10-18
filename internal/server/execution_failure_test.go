package server

import (
	"context"
	"errors"
	"fmt"
	"inkloom/internal/agents/parse"
	"inkloom/internal/app"
	"inkloom/internal/contextlookup"
	"inkloom/internal/orchestration"
	"inkloom/internal/retrieval"
	"strings"
	"testing"
)

func TestExecutionFailureExplainsStageAndValidationWithoutTransportSecrets(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want string
	}{
		{fmt.Errorf("wrapped: %w", &parse.Error{Kind: parse.InvalidContent, Err: errors.New("整章遗漏情节段")}), "整章遗漏情节段"},
		{&parse.Error{Kind: parse.InvalidSchema, Err: errors.New("raw schema data")}, "字段或结构"},
		{context.DeadlineExceeded, "超时"},
		{errors.New("secret upstream token"), "服务执行异常"},
		{&retrieval.Failure{Message: "历史正文索引建立失败，请重试", Cause: errors.New("secret provider response")}, "历史正文索引建立失败"},
		{contextlookup.ErrNoNewSources, "人物知情和前章定稿"},
		{contextlookup.ErrInvalidToolRequest, "重复或无效"},
		{fmt.Errorf("wrapped: %w", app.ActionValidationError{Reason: "一致性查证尚未完成，请重新复检"}), "一致性查证尚未完成"},
	} {
		got := executionFailureReason("draft", tc.err, nil)
		if !strings.Contains(got, "正文生成") || !strings.Contains(got, tc.want) || strings.Contains(got, "secret") || strings.Contains(got, "raw schema") {
			t.Fatal(got)
		}
	}
	if got := executionFailureReason("draft", nil, errors.New("db")); !strings.Contains(got, "未能保存") {
		t.Fatal(got)
	}
}

func TestSaveAndReviewFailuresKeepStageAndOwnedReason(t *testing.T) {
	for _, tc := range []struct{ action, stage string }{{"save_edits", "正文保存"}, {"review_batch", "正文审核"}, {"propose_finding", "修改预览"}} {
		run := app.Run{PendingAction: &orchestration.HumanAction{Type: tc.action}}
		reason := humanFailureReason(run, app.ActionValidationError{Reason: "恢复记录已失效，请建立新候选"})
		if !strings.Contains(reason, tc.stage) || !strings.Contains(reason, "恢复记录已失效") || strings.Contains(reason, "可恢复本次操作") {
			t.Fatal(reason)
		}
	}
	got := executionFailureReason("critics", nil, app.ActionValidationError{Reason: "查证记录与审核结果不一致"})
	if !strings.Contains(got, "查证记录与审核结果不一致") {
		t.Fatal(got)
	}
}

func TestHumanRecheckFailureRetainsValidationAndRecovery(t *testing.T) {
	run := app.Run{PendingAction: &orchestration.HumanAction{Type: "inline_edit"}}
	got := humanFailureReason(run, &parse.Error{Kind: parse.InvalidContent, Err: errors.New("quote does not exist in segment")})
	for _, want := range []string{"正文审核", "quote does not exist", "不会重复应用"} {
		if !strings.Contains(got, want) {
			t.Fatal(got)
		}
	}
	if got := humanFailureReason(run, errors.New("secret transport")); strings.Contains(got, "secret") {
		t.Fatal(got)
	}
}
