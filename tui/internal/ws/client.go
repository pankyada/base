// Package ws manages the WebSocket lifecycle and forwards frames as tea.Msgs.
package ws

import (
	"errors"
	"fmt"
	"net/url"
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

// Client owns a single reconnecting connection.
type Client struct {
	port    string
	userID  string
	profile string
	send    func(tea.Msg) // program.Send, set via Start

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
	return &Client{port: port, userID: userID, profile: selected, stop: make(chan struct{}), done: make(chan struct{})}
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
		_ = conn.WriteJSON(protocol.Hello(c.userID, c.profile))
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
