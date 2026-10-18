package postgres

import (
	"errors"
	"inkloom/internal/app"
	"strings"
	"testing"
)

func assertGateReason(t *testing.T, err error, want string) {
	t.Helper()
	var detail app.ActionValidationError
	if !errors.As(err, &detail) || !strings.Contains(detail.Reason, want) {
		t.Fatalf("gate lost actionable reason %q: %v", want, err)
	}
}
