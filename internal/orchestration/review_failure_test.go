package orchestration

import (
	"context"
	"errors"
	"fmt"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"testing"
)

func TestReviewFailureCodes(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code string
	}{
		{&parse.Error{Kind: parse.Truncated, Err: errors.New("private detail")}, "model_truncated"},
		{context.DeadlineExceeded, "timeout"}, {context.Canceled, "canceled"}, {model.ErrBudgetExhausted, "budget_exhausted"},
		{&parse.Error{Kind: parse.InvalidContent, Err: errors.New("private detail")}, "invalid_content"},
		{errors.New("private detail"), "review_failed"},
	} {
		if got := reviewFailureCode(fmt.Errorf("wrapped: %w", tc.err)); got != tc.code {
			t.Fatal(got, tc.code)
		}
	}
}
