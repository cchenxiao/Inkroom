package server

import (
	"inkloom/internal/app"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestActionValidationReasonReachesHTTP(t *testing.T) {
	w := httptest.NewRecorder()
	storageError(w, app.ActionValidationError{Reason: "问题引用已变化或不唯一，请重新选择正文"})
	if w.Code != 409 || !strings.Contains(w.Body.String(), "问题引用已变化或不唯一") {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestFactGateKeepsSpecificReasonAndCode(t *testing.T) {
	w := httptest.NewRecorder()
	storageError(w, app.ActionValidationError{Reason: "事实整理尚未完整完成，不能定稿", Cause: app.ErrFactsUnconfirmed})
	if w.Code != 409 || !strings.Contains(w.Body.String(), "facts_unconfirmed") || !strings.Contains(w.Body.String(), "事实整理尚未完整完成") {
		t.Fatal(w.Code, w.Body.String())
	}
}
