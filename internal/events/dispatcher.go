package events

import (
	"context"
	"log/slog"
	"time"

	"inkloom/internal/app"
)

// Dispatch 只在业务事务提交后读 outbox。先唤醒再删除任务，崩溃可能重复，不能丢失。
// 不使用自增 ID 高水位：较小 ID 的事务可能较晚提交。
func Dispatch(ctx context.Context, repo app.EventRepository, hub *Hub) {
	timer := time.NewTicker(200 * time.Millisecond)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		batch, err := repo.PendingEvents(ctx)
		if err != nil {
			if ctx.Err() == nil {
				slog.Warn("event dispatcher could not read outbox")
			}
			continue
		}
		for _, entry := range batch {
			if ctx.Err() != nil {
				return
			}
			hub.Publish(entry.RunID)
			if err = repo.DeliverEvent(ctx, entry.ID); err != nil {
				break
			}
		}
	}
}
