package ui

import (
	"strings"
	"testing"
	"time"
)

func TestNoticeStackExpiresAndCapsToasts(t *testing.T) {
	var stack NoticeStack
	for i := 0; i < 6; i++ {
		stack.Add(NoticeInfo, "notice", "", "")
	}
	if len(stack.Items) != 4 {
		t.Fatalf("notice count = %d, want 4", len(stack.Items))
	}
	stack.Expire(time.Now().Add(7 * time.Second))
	if len(stack.Items) != 0 {
		t.Fatalf("notice count after expiry = %d", len(stack.Items))
	}
}

func TestNoticeStackShowsPersistentDisconnect(t *testing.T) {
	var stack NoticeStack
	stack.SetDisconnected(true)
	view := stripANSI(stack.View(80))
	if !strings.Contains(view, "disconnected") || !strings.Contains(view, "retrying") {
		t.Fatalf("disconnect banner = %q", view)
	}
}
