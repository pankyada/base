// Package ws manages the WebSocket lifecycle and forwards frames as tea.Msgs.
package ws

import (
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

// Client owns a single reconnecting connection.
type Client struct {
	port   string
	userID string
	send   func(tea.Msg) // program.Send, set via Start

	mu   sync.Mutex
	conn *websocket.Conn
}

func New(port, userID string) *Client {
	return &Client{port: port, userID: userID}
}

// Start begins the connect/read loop. send is program.Send.
func (c *Client) Start(send func(tea.Msg)) {
	c.send = send
	go c.loop()
}

func (c *Client) loop() {
	u := url.URL{Scheme: "ws", Host: "localhost:" + c.port, Path: "/"}
	for {
		conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
		if err != nil {
			time.Sleep(time.Second)
			continue
		}
		c.mu.Lock()
		c.conn = conn
		_ = conn.WriteJSON(protocol.Hello(c.userID))
		c.mu.Unlock()

		c.send(ConnectedMsg{})

		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				break
			}
			msg, derr := protocol.DecodeServer(data)
			if derr != nil {
				continue // ignore malformed frames
			}
			c.send(ServerMsg{Msg: msg})
		}

		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()
		conn.Close()
		c.send(DisconnectedMsg{})
		time.Sleep(time.Second) // backoff before reconnect
	}
}

// Send writes a client frame if connected; drops it otherwise.
func (c *Client) Send(m protocol.ClientMessage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		_ = c.conn.WriteJSON(m)
	}
}
