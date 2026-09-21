package acceptance

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestSmokeBasicSend(t *testing.T) {
	if os.Getenv("HARNESS_TUI_PTY") != "1" {
		t.Skip("set HARNESS_TUI_PTY=1")
	}
	binPath := buildTUIBinary(t)
	f := startFixture(t)
	defer f.stop()
	proxy := newSeveringProxy(t, fmt.Sprintf("127.0.0.1:%d", f.harnessPort))
	defer proxy.close()
	tui := launchTUI(t, f, binPath, proxy.port(), "smoke-user")
	defer tui.close()
	waitForOn(t, tui, f, 20*time.Second, "online", func() bool { return strings.Contains(tui.screen(), "● online") })
	time.Sleep(1 * time.Second)
	tui.send("hello there\r")
	waitForOn(t, tui, f, 20*time.Second, "fixture complete", func() bool { return strings.Contains(tui.screen(), "fixture complete") })
}

func TestSmokeReconnectThenSend(t *testing.T) {
	if os.Getenv("HARNESS_TUI_PTY") != "1" {
		t.Skip("set HARNESS_TUI_PTY=1")
	}
	binPath := buildTUIBinary(t)
	f := startFixture(t)
	defer f.stop()
	proxy := newSeveringProxy(t, fmt.Sprintf("127.0.0.1:%d", f.harnessPort))
	defer proxy.close()
	tui := launchTUI(t, f, binPath, proxy.port(), "smoke-user2")
	defer tui.close()
	waitForOn(t, tui, f, 20*time.Second, "online", func() bool { return strings.Contains(tui.screen(), "● online") })
	waitForOn(t, tui, f, 20*time.Second, "session attached (profile fixture-p)", func() bool {
		return strings.Contains(tui.screen(), "fixture-p")
	})

	proxy.sever()
	waitForOn(t, tui, f, 10*time.Second, "offline", func() bool {
		return strings.Contains(tui.screen(), "● offline") || strings.Contains(tui.screen(), "disconnected")
	})
	waitForOn(t, tui, f, 20*time.Second, "online again", func() bool { return strings.Contains(tui.screen(), "● online") })
	time.Sleep(500 * time.Millisecond)
	tui.send("post reconnect hello\r")
	waitForOn(t, tui, f, 20*time.Second, "fixture complete", func() bool { return strings.Contains(tui.screen(), "fixture complete") })
}
