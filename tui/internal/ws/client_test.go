package ws

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"

	"harness-tui/internal/protocol"
)

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
