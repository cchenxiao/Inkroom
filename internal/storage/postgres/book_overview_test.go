package postgres

import (
	"context"
	"crypto/rand"
	"os"
	"testing"
)

func TestBookOverviewEmpty(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires dedicated test database")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	scope := "empty-" + rand.Text() + "/main"
	out, err := s.BookOverview(ctx, scope)
	if err != nil || len(out.Chapters) != 0 || out.AcceptedWords != 0 || out.NextSection != "premise" || out.Style != nil || len(out.Characters) != 0 {
		t.Fatal("empty overview invented progress", err, out)
	}
	var n int
	if err = s.pool.QueryRow(ctx, "SELECT count(*) FROM planning_heads WHERE scope=$1", scope).Scan(&n); err != nil || n != 0 {
		t.Fatal("reading overview persisted a project", err, n)
	}
}
