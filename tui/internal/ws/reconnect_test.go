package ws

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/gorilla/websocket"

	"harness-tui/internal/protocol"
)

// TestClientReconnects drives the real connect/read loop (Start, not a
// hand-built Client) against a server that accepts once, drops the socket
// immediately, then accepts again — the shape of a restart or a blip. It
// asserts the loop actually reconnects (a second ConnectedMsg arrives) and
// that Send works again afterward, rather than getting stuck treating the
// first drop as terminal.
func TestClientReconnects(t *testing.T) {
	upgrader := websocket.Upgrader{}
	var connCount int
	accepted := make(chan *websocket.Conn, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		connCount++
		if connCount == 1 {
			// Simulate a dropped/restarted server: accept, then hang up
			// immediately so the client's read loop breaks and reconnects.
			conn.Close()
			return
		}
		accepted <- conn
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	port := strings.TrimPrefix(server.URL[strings.LastIndex(server.URL, ":"):], ":")

	c := New(port, "tester")
	defer c.Close()

	msgs := make(chan tea.Msg, 32)
	c.Start(func(m tea.Msg) { msgs <- m })

	var connectedCount, disconnectedCount int
	deadline := time.After(5 * time.Second)
	for connectedCount < 2 {
		select {
		case m := <-msgs:
			switch m.(type) {
			case ConnectedMsg:
				connectedCount++
			case DisconnectedMsg:
				disconnectedCount++
			}
		case <-deadline:
			t.Fatalf("timed out waiting for reconnect: connected=%d disconnected=%d", connectedCount, disconnectedCount)
		}
	}
	if disconnectedCount < 1 {
		t.Fatalf("expected at least one DisconnectedMsg before the reconnect, got %d", disconnectedCount)
	}

	// The loop should have a live socket again — a frame sent now must not
	// be reported as failed just because an earlier socket died.
	var sendConn *websocket.Conn
	select {
	case sendConn = <-accepted:
	case <-time.After(2 * time.Second):
		t.Fatal("server never observed the reconnected socket")
	}
	_ = sendConn
	if err := c.Send(protocol.Cancel()); err != nil {
		t.Fatalf("Send after reconnect: %v", err)
	}
}
