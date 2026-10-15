package app

import (
	"context"
	"errors"
	"fmt"
	"time"
)

var ErrCursorExpired = errors.New("event cursor expired")
var ErrInvalidCursor = errors.New("invalid event cursor")

// Sequence 只在本 run 内递增，并与业务数据一起提交；ID 不能跨 run 使用。
// 当前单段阶段携带完整快照。消费者可跳过重复事件，但不能跳过尚未应用的事件。
type RunEvent struct {
	RunID     string    `json:"runId"`
	Sequence  int64     `json:"sequence"`
	Type      string    `json:"type"`
	CreatedAt time.Time `json:"createdAt"`
	Run       Run       `json:"run"`
}

func (e RunEvent) ID() string { return fmt.Sprintf("%s:%d", e.RunID, e.Sequence) }

type EventPage struct {
	Events []RunEvent
	Head   int64
}
type OutboxEntry struct {
	ID    int64
	RunID string
}
type EventRepository interface {
	// Events 校验保留边界，并在同一数据库快照中读取一页历史。
	Events(context.Context, string, int64) (EventPage, error)
	PendingEvents(context.Context) ([]OutboxEntry, error)
	DeliverEvent(context.Context, int64) error
}
type LiveRepository interface {
	HumanRepository
	EventRepository
}
