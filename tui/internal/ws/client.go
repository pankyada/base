// Package ws manages the WebSocket lifecycle and forwards frames as tea.Msgs.
package ws

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/gorilla/websocket"

	"harness-tui/internal/protocol"
)

// ServerMsg wraps one decoded inbound frame for the Bubble Tea loop.
type ServerMsg struct{ Msg protocol.ServerMessage }

// ConnectedMsg / DisconnectedMsg signal transport state changes.
type ConnectedMsg struct{}
type DisconnectedMsg struct{}

// MalformedMsg reports a frame that could not be decoded. The client keeps
// reading after it so one bad frame cannot kill the session.
type MalformedMsg struct{ Err error }

// TranscriptTurn is the read-only projection returned by the scoped session
// messages API. It deliberately carries only renderable conversation text.
type TranscriptTurn struct {
	Role string
	Text string
}

// TranscriptLoadedMsg delivers a session history hydration result to the UI.
type TranscriptLoadedMsg struct {
	SessionID string
	UserID    string
	Profile   string
	Revision  uint64
	Turns     []TranscriptTurn
	Err       error
}

// Client owns a single reconnecting connection.
type Client struct {
	port       string
	userID     string
	profile    string
	workingDir string
	send       func(tea.Msg) // program.Send, set via Start

	mu   sync.Mutex
	conn *websocket.Conn
	stop chan struct{}
	done chan struct{}
	once sync.Once
}

func New(port, userID string, profile ...string) *Client {
	selected := ""
	if len(profile) > 0 {
		selected = profile[0]
	}
	workingDir, _ := os.Getwd()
	return NewAtWorkingDir(port, userID, selected, workingDir)
}

// NewAtWorkingDir keeps the launch directory fixed across every reconnect.
func NewAtWorkingDir(port, userID, profile, workingDir string) *Client {
	return &Client{port: port, userID: userID, profile: profile, workingDir: workingDir, stop: make(chan struct{}), done: make(chan struct{})}
}

// Start begins the connect/read loop. send is program.Send.
func (c *Client) Start(send func(tea.Msg)) {
	c.send = send
	go c.loop()
}

func (c *Client) loop() {
	defer close(c.done)
	u := url.URL{Scheme: "ws", Host: "localhost:" + c.port, Path: "/"}
	for {
		if c.stopped() {
			return
		}
		conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
		if err != nil {
			if !sleepOrStop(c.stop, time.Second) {
				return
			}
			continue
		}
		c.mu.Lock()
		c.conn = conn
		_ = conn.WriteJSON(protocol.HelloWithWorkingDir(c.userID, c.profile, c.workingDir))
		c.mu.Unlock()
		if c.stopped() {
			_ = conn.Close()
			return
		}

		c.send(ConnectedMsg{})

		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				break
			}
			msg, derr := protocol.DecodeServer(data)
			if derr != nil {
				c.send(MalformedMsg{Err: fmt.Errorf("decode server frame: %w", derr)})
				continue
			}
			c.send(ServerMsg{Msg: msg})
		}

		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()
		conn.Close()
		c.send(DisconnectedMsg{})
		if !sleepOrStop(c.stop, time.Second) {
			return
		}
	}
}

func (c *Client) stopped() bool {
	select {
	case <-c.stop:
		return true
	default:
		return false
	}
}

func sleepOrStop(stop <-chan struct{}, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-stop:
		return false
	}
}

// SetProfile records the operator's current profile so the next reconnect's
// hello carries it instead of replaying the profile the process launched
// with. A cross-profile resume (PT-033) can move the connection to a
// different profile than hello originally requested; without this, a
// transport drop after that switch would reconnect under the stale one.
func (c *Client) SetProfile(profile string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.profile = profile
}

// Send writes a client frame if connected. It reports failure instead of
// dropping the frame silently, so the caller can put the operator's input
// back rather than let it look sent.
func (c *Client) Send(m protocol.ClientMessage) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return errNotConnected
	}
	return c.conn.WriteJSON(m)
}

// LoadTranscript hydrates a resumed session through the existing scoped REST
// read contract. WS resume acknowledges attachment; REST supplies history.
func (c *Client) LoadTranscript(sessionID, userID, profile string) tea.Cmd {
	port := c.port
	return func() tea.Msg {
		endpoint := "http://localhost:" + port + "/sessions/" + url.PathEscape(sessionID) + "/messages?user=" + url.QueryEscape(userID) + "&profile=" + url.QueryEscape(profile)
		client := http.Client{Timeout: 5 * time.Second}
		resp, err := client.Get(endpoint)
		if err != nil {
			return TranscriptLoadedMsg{SessionID: sessionID, UserID: userID, Profile: profile, Err: fmt.Errorf("load session history: %w", err)}
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
			return TranscriptLoadedMsg{SessionID: sessionID, UserID: userID, Profile: profile, Err: fmt.Errorf("load session history: HTTP %s: %s", resp.Status, string(body))}
		}
		var payload struct {
			Messages []struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			return TranscriptLoadedMsg{SessionID: sessionID, UserID: userID, Profile: profile, Err: fmt.Errorf("load session history: decode: %w", err)}
		}
		turns := make([]TranscriptTurn, 0, len(payload.Messages))
		for _, message := range payload.Messages {
			text, ok := messageText(message.Content)
			if !ok || text == "" {
				continue
			}
			role := message.Role
			switch role {
			case "assistant":
				role = "agent"
			case "tool", "system":
				role = "local"
			case "user":
				// Render directly.
			default:
				role = "local"
			}
			turns = append(turns, TranscriptTurn{Role: role, Text: text})
		}
		return TranscriptLoadedMsg{SessionID: sessionID, UserID: userID, Profile: profile, Turns: turns}
	}
}

func messageText(raw json.RawMessage) (string, bool) {
	var text string
	if len(raw) != 0 && json.Unmarshal(raw, &text) == nil {
		return text, true
	}
	if len(raw) == 0 || string(raw) == "null" {
		return "", false
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) == nil {
		var parts []string
		for _, block := range blocks {
			if block.Text != "" {
				parts = append(parts, block.Text)
			}
		}
		return strings.Join(parts, "\n"), len(parts) > 0
	}
	var block struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &block) == nil && block.Text != "" {
		return block.Text, true
	}
	// Tool-call argument objects and unknown content blocks are not prose;
	// avoid dumping raw JSON into the conversation transcript.
	return "", false
}

var errNotConnected = errors.New("not connected")

// Close stops reconnect attempts and closes the active socket.
func (c *Client) Close() {
	c.once.Do(func() {
		close(c.stop)
		c.mu.Lock()
		if c.conn != nil {
			_ = c.conn.Close()
		}
		c.mu.Unlock()
	})
	select {
	case <-c.done:
	case <-time.After(2 * time.Second):
	}
}
