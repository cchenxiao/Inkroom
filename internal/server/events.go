package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"inkloom/internal/app"
)

func eventCursor(id, value string) (int64, error) {
	if value == "" {
		return 0, nil
	}
	prefix := id + ":"
	if !strings.HasPrefix(value, prefix) {
		return 0, app.ErrInvalidCursor
	}
	seq, err := strconv.ParseInt(strings.TrimPrefix(value, prefix), 10, 64)
	if err != nil || seq < 0 {
		return 0, app.ErrInvalidCursor
	}
	return seq, nil
}
func (s *service) events(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	cursor, err := eventCursor(id, r.Header.Get("Last-Event-ID"))
	if err != nil {
		fail(w, 400, "invalid_cursor", "事件游标与本次运行不匹配")
		return
	}
	// 先订阅，再读历史。重叠事件按序号过滤，不留“读完历史→订阅实时”的空窗。
	sub, unsubscribe := s.hub.Subscribe(id)
	defer unsubscribe()
	page, err := s.repo.Events(r.Context(), id, cursor)
	if err != nil {
		switch {
		case errors.Is(err, app.ErrCursorExpired):
			fail(w, 410, "cursor_expired", "事件已过保留期，请重新读取运行快照")
		case errors.Is(err, app.ErrInvalidCursor):
			fail(w, 400, "invalid_cursor", "事件游标超出本次运行范围")
		default:
			storageError(w, err)
		}
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	// 覆盖普通 REST 的总写入超时；每次网络写单独限时，慢连接不能永久挂住。
	write := func(frame string) error {
		if err := rc.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
			return err
		}
		if _, err := fmt.Fprint(w, frame); err != nil {
			return err
		}
		if err := rc.Flush(); err != nil {
			return err
		}
		return rc.SetWriteDeadline(time.Time{})
	}
	if write(": connected\n\n") != nil {
		return
	}
	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()
	for {
		for _, event := range page.Events {
			select {
			case <-r.Context().Done():
				return
			case <-s.root.Done():
				return
			case <-sub.Done:
				return
			default:
			}
			if event.Sequence <= cursor {
				continue
			}
			if event.Sequence != cursor+1 {
				return
			} // 损坏/缺页不能推进游标；重连重新校验。
			raw, err := json.Marshal(event)
			if err != nil || write(fmt.Sprintf("id: %s\nevent: %s\ndata: %s\n\n", event.ID(), event.Type, raw)) != nil {
				return
			}
			cursor = event.Sequence
		}
		if cursor < page.Head {
			page, err = s.repo.Events(r.Context(), id, cursor)
			if err != nil {
				return
			}
			continue
		}
		select {
		case <-r.Context().Done():
			return
		case <-s.root.Done():
			return
		case <-sub.Done:
			return
		case <-sub.Wake:
		case <-heartbeat.C:
			if write(": heartbeat\n\n") != nil {
				return
			}
		}
		// Hub 只作唤醒，按数据库顺序补齐，而非依赖通知的到达顺序。
		// 心跳也检查持久化历史，dispatcher 故障/重启后仍可恢复。
		page, err = s.repo.Events(r.Context(), id, cursor)
		if err != nil {
			return
		} // 若保留期已过，下次请求返回 410。
	}
}
