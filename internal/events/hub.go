// Package events 只负责唤醒连接；可靠历史在 PostgreSQL，内存通知可以重复。
package events

import "sync"

type Subscription struct {
	Wake chan struct{}
	Done chan struct{}
}
type Hub struct {
	mu            sync.Mutex
	capacity      int
	subscriptions map[string]map[*Subscription]struct{}
}

func NewHub(capacity int) *Hub {
	if capacity < 1 {
		capacity = 1
	}
	return &Hub{capacity: capacity, subscriptions: map[string]map[*Subscription]struct{}{}}
}
func (h *Hub) Subscribe(id string) (*Subscription, func()) {
	sub := &Subscription{Wake: make(chan struct{}, h.capacity), Done: make(chan struct{})}
	h.mu.Lock()
	if h.subscriptions[id] == nil {
		h.subscriptions[id] = map[*Subscription]struct{}{}
	}
	h.subscriptions[id][sub] = struct{}{}
	h.mu.Unlock()
	return sub, func() { h.mu.Lock(); defer h.mu.Unlock(); h.remove(id, sub) }
}
func (h *Hub) remove(id string, sub *Subscription) {
	if _, ok := h.subscriptions[id][sub]; !ok {
		return
	}
	delete(h.subscriptions[id], sub)
	close(sub.Done)
	if len(h.subscriptions[id]) == 0 {
		delete(h.subscriptions, id)
	}
}
func (h *Hub) Publish(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.subscriptions[id] {
		select {
		case sub.Wake <- struct{}{}:
		default:
			h.remove(id, sub) // 有界缓冲溢出：断开，由 Last-Event-ID 补齐。
		}
	}
}
