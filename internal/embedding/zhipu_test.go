package embedding

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestZhipuResponseValidation(t *testing.T) {
	vector := "[" + strings.TrimSuffix(strings.Repeat("1,", 256), ",") + "]"
	body := fmt.Sprintf(`{"data":[{"index":1,"embedding":%s},{"index":0,"embedding":%s}]}`, vector, vector)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing authorization")
		}
		fmt.Fprint(w, body)
	}))
	defer server.Close()
	e, err := NewZhipu("test-key", "v1", 256)
	if err != nil {
		t.Fatal(err)
	}
	e.endpoint = server.URL
	if _, err = e.Embed(context.Background(), []string{"铜扣", "旧信"}); err != nil {
		t.Fatal(err)
	}
	body = fmt.Sprintf(`{"data":[{"index":0,"embedding":%s},{"index":0,"embedding":%s}]}`, vector, vector)
	if _, err = e.Embed(context.Background(), []string{"铜扣", "旧信"}); err == nil {
		t.Fatal("duplicate response index accepted")
	}
	body = `{"data":[{"index":0,"embedding":[0,0]}]}`
	if _, err = e.Embed(context.Background(), []string{"铜扣"}); err == nil {
		t.Fatal("invalid vector accepted")
	}
}
