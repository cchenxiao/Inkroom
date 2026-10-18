package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/config"
)

func TestChapterFactFailureClassificationNeverLeaksRawErrors(t *testing.T) {
	secret := errors.New("raw provider body token=PRIVATE manuscript=PRIVATE")
	cases := []struct {
		err         error
		stage, code string
	}{
		{&parse.Error{Kind: parse.InvalidSchema, Err: secret}, "schema", "invalid_schema"},
		{&parse.Error{Kind: parse.InvalidJSON, Err: secret}, "parse", "invalid_json"},
		{&parse.Error{Kind: parse.Truncated, Err: secret}, "response", "model_truncated"},
		{fmt.Errorf("wrapped: %w", context.DeadlineExceeded), "model", "timeout"},
		{context.Canceled, "interrupted", "canceled"},
		{model.ErrBudgetExhausted, "budget", "budget_exhausted"},
		{&model.ProviderError{Status: 401}, "model", "provider_access"},
		{&model.ProviderError{Status: 429}, "model", "provider_rate_limit"},
		{secret, "internal", "unclassified"},
	}
	for _, tc := range cases {
		got := ClassifyChapterFactFailure(tc.err)
		raw, _ := json.Marshal(got)
		if got.Stage != tc.stage || got.Code != tc.code || strings.Contains(string(raw), "PRIVATE") {
			t.Fatal(got)
		}
	}
	if ClassifyChapterFactFailure(nil) != nil {
		t.Fatal("success classified as failure")
	}
}

func TestChapterFactCompletedCallIsNotSuccessfulExtraction(t *testing.T) {
	in := ChapterFactsInput{Review: ChapterReviewInput{Parts: []ChapterReviewPart{{Segments: []ChapterReviewSource{{ID: "s1", Text: "陆青交出铜扣。"}}}}}}
	cfg := config.Config{MaxCalls: 3, MaxTokens: 120000, MaxOutputTokens: 4096, CallTimeout: time.Second}
	for _, tc := range []struct {
		body, code string
		repair     bool
	}{
		{`{"candidates":[{"id":"f1","text":"铜扣交接","kind":"event","relatedFactId":"","evidence":{"ref":"s1","quote":"假的引文"},"reason":"核对","suggestedKnowers":[]}]}`, "evidence_mismatch", false},
		{`{"candidates":[{"id":"f1"}]}`, "invalid_schema", false},
		{`bad json`, "invalid_json", true},
	} {
		steps := []model.Step{{Role: "chapter_facts", Content: tc.body}}
		if tc.repair {
			steps = append(steps, model.Step{Role: "chapter_facts", Purpose: model.Repair, Content: tc.body})
		}
		var calls []model.CallRecord
		out, err := extractChapterFactsWithModel(context.Background(), cfg, in, model.NewFake(steps), func(_ context.Context, c model.CallRecord) error {
			if c.Phase == "finished" {
				calls = append(calls, c)
			}
			return nil
		})
		failure := ClassifyChapterFactFailure(err)
		if failure == nil || failure.Code != tc.code || out.Candidates != nil || len(calls) == 0 || !calls[0].Success {
			t.Fatal("call success hid validation failure", out, failure, calls)
		}
	}
	_, err := extractChapterFactsWithModel(context.Background(), cfg, in, model.NewFake(nil), func(context.Context, model.CallRecord) error { return errors.New("PRIVATE storage detail") })
	if failure := ClassifyChapterFactFailure(err); failure == nil || failure.Code != "call_record_failed" {
		t.Fatal(failure)
	}
}

func TestFactReferenceCorrectionPreservesClaimsAndEvidence(t *testing.T) {
	in := ChapterFactsInput{Review: ChapterReviewInput{Parts: []ChapterReviewPart{{Segments: []ChapterReviewSource{{ID: "s1", Text: "陆青交出铜扣。"}}}}}}
	cfg := config.Config{MaxCalls: 3, MaxTokens: 120000, MaxOutputTokens: 4096, CallTimeout: time.Second}
	original := ChapterFactsOutput{Candidates: []ChapterFactCandidate{{ID: "f1", Text: "陆青交出铜扣", Kind: "event", RelatedFactID: "invented", Evidence: ChapterEvidence{Ref: "s1", Quote: "陆青交出铜扣。"}, SuggestedKnowers: []SuggestedKnower{}}}}
	body, _ := json.Marshal(original)
	for _, drop := range []bool{false, true} {
		corrected := ChapterFactsOutput{Candidates: append([]ChapterFactCandidate{}, original.Candidates...)}
		corrected.Candidates[0].RelatedFactID = ""
		if drop {
			corrected.Candidates = []ChapterFactCandidate{}
		}
		fixed, _ := json.Marshal(corrected)
		chat := model.NewFake([]model.Step{{Role: "chapter_facts", Content: string(body)}, {Role: "chapter_facts", Content: string(fixed)}})
		out, err := extractChapterFactsWithModel(context.Background(), cfg, in, chat, nil)
		if drop {
			if err == nil || ClassifyChapterFactFailure(err).Code != "candidate_changed" {
				t.Fatal(out, err)
			}
		} else if err != nil || len(out.Candidates) != 1 || out.Candidates[0].RelatedFactID != "" {
			t.Fatal(out, err)
		}
	}
}
