package events

import "testing"

func TestSlowSubscriberCannotBlockOtherClients(t *testing.T) {
	h := NewHub(2)
	slow, stopSlow := h.Subscribe("run")
	defer stopSlow()
	fast, stopFast := h.Subscribe("run")
	defer stopFast()
	for range 3 {
		h.Publish("run")
		<-fast.Wake
	}
	select {
	case <-slow.Done:
	default:
		t.Fatal("overflow did not disconnect slow client")
	}
	select {
	case <-fast.Done:
		t.Fatal("healthy client disconnected")
	default:
	}
	// 重复取消安全，后续发送仍可继续。
	stopSlow()
	h.Publish("run")
	<-fast.Wake
}
