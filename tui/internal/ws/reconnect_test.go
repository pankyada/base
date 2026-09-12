package ws

import (
	"encoding/json"
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

func TestClientSendsCapturedWorkingDirOnEveryReconnect(t *testing.T) {
	upgrader := websocket.Upgrader{}
	var connCount int
	hellos := make(chan map[string]any, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		connCount++
		_, raw, err := conn.ReadMessage()
		if err == nil {
			var hello map[string]any
			if json.Unmarshal(raw, &hello) == nil {
				hellos <- hello
			}
		}
		_ = conn.Close()
	}))
	defer server.Close()
	port := strings.TrimPrefix(server.URL[strings.LastIndex(server.URL, ":"):], ":")
	c := NewAtWorkingDir(port, "tester", "coding", "/launch/project")
	defer c.Close()
	c.Start(func(tea.Msg) {})
	for index := 0; index < 2; index++ {
		select {
		case hello := <-hellos:
			if hello["working_dir"] != "/launch/project" {
				t.Fatalf("hello %d working_dir = %v", index+1, hello["working_dir"])
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("timed out waiting for hello %d", index+1)
		}
	}
}

func TestReconnectDeliversRecoveredRuntimePrompt(t *testing.T) {
	upgrader := websocket.Upgrader{}
	var connections int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		connections++
		if connections == 1 {
			_ = conn.Close()
			return
		}
		defer conn.Close()
		_, _, _ = conn.ReadMessage() // hello
		_ = conn.WriteJSON(map[string]any{"type": "session_resumed", "sessionId": "s1", "profile": "fixture"})
		_ = conn.WriteJSON(map[string]any{"type": "runtime", "snapshot": map[string]any{"session_id": "s1", "actionable": []any{map[string]any{"id": "call-1", "name": "Bash", "input": map[string]any{"command": "pwd"}}}}})
		<-time.After(100 * time.Millisecond)
	}))
	defer server.Close()
	port := strings.TrimPrefix(server.URL[strings.LastIndex(server.URL, ":"):], ":")
	c := New(port, "tester")
	defer c.Close()
	msgs := make(chan tea.Msg, 32)
	c.Start(func(m tea.Msg) { msgs <- m })
	deadline := time.After(5 * time.Second)
	for {
		select {
		case raw := <-msgs:
			serverMsg, ok := raw.(ServerMsg)
			if !ok || serverMsg.Msg.Type != "runtime" {
				continue
			}
			if serverMsg.Msg.Runtime == nil || len(serverMsg.Msg.Runtime.Actionable) != 1 || serverMsg.Msg.Runtime.Actionable[0].ID != "call-1" {
				t.Fatalf("runtime=%#v", serverMsg.Msg.Runtime)
			}
			return
		case <-deadline:
			t.Fatal("timed out waiting for recovered runtime prompt")
		}
	}
}
