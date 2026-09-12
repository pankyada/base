package ws

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gorilla/websocket"

	"harness-tui/internal/protocol"
)

func TestLoadTranscriptUsesScopedReadAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sessions/sess%2Fhistory/messages" && r.URL.Path != "/sessions/sess/history/messages" {
			t.Fatalf("path=%q", r.URL.Path)
		}
		if r.URL.Query().Get("user") != "tester" || r.URL.Query().Get("profile") != "research" {
			t.Fatalf("scope query=%s", r.URL.RawQuery)
		}
		w.Header().Set("content-type", "application/json")
		fmt.Fprint(w, `{"messages":[{"role":"user","content":"old question"},{"role":"assistant","content":[{"type":"output_text","text":"CA08 persisted marker"}]},{"role":"tool","content":{"type":"tool_call","arguments":"secret"}}]}`)
	}))
	defer server.Close()
	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	c := New(parsed.Port(), "tester", "research")
	msg, ok := c.LoadTranscript("sess/history", "tester", "research")().(TranscriptLoadedMsg)
	if !ok {
		t.Fatal("expected TranscriptLoadedMsg")
	}
	if msg.Err != nil {
		t.Fatalf("load failed: %v", msg.Err)
	}
	if len(msg.Turns) != 2 || msg.Turns[1].Role != "agent" || msg.Turns[1].Text != "CA08 persisted marker" {
		t.Fatalf("turns=%#v", msg.Turns)
	}
}

func TestLoadTranscriptReportsHTTPFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"unknown session"}`, http.StatusNotFound)
	}))
	defer server.Close()
	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	c := New(parsed.Port(), "tester", "research")
	msg, ok := c.LoadTranscript("missing", "tester", "research")().(TranscriptLoadedMsg)
	if !ok || msg.Err == nil || !strings.Contains(msg.Err.Error(), "404") {
		t.Fatalf("message=%#v", msg)
	}
}

// TestSendNoConnection covers the case Send must never paper over: a caller
// tries to write before (or after) the transport has a live socket.
func TestSendNoConnection(t *testing.T) {
	c := &Client{}
	if err := c.Send(protocol.Cancel()); err == nil {
		t.Fatal("expected an error when sending with no connection")
	}
}

// TestSendWriteFailure covers a frame refused by an already-open transport:
// Send must propagate the underlying write error rather than swallow it.
func TestSendWriteFailure(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		// Keep the handler alive until the client disconnects so the
		// accepted socket isn't torn down out from under the test.
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	c := &Client{conn: conn}
	// Close the socket out from under the client so the next write fails,
	// the same way a refused/broken transport would.
	if err := conn.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	if err := c.Send(protocol.Cancel()); err == nil {
		t.Fatal("expected an error when the underlying write fails")
	}
}
