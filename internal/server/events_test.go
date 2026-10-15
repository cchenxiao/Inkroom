package server

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"inkloom/internal/app"
	"inkloom/internal/events"
)

type streamRepo struct {
	app.FinalRepository
	mu      sync.Mutex
	hub     *events.Hub
	history []app.RunEvent
	inject  bool
	expired bool
}

func (s *streamRepo) PendingEvents(context.Context) ([]app.OutboxEntry, error) { return nil, nil }
func (s *streamRepo) DeliverEvent(context.Context, int64) error                { return nil }
func (s *streamRepo) Events(_ context.Context, id string, after int64) (app.EventPage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.expired {
		return app.EventPage{}, app.ErrCursorExpired
	}
	p := app.EventPage{Head: int64(len(s.history))}
	for _, e := range s.history {
		if e.Sequence > after {
			p.Events = append(p.Events, e)
		}
	}
	// 模拟读完历史快照之后、第一次发送之前提交新事件。
	if s.inject {
		s.inject = false
		n := int64(len(s.history) + 1)
		s.history = append(s.history, app.RunEvent{RunID: id, Sequence: n, Type: "node.started"})
		s.hub.Publish(id)
	}
	return p, nil
}
func TestSSEReplayLiveBoundaryAndExpiry(t *testing.T) {
	hub := events.NewHub(4)
	repo := &streamRepo{hub: hub, inject: true, history: []app.RunEvent{{RunID: "r", Sequence: 1, Type: "run.started"}, {RunID: "r", Sequence: 2, Type: "node.started"}}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &service{root: ctx, repo: repo, hub: hub}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /runs/{id}/events", s.events)
	server := httptest.NewServer(mux)
	defer server.Close()
	client := &http.Client{Timeout: 3 * time.Second}
	req, _ := http.NewRequest("GET", server.URL+"/runs/r/events", nil)
	req.Header.Set("Last-Event-ID", "r:1")
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	scanner := bufio.NewScanner(res.Body)
	var ids []string
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "id: ") {
			ids = append(ids, strings.TrimPrefix(line, "id: "))
			if len(ids) == 2 {
				break
			}
		}
	}
	res.Body.Close()
	if len(ids) != 2 || ids[0] != "r:2" || ids[1] != "r:3" {
		t.Fatalf("gap at history/live boundary: %v %v", ids, scanner.Err())
	}
	req.Header.Set("Last-Event-ID", "other:2")
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatal("cross-run cursor accepted")
	}
	repo.mu.Lock()
	repo.expired = true
	repo.mu.Unlock()
	req.Header.Set("Last-Event-ID", "r:1")
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 410 {
		t.Fatal("expired cursor must request snapshot")
	}
}
