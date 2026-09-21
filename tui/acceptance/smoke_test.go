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

// TestSmokeReconnectThenSend is the live PT-072 acceptance: Enter inside the
// window between the socket coming back and the reconnect-driven resume
// settling must be refused visibly with the composer intact (a send there
// would land in the throwaway hello session and vanish on session_resumed),
// and the same text must deliver once the prior session is restored.
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

	// Type while offline so the text is already in the composer when the
	// socket returns; then hit Enter the instant the top bar says online.
	proxy.sever()
	waitForOn(t, tui, f, 10*time.Second, "offline", func() bool {
		return strings.Contains(tui.screen(), "● offline") || strings.Contains(tui.screen(), "disconnected")
	})
	tui.send("post reconnect hello")
	waitForOn(t, tui, f, 20*time.Second, "online again", func() bool { return strings.Contains(tui.screen(), "● online") })
	earlyMark := tui.mark()
	tui.send("\r")
	waitForOn(t, tui, f, 20*time.Second, "either a restoring refusal or the resume to settle", func() bool {
		after := tui.since(earlyMark)
		return strings.Contains(after, "session restoring") || strings.Contains(after, "restored")
	})
	if after := tui.since(earlyMark); strings.Contains(after, "session restoring") && strings.Contains(after, "fixture complete") {
		t.Fatalf("message was refused as restoring yet still delivered:\n%s", after)
	}

	// Once the prior session is restored the retained text must deliver.
	waitForOn(t, tui, f, 20*time.Second, "the prior session to be restored", func() bool {
		return strings.Contains(tui.screen(), "restored")
	})
	time.Sleep(300 * time.Millisecond)
	if !strings.Contains(tui.since(earlyMark), "fixture complete") {
		sentMark := tui.mark()
		tui.send("\r")
		waitForOn(t, tui, f, 20*time.Second, "the retained message to deliver after restore", func() bool {
			return strings.Contains(tui.since(sentMark), "fixture complete")
		})
	}
}
