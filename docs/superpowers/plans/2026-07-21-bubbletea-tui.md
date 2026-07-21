# Bubble Tea TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Ink/React TUI (`src/tui/`) with a Go + Bubble Tea client that speaks the existing WebSocket JSON protocol, reaching full feature parity before the Ink code is deleted.

**Architecture:** A standalone Go module at `tui/` connects to the unchanged Node server on `ws://localhost:7337`. A WS read-loop goroutine forwards decoded `ServerMessage`s into the Bubble Tea program via `p.Send()`. Rendering uses a single-stream transcript of collapsible sections with a toggleable context rail. The Go binary auto-spawns the Node server (health-probe + spawn + cleanup), mirroring today's `bootstrap.ts`.

**Tech Stack:** Go 1.22+, Bubble Tea, Lipgloss, Bubbles (textinput/list/viewport), gorilla/websocket, teatest for view goldens.

**Spec:** `docs/superpowers/specs/2026-07-21-bubbletea-tui-design.md`

---

## File Structure

```
tui/
  go.mod
  go.sum
  main.go                        # flags, --version, bootstrap, run program
  internal/
    protocol/
      msg.go                     # ClientMessage/ServerMessage + sub-types (json tags)
      msg_test.go
    ws/
      client.go                  # dial + 1s-backoff reconnect; read loop -> tea.Msg
    server/
      boot.go                    # /health probe, spawn, SIGTERM->SIGKILL cleanup
      boot_test.go
    ui/
      theme.go                   # Lipgloss styles ported from src/tui/theme.ts
      spinner.go                 # braille spinner frames + tick msg
      section.go                 # section model: state, collapse/expand
      section_test.go
      transcript.go              # turn grouping + rendering
      transcript_test.go
      composer.go                # Bubbles textinput wrapper
      topbar.go
      statusbar.go
      rail.go                    # active / todos / session / artifacts
      palette.go                 # command palette (Bubbles list + modes)
      palette_test.go
      modals.go                  # tool approval + input request
      artifacts.go               # artifact widget renderers
      artifacts_test.go
      model.go                   # root Model: Init/Update/View, state, routing
      keys.go                    # keybindings
```

Files deleted at the end: all of `src/tui/`.
Files modified at the end: `package.json`, `install.sh`, `scripts/release.mjs`, `CLAUDE.md`, `README.md`.

---

## Task 0: Toolchain + module scaffold

**Files:**
- Create: `tui/go.mod`
- Create: `tui/main.go` (temporary stub, replaced in Task 12)

- [ ] **Step 1: Install Go (if missing)**

Run: `go version`
If it prints `command not found`, install Go 1.22+:
- macOS: `brew install go`
- Linux: download from https://go.dev/dl/ and add `/usr/local/go/bin` to PATH.

Re-run `go version`. Expected: `go version go1.2x.y ...`.

- [ ] **Step 2: Init the module**

Run:
```bash
mkdir -p tui && cd tui && go mod init harness-tui
```
Expected: creates `tui/go.mod` with `module harness-tui` and a `go 1.2x` line.

- [ ] **Step 3: Add dependencies**

Run (from `tui/`):
```bash
go get github.com/charmbracelet/bubbletea@latest
go get github.com/charmbracelet/lipgloss@latest
go get github.com/charmbracelet/bubbles@latest
go get github.com/gorilla/websocket@latest
go get github.com/charmbracelet/x/exp/teatest@latest
```
Expected: `go.mod` lists these modules; `go.sum` is created.

- [ ] **Step 4: Write a stub main so the module compiles**

Create `tui/main.go`:
```go
package main

import "fmt"

func main() {
	fmt.Println("harness-tui: not yet implemented")
}
```

- [ ] **Step 5: Verify it builds**

Run (from `tui/`): `go build ./...`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add tui/go.mod tui/go.sum tui/main.go
git commit -m "chore: scaffold Go module for Bubble Tea TUI"
```

---

## Task 1: Protocol types

Mirror `src/types.ts`. Inbound (`ServerMessage`) uses a single flat "envelope" struct: all fields are optional and JSON-tagged, dispatched on `Type`. This keeps decoding to one `json.Unmarshal` and is trivial to test.

**Files:**
- Create: `tui/internal/protocol/msg.go`
- Test: `tui/internal/protocol/msg_test.go`

- [ ] **Step 1: Write the failing test**

Create `tui/internal/protocol/msg_test.go`:
```go
package protocol

import (
	"encoding/json"
	"testing"
)

func TestDecodeToken(t *testing.T) {
	m, err := DecodeServer([]byte(`{"type":"token","content":"hi"}`))
	if err != nil {
		t.Fatal(err)
	}
	if m.Type != "token" || m.Content != "hi" {
		t.Fatalf("got %+v", m)
	}
}

func TestDecodeToolStart(t *testing.T) {
	m, err := DecodeServer([]byte(`{"type":"tool_start","name":"read","input":{"path":"a.go"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if m.Name != "read" || m.Input["path"] != "a.go" {
		t.Fatalf("got %+v", m)
	}
}

func TestDecodeStats(t *testing.T) {
	m, _ := DecodeServer([]byte(`{"type":"stats","tokens_in":10,"tokens_out":5,"cost_usd":0.01}`))
	if m.TokensIn != 10 || m.TokensOut != 5 {
		t.Fatalf("got %+v", m)
	}
}

func TestDecodeTodos(t *testing.T) {
	m, _ := DecodeServer([]byte(`{"type":"todos","todos":[{"id":"1","content":"x","status":"pending","priority":"high"}]}`))
	if len(m.Todos) != 1 || m.Todos[0].Content != "x" {
		t.Fatalf("got %+v", m)
	}
}

func TestEncodeClientHello(t *testing.T) {
	b, err := json.Marshal(Hello("alice"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"type":"hello","user_id":"alice"}` {
		t.Fatalf("got %s", b)
	}
}

func TestEncodeMessage(t *testing.T) {
	b, _ := json.Marshal(Message("do it"))
	if string(b) != `{"type":"message","content":"do it"}` {
		t.Fatalf("got %s", b)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `tui/`): `go test ./internal/protocol/`
Expected: FAIL — `undefined: DecodeServer`, `undefined: Hello`, etc.

- [ ] **Step 3: Write the implementation**

Create `tui/internal/protocol/msg.go`:
```go
// Package protocol mirrors the WS message shapes defined in src/types.ts.
package protocol

import "encoding/json"

// TodoItem mirrors TodoItem in src/types.ts.
type TodoItem struct {
	ID       string `json:"id"`
	Content  string `json:"content"`
	Status   string `json:"status"`   // pending | in_progress | completed
	Priority string `json:"priority"` // high | medium | low
}

// Project mirrors src/projects/types.ts Project.
type Project struct {
	ID          string `json:"id"`
	User        string `json:"user"`
	Name        string `json:"name"`
	CreatedAt   string `json:"created_at"`
	Description string `json:"description,omitempty"`
}

// Usage mirrors SessionSummary.usage.
type Usage struct {
	Input   int     `json:"input"`
	Output  int     `json:"output"`
	CostUSD float64 `json:"cost_usd"`
}

// SessionSummary mirrors src/session/types.ts SessionSummary.
type SessionSummary struct {
	ID        string `json:"id"`
	Project   string `json:"project"`
	Title     string `json:"title,omitempty"`
	Summary   string `json:"summary,omitempty"`
	CreatedAt string `json:"created_at"`
	Usage     Usage  `json:"usage"`
}

// Artifact mirrors ArtifactWidget in src/types.ts.
type Artifact struct {
	ID    string          `json:"id"`
	Kind  string          `json:"kind"`
	Title string          `json:"title"`
	Icon  string          `json:"icon"`
	Meta  string          `json:"meta,omitempty"`
	Data  json.RawMessage `json:"data,omitempty"`
}

// ServerMessage is a flat envelope over every server->client message.
// Only the fields relevant to msg.Type are populated.
type ServerMessage struct {
	Type string `json:"type"`

	Content string                 `json:"content,omitempty"` // token
	Name    string                 `json:"name,omitempty"`    // tool_start/end/prompt
	Input   map[string]interface{} `json:"input,omitempty"`   // tool_start/prompt
	Result  string                 `json:"result,omitempty"`  // tool_end

	ID      string   `json:"id,omitempty"`      // tool_prompt/input_request
	Prompt  string   `json:"prompt,omitempty"`  // input_request
	Kind    string   `json:"kind,omitempty"`    // input_request: text|select|multi_select
	Options []string `json:"options,omitempty"` // input_request

	SessionID string `json:"sessionId,omitempty"` // session_ready/end/resumed, artifacts
	Profile   string `json:"profile,omitempty"`   // session_ready
	Yolo      bool   `json:"yolo,omitempty"`      // session_ready

	TokensIn      int     `json:"tokens_in,omitempty"`      // stats
	TokensOut     int     `json:"tokens_out,omitempty"`     // stats
	CostUSD       float64 `json:"cost_usd,omitempty"`       // stats
	ContextWindow int     `json:"context_window,omitempty"` // stats

	Message string `json:"message,omitempty"` // error

	Todos     []TodoItem       `json:"todos,omitempty"`     // todos
	Artifacts []Artifact       `json:"artifacts,omitempty"` // artifacts
	Projects  []Project        `json:"projects,omitempty"`  // projects
	Sessions  []SessionSummary `json:"sessions,omitempty"`  // sessions
	Project   *Project         `json:"project,omitempty"`   // project_created
}

// DecodeServer parses one server->client frame.
func DecodeServer(raw []byte) (ServerMessage, error) {
	var m ServerMessage
	err := json.Unmarshal(raw, &m)
	return m, err
}

// ClientMessage is any client->server frame. Constructors below build them.
type ClientMessage map[string]interface{}

func Hello(userID string) ClientMessage {
	return ClientMessage{"type": "hello", "user_id": userID}
}
func Message(content string) ClientMessage {
	return ClientMessage{"type": "message", "content": content}
}
func Cancel() ClientMessage { return ClientMessage{"type": "cancel"} }
func Resume(sessionID string) ClientMessage {
	return ClientMessage{"type": "resume", "sessionId": sessionID}
}
func ToolApprove(id string) ClientMessage {
	return ClientMessage{"type": "tool_approve", "id": id}
}
func ToolDeny(id string) ClientMessage {
	return ClientMessage{"type": "tool_deny", "id": id}
}
func InputResponse(id, value string) ClientMessage {
	return ClientMessage{"type": "input_response", "id": id, "value": value}
}
func ProjectCreate(name string) ClientMessage {
	return ClientMessage{"type": "project_create", "name": name}
}
func ProjectList() ClientMessage { return ClientMessage{"type": "project_list"} }
func ProjectAssign(sessionID, projectID string) ClientMessage {
	return ClientMessage{"type": "project_assign", "sessionId": sessionID, "projectId": projectID}
}
func SessionList(projectID string) ClientMessage {
	m := ClientMessage{"type": "session_list"}
	if projectID != "" {
		m["projectId"] = projectID
	}
	return m
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `tui/`): `go test ./internal/protocol/`
Expected: PASS (`ok  harness-tui/internal/protocol`).

- [ ] **Step 5: Commit**

```bash
git add tui/internal/protocol/
git commit -m "feat(tui): protocol types mirroring src/types.ts"
```

---

## Task 2: Server bootstrap

Mirror `src/tui/bootstrap.ts`: probe `/health`, spawn if down, cleanup on exit.

**Files:**
- Create: `tui/internal/server/boot.go`
- Test: `tui/internal/server/boot_test.go`

- [ ] **Step 1: Write the failing test**

Create `tui/internal/server/boot_test.go`:
```go
package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProbeHealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
		}
	}))
	defer srv.Close()
	port := strings.TrimPrefix(srv.URL, "http://127.0.0.1:")
	if !probeHealth(port) {
		t.Fatal("expected healthy")
	}
}

func TestProbeUnhealthy(t *testing.T) {
	if probeHealth("59999") {
		t.Fatal("expected unhealthy on closed port")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `tui/`): `go test ./internal/server/`
Expected: FAIL — `undefined: probeHealth`.

- [ ] **Step 3: Write the implementation**

Create `tui/internal/server/boot.go`:
```go
// Package server bootstraps the Node harness server, mirroring src/tui/bootstrap.ts.
package server

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// Result reports whether we spawned the server and how to stop it.
type Result struct {
	SpawnedByUs bool
	Cleanup     func()
}

func probeHealth(port string) bool {
	client := http.Client{Timeout: time.Second}
	resp, err := client.Get("http://localhost:" + port + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

// findRepoRoot walks up from dir looking for pnpm-workspace.yaml, else package.json.
func findRepoRoot(dir string) string {
	d := dir
	for {
		if _, err := os.Stat(filepath.Join(d, "pnpm-workspace.yaml")); err == nil {
			return d
		}
		parent := filepath.Dir(d)
		if parent == d {
			break
		}
		d = parent
	}
	d = dir
	for {
		if _, err := os.Stat(filepath.Join(d, "package.json")); err == nil {
			return d
		}
		parent := filepath.Dir(d)
		if parent == d {
			break
		}
		d = parent
	}
	return dir
}

// serverCommand returns dev (tsx) vs prod (harness-server binary) invocation.
func serverCommand() (string, []string, string) {
	exe, _ := os.Executable()
	root := findRepoRoot(filepath.Dir(exe))
	wd, _ := os.Getwd()
	if root == filepath.Dir(exe) {
		root = findRepoRoot(wd)
	}
	devEntry := filepath.Join(root, "src", "server", "index.ts")
	if _, err := os.Stat(devEntry); err == nil {
		return "tsx", []string{devEntry}, root
	}
	return filepath.Join(filepath.Dir(exe), "harness-server"), nil, root
}

// EnsureServer probes /health and spawns the server if it is not already up.
func EnsureServer(port string) (Result, error) {
	if probeHealth(port) {
		return Result{SpawnedByUs: false, Cleanup: func() {}}, nil
	}

	cmdName, args, root := serverCommand()
	cmd := exec.Command(cmdName, args...)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "HARNESS_PORT="+port)
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return Result{}, fmt.Errorf("failed to start %q: %w", cmdName, err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(250 * time.Millisecond)
		if probeHealth(port) {
			cleanup := func() {
				_ = cmd.Process.Signal(syscall.SIGTERM)
				done := make(chan struct{})
				go func() { _ = cmd.Wait(); close(done) }()
				select {
				case <-done:
				case <-time.After(2 * time.Second):
					_ = cmd.Process.Kill()
				}
			}
			return Result{SpawnedByUs: true, Cleanup: cleanup}, nil
		}
	}

	_ = cmd.Process.Kill()
	return Result{}, fmt.Errorf(
		"harness server failed to become healthy within 10s on port %s — "+
			"check that %q is on your PATH and the profile is valid", port, cmdName)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `tui/`): `go test ./internal/server/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tui/internal/server/
git commit -m "feat(tui): server bootstrap (health probe + spawn + cleanup)"
```

---

## Task 3: WS client

Dials the server, sends `hello`, reconnects on drop, and forwards frames as Bubble Tea messages. No unit test (network glue); verified live in Task 12.

**Files:**
- Create: `tui/internal/ws/client.go`

- [ ] **Step 1: Write the implementation**

Create `tui/internal/ws/client.go`:
```go
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
		c.mu.Unlock()

		_ = conn.WriteJSON(protocol.Hello(c.userID))
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
		c.send(DisconnectedMsg{})
		time.Sleep(time.Second) // backoff before reconnect
	}
}

// Send writes a client frame if connected; drops it otherwise.
func (c *Client) Send(m protocol.ClientMessage) {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn != nil {
		_ = conn.WriteJSON(m)
	}
}
```

- [ ] **Step 2: Verify it builds**

Run (from `tui/`): `go build ./...`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add tui/internal/ws/
git commit -m "feat(tui): reconnecting WS client forwarding frames as tea.Msgs"
```

---

## Task 4: Theme

Port `src/tui/theme.ts` `C` palette to Lipgloss styles.

**Files:**
- Create: `tui/internal/ui/theme.go`

- [ ] **Step 1: Write the implementation**

Create `tui/internal/ui/theme.go`:
```go
package ui

import "github.com/charmbracelet/lipgloss"

// Palette mirrors the C object in src/tui/theme.ts.
var (
	ColBg       = lipgloss.Color("#0b0c0e")
	ColBgDeep   = lipgloss.Color("#08090a")
	ColPanel    = lipgloss.Color("#111317")
	ColBorder   = lipgloss.Color("#262b33")
	ColBorderHi = lipgloss.Color("#3a414e")
	ColText     = lipgloss.Color("#e7e9ee")
	ColDim      = lipgloss.Color("#99a0ad")
	ColFaint    = lipgloss.Color("#595f6b")
	ColAccent   = lipgloss.Color("#f1a44d")
	ColOK       = lipgloss.Color("#74c79a")
	ColDel      = lipgloss.Color("#e87f8d")
	ColInfo     = lipgloss.Color("#6cb6d9")
	ColPurple   = lipgloss.Color("#b394e0")
)

// Common reusable styles.
var (
	StText    = lipgloss.NewStyle().Foreground(ColText)
	StDim     = lipgloss.NewStyle().Foreground(ColDim)
	StFaint   = lipgloss.NewStyle().Foreground(ColFaint)
	StAccent  = lipgloss.NewStyle().Foreground(ColAccent)
	StAccentB = lipgloss.NewStyle().Foreground(ColAccent).Bold(true)
	StOK      = lipgloss.NewStyle().Foreground(ColOK)
	StErr     = lipgloss.NewStyle().Foreground(ColDel)
	StInfo    = lipgloss.NewStyle().Foreground(ColInfo)
)
```

- [ ] **Step 2: Verify it builds**

Run (from `tui/`): `go build ./...`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add tui/internal/ui/theme.go
git commit -m "feat(tui): Lipgloss theme ported from theme.ts"
```

---

## Task 5: Spinner

Braille spinner frames + tick message, used for running sections and the busy indicator.

**Files:**
- Create: `tui/internal/ui/spinner.go`

- [ ] **Step 1: Write the implementation**

Create `tui/internal/ui/spinner.go`:
```go
package ui

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

var spinFrames = []string{"⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"}

// tickMsg advances the spinner frame.
type tickMsg struct{}

func spinnerTick() tea.Cmd {
	return tea.Tick(100*time.Millisecond, func(time.Time) tea.Msg { return tickMsg{} })
}

func spinChar(frame int) string {
	return spinFrames[frame%len(spinFrames)]
}
```

- [ ] **Step 2: Verify it builds**

Run (from `tui/`): `go build ./...`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add tui/internal/ui/spinner.go
git commit -m "feat(tui): braille spinner + tick"
```

---

## Task 6: Section model

A section is one activity (tool call, thinking, etc.). It has a lifecycle state and a collapsible body. This is the reusable rendering unit.

**Files:**
- Create: `tui/internal/ui/section.go`
- Test: `tui/internal/ui/section_test.go`

- [ ] **Step 1: Write the failing test**

Create `tui/internal/ui/section_test.go`:
```go
package ui

import "testing"

func TestSectionGlyphStates(t *testing.T) {
	s := Section{Name: "read", State: SectionRunning}
	if glyph := s.glyph(0); glyph == "" {
		t.Fatal("running glyph should be a spinner frame")
	}
	s.State = SectionDone
	if s.glyph(0) != "✓" {
		t.Fatalf("done glyph = %q", s.glyph(0))
	}
	s.State = SectionError
	if s.glyph(0) != "✗" {
		t.Fatalf("error glyph = %q", s.glyph(0))
	}
}

func TestSectionToggle(t *testing.T) {
	s := Section{State: SectionDone, Body: "output"}
	if s.Expanded {
		t.Fatal("default collapsed")
	}
	s.Toggle()
	if !s.Expanded {
		t.Fatal("toggle should expand")
	}
	s.Toggle()
	if s.Expanded {
		t.Fatal("toggle should collapse")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `tui/`): `go test ./internal/ui/`
Expected: FAIL — `undefined: Section`, `SectionRunning`, etc.

- [ ] **Step 3: Write the implementation**

Create `tui/internal/ui/section.go`:
```go
package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// SectionState is the lifecycle of one activity.
type SectionState int

const (
	SectionQueued SectionState = iota
	SectionRunning
	SectionDone
	SectionError
)

// Section is one collapsible activity within an agent turn.
type Section struct {
	Name     string // tool name, e.g. "read"
	Arg      string // one-line arg summary
	Metric   string // e.g. "(142 lines)" or "+6 -2"
	Body     string // rolled-up detail (tool output); shown when Expanded
	State    SectionState
	Expanded bool
}

func (s *Section) Toggle() { s.Expanded = !s.Expanded }

func (s Section) glyph(frame int) string {
	switch s.State {
	case SectionRunning:
		return spinChar(frame)
	case SectionDone:
		return "✓"
	case SectionError:
		return "✗"
	default:
		return "◦"
	}
}

func (s Section) color() lipgloss.Style {
	switch s.State {
	case SectionRunning:
		return StAccent
	case SectionError:
		return StErr
	case SectionDone:
		return StOK
	default:
		return StFaint
	}
}

// Render draws the section at the given content width and spinner frame.
// allExpanded forces the body open (the ^O toggle).
func (s Section) Render(width, frame int, allExpanded bool) string {
	chev := "▸"
	open := (s.Expanded || allExpanded) && s.Body != ""
	if open {
		chev = "▾"
	}
	head := lipgloss.JoinHorizontal(
		lipgloss.Top,
		s.color().Render(" "+s.glyph(frame)+" "),
		StText.Render(pad(s.Name, 8)+" "),
		StDim.Render(truncate(s.Arg, maxInt(0, width-24))),
		"  "+StDim.Render(s.Metric),
		" "+StDim.Render(chev),
	)
	if !open {
		return head
	}
	body := lipgloss.NewStyle().
		Foreground(ColDim).
		BorderStyle(lipgloss.NormalBorder()).
		BorderLeft(true).
		BorderForeground(ColBorder).
		MarginLeft(3).
		PaddingLeft(1).
		Render(s.Body)
	return lipgloss.JoinVertical(lipgloss.Left, head, body)
}

// --- small helpers (shared across ui package) ---

func pad(s string, n int) string {
	if len(s) >= n {
		return s
	}
	return s + strings.Repeat(" ", n-len(s))
}

func truncate(s string, n int) string {
	if n <= 0 || len(s) <= n {
		return s
	}
	if n <= 1 {
		return s[:n]
	}
	return s[:n-1] + "…"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `tui/`): `go test ./internal/ui/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tui/internal/ui/section.go tui/internal/ui/section_test.go
git commit -m "feat(tui): collapsible section model with lifecycle glyphs"
```

---

## Task 7: Transcript (turns)

Groups the flat message list into turns (user vs agent) and renders them. Agent turns contain sections plus streamed text and a footer summary.

**Files:**
- Create: `tui/internal/ui/transcript.go`
- Test: `tui/internal/ui/transcript_test.go`

- [ ] **Step 1: Write the failing test**

Create `tui/internal/ui/transcript_test.go`:
```go
package ui

import (
	"strings"
	"testing"
)

func TestTranscriptRendersUserAndAgent(t *testing.T) {
	tr := Transcript{
		Turns: []Turn{
			{Role: "user", Text: "hello"},
			{Role: "agent", Text: "hi there", Sections: []Section{
				{Name: "read", Arg: "a.go", State: SectionDone},
			}},
		},
	}
	out := stripANSI(tr.Render(80, 0))
	if !strings.Contains(out, "hello") {
		t.Fatal("missing user text")
	}
	if !strings.Contains(out, "hi there") {
		t.Fatal("missing agent text")
	}
	if !strings.Contains(out, "read") {
		t.Fatal("missing section")
	}
}

// stripANSI removes escape sequences so assertions match on plain text.
func stripANSI(s string) string {
	var b strings.Builder
	inEsc := false
	for _, r := range s {
		if r == 0x1b {
			inEsc = true
			continue
		}
		if inEsc {
			if r == 'm' {
				inEsc = false
			}
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `tui/`): `go test ./internal/ui/ -run Transcript`
Expected: FAIL — `undefined: Transcript`, `undefined: Turn`.

- [ ] **Step 3: Write the implementation**

Create `tui/internal/ui/transcript.go`:
```go
package ui

import (
	"fmt"

	"github.com/charmbracelet/lipgloss"
)

// Turn is one user message or one agent response.
type Turn struct {
	Role     string // "user" | "agent"
	Text     string // user content, or streamed agent text
	Time     string
	Sections []Section // agent only
	Tokens   int       // agent only, for the footer
	Elapsed  string    // agent only, for the footer
}

// Transcript renders the full conversation.
type Transcript struct {
	Turns       []Turn
	AllExpanded bool // ^O toggle
}

func (tr Transcript) Render(width, frame int) string {
	var blocks []string
	for _, t := range tr.Turns {
		if t.Role == "user" {
			header := StDim.Render("YOU › " + t.Time)
			body := lipgloss.NewStyle().
				BorderStyle(lipgloss.NormalBorder()).
				BorderLeft(true).
				BorderForeground(ColInfo).
				PaddingLeft(1).
				Render(StText.Render(t.Text))
			blocks = append(blocks, lipgloss.JoinVertical(lipgloss.Left, header, body))
			continue
		}
		// agent
		header := StDim.Render("HARNESS ◆ " + t.Time)
		parts := []string{header}
		for _, s := range t.Sections {
			parts = append(parts, s.Render(width, frame, tr.AllExpanded))
		}
		if t.Text != "" {
			parts = append(parts, StText.Render(t.Text))
		}
		if t.Tokens > 0 || t.Elapsed != "" {
			footer := StFaint.Render(fmt.Sprintf("▌ %d tools · %d tok · %s",
				len(t.Sections), t.Tokens, t.Elapsed))
			parts = append(parts, footer)
		}
		blocks = append(blocks, lipgloss.JoinVertical(lipgloss.Left, parts...))
	}
	return lipgloss.JoinVertical(lipgloss.Left, spread(blocks)...)
}

// spread inserts a blank line between blocks.
func spread(blocks []string) []string {
	if len(blocks) == 0 {
		return blocks
	}
	out := make([]string, 0, len(blocks)*2)
	for i, b := range blocks {
		out = append(out, b)
		if i < len(blocks)-1 {
			out = append(out, "")
		}
	}
	return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `tui/`): `go test ./internal/ui/ -run Transcript`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tui/internal/ui/transcript.go tui/internal/ui/transcript_test.go
git commit -m "feat(tui): transcript rendering with turns + footer summary"
```

---

## Task 8: Composer, TopBar, StatusBar

Three small view components. Composer wraps Bubbles `textinput`.

**Files:**
- Create: `tui/internal/ui/composer.go`
- Create: `tui/internal/ui/topbar.go`
- Create: `tui/internal/ui/statusbar.go`

- [ ] **Step 1: Write the composer**

Create `tui/internal/ui/composer.go`:
```go
package ui

import (
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/lipgloss"
)

// NewComposer builds the message input.
func NewComposer() textinput.Model {
	ti := textinput.New()
	ti.Placeholder = "Message harness…"
	ti.Prompt = ""
	ti.Focus()
	return ti
}

// RenderComposer draws the prompt line above the input.
func RenderComposer(ti textinput.Model, width int, busy bool) string {
	if busy {
		ti.Placeholder = "Thinking…"
	} else {
		ti.Placeholder = "Message harness…"
	}
	line := lipgloss.JoinHorizontal(lipgloss.Top, StAccentB.Render("› "), ti.View())
	return lipgloss.NewStyle().
		BorderStyle(lipgloss.NormalBorder()).
		BorderTop(true).
		BorderForeground(ColBorder).
		PaddingTop(1).
		Width(width).
		Render(line)
}
```

- [ ] **Step 2: Write the topbar**

Create `tui/internal/ui/topbar.go`:
```go
package ui

import (
	"time"

	"github.com/charmbracelet/lipgloss"
)

// RenderTopBar draws the header line.
func RenderTopBar(width int, profile, sessionID, project string, busy bool) string {
	sep := StDim.Render(" │ ")
	dot := StOK.Render("●")
	state := "ready"
	if busy {
		dot = StAccent.Render("●")
		state = "working"
	}
	left := lipgloss.JoinHorizontal(lipgloss.Top,
		StAccentB.Render("◆ harness"), sep,
		StText.Render("profile "+profile), sep,
		StText.Render("session #"+sessionID), sep,
		StInfo.Render(project), sep,
		dot, StText.Render(" "+state),
	)
	right := lipgloss.JoinHorizontal(lipgloss.Top,
		StText.Render(time.Now().Format("15:04:05")),
		lipgloss.NewStyle().Foreground(ColBorderHi).Render("  [^K palette]"),
	)
	gap := maxInt(1, width-lipgloss.Width(left)-lipgloss.Width(right))
	return left + lipgloss.NewStyle().Width(gap).Render("") + right
}
```

- [ ] **Step 3: Write the statusbar**

Create `tui/internal/ui/statusbar.go`:
```go
package ui

import (
	"fmt"

	"github.com/charmbracelet/lipgloss"
)

// RenderStatusBar draws the footer status line.
func RenderStatusBar(width int, busy bool, focusWork bool, tokIn, tokOut int, toolsExpanded bool, theme string) string {
	badgeText := "RDY"
	if busy {
		badgeText = "RUN"
	}
	badge := lipgloss.NewStyle().Background(ColAccent).Foreground(ColBgDeep).Padding(0, 1).Render(badgeText)
	sep := StDim.Render(" │ ")

	convStyle, workStyle := StText, StDim
	if focusWork {
		convStyle, workStyle = StDim, StText
	}
	left := lipgloss.JoinHorizontal(lipgloss.Top,
		badge, sep,
		convStyle.Render("conv"), sep,
		workStyle.Render("work"), sep,
		StText.Render(fmt.Sprintf("%d in / %d out", tokIn, tokOut)),
	)
	toolsState := "off"
	if toolsExpanded {
		toolsState = "on"
	}
	right := lipgloss.JoinHorizontal(lipgloss.Top,
		StDim.Render("^O tools: "+toolsState), sep,
		StText.Render("theme: "+theme),
	)
	gap := maxInt(1, width-lipgloss.Width(left)-lipgloss.Width(right))
	return left + lipgloss.NewStyle().Width(gap).Render("") + right
}
```

- [ ] **Step 4: Verify it builds**

Run (from `tui/`): `go build ./...`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add tui/internal/ui/composer.go tui/internal/ui/topbar.go tui/internal/ui/statusbar.go
git commit -m "feat(tui): composer, topbar, statusbar views"
```

---

## Task 9: Modals (tool approval + input request)

Two overlays. Approval is y/n. Input request is text (textinput) or select/multi_select (index cursor).

**Files:**
- Create: `tui/internal/ui/modals.go`

- [ ] **Step 1: Write the implementation**

Create `tui/internal/ui/modals.go`:
```go
package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Approval holds a pending tool_prompt.
type Approval struct {
	ID    string
	Name  string
	Input string // JSON-ish preview
}

func RenderApproval(a Approval) string {
	box := lipgloss.NewStyle().
		Width(60).BorderStyle(lipgloss.NormalBorder()).BorderForeground(ColAccent).Padding(1)
	content := lipgloss.JoinVertical(lipgloss.Left,
		StAccentB.Render("Tool Approval Required"),
		StText.Render("Run: ")+StInfo.Render(a.Name),
		StDim.Render(truncate(a.Input, 56)),
		"",
		StDim.Render("[y] Allow  [n] Deny"),
	)
	return box.Render(content)
}

// InputRequest holds a pending input_request.
type InputRequest struct {
	ID      string
	Prompt  string
	Kind    string // text | select | multi_select
	Options []string
	Text    string   // buffer for kind=text
	Cursor  int      // highlighted option
	Chosen  map[int]bool // for multi_select
}

func RenderInputRequest(ir InputRequest) string {
	box := lipgloss.NewStyle().
		Width(60).BorderStyle(lipgloss.NormalBorder()).BorderForeground(ColInfo).Padding(1)
	rows := []string{StInfo.Render(ir.Prompt), ""}
	switch ir.Kind {
	case "select", "multi_select":
		for i, opt := range ir.Options {
			mark := "  "
			if ir.Kind == "multi_select" && ir.Chosen[i] {
				mark = StOK.Render("✓ ")
			}
			line := mark + opt
			if i == ir.Cursor {
				line = lipgloss.NewStyle().Background(ColAccent).Foreground(ColBgDeep).Render(" "+strings.TrimLeft(line, " ")+" ")
			} else {
				line = StText.Render(line)
			}
			rows = append(rows, line)
		}
		rows = append(rows, "", StDim.Render("[↑/↓] move  [space] toggle  [enter] submit"))
	default: // text
		rows = append(rows, StText.Render("› "+ir.Text+"▏"))
		rows = append(rows, "", StDim.Render("[enter] submit"))
	}
	return box.Render(lipgloss.JoinVertical(lipgloss.Left, rows...))
}

// Value returns the string to send in input_response.
func (ir InputRequest) Value() string {
	switch ir.Kind {
	case "select":
		if ir.Cursor < len(ir.Options) {
			return ir.Options[ir.Cursor]
		}
		return ""
	case "multi_select":
		var picked []string
		for i, opt := range ir.Options {
			if ir.Chosen[i] {
				picked = append(picked, opt)
			}
		}
		return strings.Join(picked, ",")
	default:
		return ir.Text
	}
}
```

- [ ] **Step 2: Verify it builds**

Run (from `tui/`): `go build ./...`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add tui/internal/ui/modals.go
git commit -m "feat(tui): tool-approval and input-request modals"
```

---

## Task 10: Palette

Command palette with modes: root, project_switch, project_new, history, history_all, assign. Filtering is pure and unit-tested.

**Files:**
- Create: `tui/internal/ui/palette.go`
- Test: `tui/internal/ui/palette_test.go`

- [ ] **Step 1: Write the failing test**

Create `tui/internal/ui/palette_test.go`:
```go
package ui

import (
	"testing"

	"harness-tui/internal/protocol"
)

func TestPaletteRootFilter(t *testing.T) {
	p := NewPalette()
	p.Filter = "coding"
	items := p.items()
	if len(items) == 0 {
		t.Fatal("expected coding match")
	}
	for _, it := range items {
		if it.ID == "coding" {
			return
		}
	}
	t.Fatal("coding item not present")
}

func TestPaletteProjectMode(t *testing.T) {
	p := NewPalette()
	p.Mode = ModeProjectSwitch
	p.Projects = []protocol.Project{{ID: "a", Name: "Alpha"}, {ID: "b", Name: "Beta"}}
	p.Filter = "alph"
	items := p.items()
	if len(items) != 1 || items[0].Title != "Alpha" {
		t.Fatalf("got %+v", items)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `tui/`): `go test ./internal/ui/ -run Palette`
Expected: FAIL — `undefined: NewPalette`, `ModeProjectSwitch`.

- [ ] **Step 3: Write the implementation**

Create `tui/internal/ui/palette.go`:
```go
package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"

	"harness-tui/internal/protocol"
)

type PaletteMode int

const (
	ModeRoot PaletteMode = iota
	ModeProjectSwitch
	ModeProjectNew
	ModeHistory
	ModeHistoryAll
	ModeAssign
)

// PaletteItem is one selectable row.
type PaletteItem struct {
	ID       string
	Title    string
	Group    string
	Subtitle string
}

// Palette holds command-palette state.
type Palette struct {
	Mode     PaletteMode
	Filter   string
	NewProj  string // buffer for ModeProjectNew
	Selected int
	Projects []protocol.Project
	History  []protocol.SessionSummary
}

func NewPalette() *Palette { return &Palette{Mode: ModeRoot} }

var runScenarios = []PaletteItem{
	{ID: "data", Title: "Run Data Analysis", Group: "RUN TASK"},
	{ID: "coding", Title: "Run Coding Task", Group: "RUN TASK"},
	{ID: "writing", Title: "Run Writing Task", Group: "RUN TASK"},
	{ID: "research", Title: "Run Research Task", Group: "RUN TASK"},
}

// rootCommands mirror ROOT_COMMANDS in src/tui/palette-modes.ts.
var rootCommands = []struct {
	ID, Label, Group string
	Mode             PaletteMode
}{
	{"reset", "Clear Session", "SESSION", ModeRoot},
	{"switch", "Switch Project", "PROJECT", ModeProjectSwitch},
	{"new", "New Project", "PROJECT", ModeProjectNew},
	{"history", "Session History", "HISTORY", ModeHistory},
	{"history_all", "All Sessions", "HISTORY", ModeHistoryAll},
	{"assign", "Move Session to Project", "PROJECT", ModeAssign},
}

func (p *Palette) items() []PaletteItem {
	q := strings.ToLower(p.Filter)
	var out []PaletteItem
	switch p.Mode {
	case ModeRoot:
		for _, s := range runScenarios {
			if strings.Contains(strings.ToLower(s.Title), q) {
				out = append(out, s)
			}
		}
		for _, c := range rootCommands {
			if strings.Contains(strings.ToLower(c.Label), q) {
				out = append(out, PaletteItem{ID: c.ID, Title: c.Label, Group: c.Group})
			}
		}
	case ModeProjectSwitch, ModeAssign:
		for _, pr := range p.Projects {
			if strings.Contains(strings.ToLower(pr.Name), q) {
				out = append(out, PaletteItem{ID: pr.ID, Title: pr.Name, Group: "PROJECT"})
			}
		}
	case ModeHistory, ModeHistoryAll:
		for _, h := range p.History {
			title := h.Title
			if title == "" {
				title = h.ID
			}
			if strings.Contains(strings.ToLower(title), q) {
				out = append(out, PaletteItem{ID: h.ID, Title: title, Group: "HISTORY", Subtitle: h.Summary})
			}
		}
	}
	return out
}

// modeForRootID returns the target mode when a root command is chosen (ok=false for leaf actions).
func modeForRootID(id string) (PaletteMode, bool) {
	for _, c := range rootCommands {
		if c.ID == id && id != "reset" {
			return c.Mode, true
		}
	}
	return ModeRoot, false
}

var modeLabels = map[PaletteMode]string{
	ModeRoot:          "Search commands…",
	ModeProjectSwitch: "Switch to project…",
	ModeProjectNew:    "New project name…",
	ModeHistory:       "Browse session history…",
	ModeHistoryAll:    "Browse all sessions…",
	ModeAssign:        "Move session to project…",
}

func (p *Palette) Render(width int) string {
	box := lipgloss.NewStyle().Width(60).
		BorderStyle(lipgloss.NormalBorder()).BorderForeground(ColBorder).Background(ColPanel)

	var rows []string
	if p.Mode == ModeProjectNew {
		rows = append(rows, StText.Render("› "+p.NewProj+"▏"))
		return box.Render(lipgloss.JoinVertical(lipgloss.Left, rows...))
	}
	rows = append(rows, StDim.Render(modeLabels[p.Mode]+" "+p.Filter+"▏"), "")
	items := p.items()
	if len(items) == 0 {
		rows = append(rows, StDim.Render("No results"))
	}
	for i, it := range items {
		group := pad(it.Group, 15)
		line := StDim.Render(group) + StText.Render(it.Title)
		if i == p.Selected {
			line = lipgloss.NewStyle().Background(ColAccent).Foreground(ColBgDeep).
				Render(pad(group+it.Title, 56))
		}
		rows = append(rows, line)
		if it.Subtitle != "" && i == p.Selected {
			rows = append(rows, StDim.Render("  "+truncate(it.Subtitle, 54)))
		}
	}
	if p.Mode != ModeRoot {
		rows = append(rows, "", StDim.Render("[Esc] back to root"))
	}
	return box.Render(lipgloss.JoinVertical(lipgloss.Left, rows...))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `tui/`): `go test ./internal/ui/ -run Palette`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tui/internal/ui/palette.go tui/internal/ui/palette_test.go
git commit -m "feat(tui): command palette with modes + filtering"
```

---

## Task 11: Artifacts + rail

Artifact renderers (real for metrics/table/diff/terminal, fallback for the rest) and the context rail.

**Files:**
- Create: `tui/internal/ui/artifacts.go`
- Create: `tui/internal/ui/rail.go`
- Test: `tui/internal/ui/artifacts_test.go`

- [ ] **Step 1: Write the failing test**

Create `tui/internal/ui/artifacts_test.go`:
```go
package ui

import (
	"strings"
	"testing"

	"harness-tui/internal/protocol"
)

func TestRenderArtifactTerminal(t *testing.T) {
	a := protocol.Artifact{Kind: "terminal", Title: "build", Data: []byte(`"npm run build\nok"`)}
	out := stripANSI(RenderArtifact(a, 40))
	if !strings.Contains(out, "npm run build") {
		t.Fatalf("got %q", out)
	}
}

func TestRenderArtifactFallback(t *testing.T) {
	a := protocol.Artifact{Kind: "line", Title: "trend"}
	out := stripANSI(RenderArtifact(a, 40))
	if !strings.Contains(out, "trend") || !strings.Contains(out, "line") {
		t.Fatalf("fallback should name title+kind, got %q", out)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `tui/`): `go test ./internal/ui/ -run Artifact`
Expected: FAIL — `undefined: RenderArtifact`.

- [ ] **Step 3: Write the artifacts implementation**

Create `tui/internal/ui/artifacts.go`:
```go
package ui

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"harness-tui/internal/protocol"
)

// RenderArtifact renders one artifact widget within the given width.
func RenderArtifact(a protocol.Artifact, width int) string {
	header := StDim.Copy().Bold(true).Render(fmt.Sprintf("%s %s", a.Icon, a.Title))
	if a.Meta != "" {
		header += StDim.Render(" · " + a.Meta)
	}
	var body string
	switch a.Kind {
	case "terminal":
		var s string
		_ = json.Unmarshal(a.Data, &s)
		body = lipgloss.NewStyle().Foreground(ColDim).Background(ColBgDeep).Render(s)
	case "metrics":
		var rows []map[string]interface{}
		_ = json.Unmarshal(a.Data, &rows)
		var lines []string
		for _, r := range rows {
			lines = append(lines, fmt.Sprintf("%v: %v", r["label"], r["value"]))
		}
		body = StText.Render(strings.Join(lines, "\n"))
	case "table":
		var rows [][]string
		_ = json.Unmarshal(a.Data, &rows)
		var lines []string
		for _, r := range rows {
			lines = append(lines, strings.Join(r, "  "))
		}
		body = StText.Render(strings.Join(lines, "\n"))
	case "diff":
		var s string
		_ = json.Unmarshal(a.Data, &s)
		var lines []string
		for _, ln := range strings.Split(s, "\n") {
			switch {
			case strings.HasPrefix(ln, "+"):
				lines = append(lines, StOK.Render(ln))
			case strings.HasPrefix(ln, "-"):
				lines = append(lines, StErr.Render(ln))
			default:
				lines = append(lines, StDim.Render(ln))
			}
		}
		body = strings.Join(lines, "\n")
	default:
		body = StFaint.Render(fmt.Sprintf("[%s widget]", a.Kind))
	}
	return lipgloss.JoinVertical(lipgloss.Left, header, body)
}
```

- [ ] **Step 4: Write the rail implementation**

Create `tui/internal/ui/rail.go`:
```go
package ui

import (
	"fmt"

	"github.com/charmbracelet/lipgloss"

	"harness-tui/internal/protocol"
)

// RailData is everything the context rail shows.
type RailData struct {
	ActiveTool string
	Todos      []protocol.TodoItem
	Profile    string
	SessionID  string
	Project    string
	TokIn      int
	TokOut     int
	Cost       float64
	Artifacts  []protocol.Artifact
}

const railWidth = 34

func RenderRail(d RailData, height int) string {
	sect := func(title string) string { return StDim.Copy().Bold(true).Render(title) }
	rows := []string{sect("ACTIVE")}
	if d.ActiveTool != "" {
		rows = append(rows, StAccent.Render("● "+d.ActiveTool))
	} else {
		rows = append(rows, StFaint.Render("idle"))
	}
	rows = append(rows, "", sect("TODOS"))
	if len(d.Todos) == 0 {
		rows = append(rows, StFaint.Render("none"))
	}
	for _, t := range d.Todos {
		glyph, style := "◦", StFaint
		switch t.Status {
		case "completed":
			glyph, style = "✓", StOK
		case "in_progress":
			glyph, style = "▸", StAccent
		}
		rows = append(rows, style.Render(glyph+" ")+StText.Render(truncate(t.Content, railWidth-4)))
	}
	rows = append(rows, "", sect("SESSION"),
		StDim.Render("profile ")+StText.Render(d.Profile),
		StDim.Render("session ")+StText.Render("#"+d.SessionID),
		StDim.Render("project ")+StInfo.Render(d.Project),
		StText.Render(fmt.Sprintf("%d in / %d out", d.TokIn, d.TokOut)),
		StDim.Render(fmt.Sprintf("$%.4f", d.Cost)),
	)
	if len(d.Artifacts) > 0 {
		rows = append(rows, "", sect("ARTIFACTS"))
		for _, a := range d.Artifacts {
			rows = append(rows, StText.Render(a.Icon+" "+truncate(a.Title, railWidth-4)))
		}
	}
	return lipgloss.NewStyle().
		Width(railWidth).Height(height).
		BorderStyle(lipgloss.NormalBorder()).BorderLeft(true).BorderForeground(ColBorder).
		PaddingLeft(1).
		Render(lipgloss.JoinVertical(lipgloss.Left, rows...))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `tui/`): `go test ./internal/ui/`
Expected: PASS (all ui tests).

- [ ] **Step 6: Commit**

```bash
git add tui/internal/ui/artifacts.go tui/internal/ui/rail.go tui/internal/ui/artifacts_test.go
git commit -m "feat(tui): artifact renderers + context rail"
```

---

## Task 12: Root model + keys + main (wire everything)

The Bubble Tea `Model` holds all state, routes messages, and composes the views. `main.go` bootstraps the server and runs the program.

**Files:**
- Create: `tui/internal/ui/keys.go`
- Create: `tui/internal/ui/model.go`
- Modify: `tui/main.go` (replace the stub)

- [ ] **Step 1: Write the keybinding helpers**

Create `tui/internal/ui/keys.go`:
```go
package ui

// Keys documents the bindings handled in Update (see model.go).
// ^K palette · ^L clear · ^O tools · ^B/tab rail · y/n approve · esc close
const (
	KeyPalette = "ctrl+k"
	KeyClear   = "ctrl+l"
	KeyTools   = "ctrl+o"
	KeyRail    = "ctrl+b"
)
```

- [ ] **Step 2: Write the root model**

Create `tui/internal/ui/model.go`:
```go
package ui

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"harness-tui/internal/protocol"
	"harness-tui/internal/ws"
)

// Sender abstracts the WS client for testability.
type Sender interface{ Send(protocol.ClientMessage) }

// Model is the root Bubble Tea model.
type Model struct {
	client Sender
	width  int
	height int
	frame  int

	profile   string
	sessionID string
	project   string

	connected bool
	busy      bool
	focusWork bool
	railOpen  bool
	toolsAll  bool
	theme     string

	turns   []Turn
	input   textinput.Model
	tokIn   int
	tokOut  int
	cost    float64
	todos   []protocol.TodoItem
	arts    []protocol.Artifact
	turnStart time.Time

	// overlays
	palette  *Palette
	approval *Approval
	inputReq *InputRequest
}

// New builds the initial model. sessionID is a short random shown in the topbar.
func New(client Sender, profile, sessionID string) Model {
	return Model{
		client:    client,
		profile:   profile,
		sessionID: sessionID,
		project:   "Inbox",
		theme:     "dark",
		input:     NewComposer(),
	}
}

func (m Model) Init() tea.Cmd { return spinnerTick() }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil

	case tickMsg:
		m.frame++
		return m, spinnerTick()

	case ws.ConnectedMsg:
		m.connected = true
		return m, nil
	case ws.DisconnectedMsg:
		m.connected = false
		return m, nil

	case ws.ServerMsg:
		return m.handleServer(msg.Msg), nil

	case tea.KeyMsg:
		return m.handleKey(msg)
	}

	// let the textinput consume other msgs when it has focus and no overlay
	if m.palette == nil && m.approval == nil && m.inputReq == nil {
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m Model) lastAgentTurn() *Turn {
	for i := len(m.turns) - 1; i >= 0; i-- {
		if m.turns[i].Role == "agent" {
			return &m.turns[i]
		}
	}
	return nil
}

// ensureAgentTurn returns the current open agent turn, creating one if the last
// turn is a user turn (i.e. a new response is starting).
func (m *Model) ensureAgentTurn() *Turn {
	if len(m.turns) == 0 || m.turns[len(m.turns)-1].Role == "user" {
		m.turns = append(m.turns, Turn{Role: "agent", Time: time.Now().Format("15:04")})
		m.turnStart = time.Now()
	}
	return &m.turns[len(m.turns)-1]
}

func (m Model) handleServer(s protocol.ServerMessage) Model {
	switch s.Type {
	case "token":
		t := m.ensureAgentTurn()
		t.Text += s.Content
	case "tool_start":
		t := m.ensureAgentTurn()
		t.Sections = append(t.Sections, Section{
			Name:  s.Name,
			Arg:   argSummary(s.Input),
			State: SectionRunning,
		})
	case "tool_end":
		if t := m.lastAgentTurn(); t != nil {
			for i := len(t.Sections) - 1; i >= 0; i-- {
				if t.Sections[i].Name == s.Name && t.Sections[i].State == SectionRunning {
					t.Sections[i].State = SectionDone
					t.Sections[i].Body = s.Result
					break
				}
			}
		}
	case "tool_prompt":
		b, _ := json.Marshal(s.Input)
		m.approval = &Approval{ID: s.ID, Name: s.Name, Input: string(b)}
	case "input_request":
		m.inputReq = &InputRequest{
			ID: s.ID, Prompt: s.Prompt, Kind: s.Kind,
			Options: s.Options, Chosen: map[int]bool{},
		}
	case "todos":
		m.todos = s.Todos
	case "stats":
		m.tokIn, m.tokOut, m.cost = s.TokensIn, s.TokensOut, s.CostUSD
	case "session_ready":
		m.sessionID, m.profile = s.SessionID, s.Profile
	case "session_end", "session_resumed":
		m.busy = false
		if t := m.lastAgentTurn(); t != nil {
			t.Tokens = m.tokOut
			t.Elapsed = time.Since(m.turnStart).Truncate(100 * time.Millisecond).String()
		}
	case "error":
		m.busy = false
		t := m.ensureAgentTurn()
		t.Text += "\n⚠ " + s.Message
	case "artifacts":
		m.arts = append(m.arts, s.Artifacts...)
		m.railOpen = true
	case "projects":
		if m.palette != nil {
			m.palette.Projects = s.Projects
		}
	case "sessions":
		if m.palette != nil {
			m.palette.History = s.Sessions
		}
	case "project_created":
		if s.Project != nil {
			m.project = s.Project.Name
		}
	}
	return m
}

func argSummary(input map[string]interface{}) string {
	for _, k := range []string{"path", "file", "command", "query", "pattern", "url"} {
		if v, ok := input[k]; ok {
			return toStr(v)
		}
	}
	b, _ := json.Marshal(input)
	return string(b)
}

func toStr(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	b, _ := json.Marshal(v)
	return string(b)
}

func (m Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Overlays capture keys first.
	if m.approval != nil {
		switch msg.String() {
		case "y":
			m.client.Send(protocol.ToolApprove(m.approval.ID))
			m.approval = nil
		case "n":
			m.client.Send(protocol.ToolDeny(m.approval.ID))
			m.approval = nil
		}
		return m, nil
	}
	if m.inputReq != nil {
		return m.handleInputReqKey(msg)
	}
	if m.palette != nil {
		return m.handlePaletteKey(msg)
	}

	switch msg.String() {
	case "ctrl+c":
		return m, tea.Quit
	case KeyPalette:
		m.palette = NewPalette()
		return m, nil
	case KeyClear:
		m.turns = nil
		m.arts = nil
		m.busy = false
		return m, nil
	case KeyTools:
		m.toolsAll = !m.toolsAll
		return m, nil
	case KeyRail, "tab":
		m.railOpen = !m.railOpen
		m.focusWork = m.railOpen
		return m, nil
	case "enter":
		v := strings.TrimSpace(m.input.Value())
		if v == "" {
			return m, nil
		}
		m.turns = append(m.turns, Turn{Role: "user", Text: v, Time: time.Now().Format("15:04")})
		m.busy = true
		m.input.SetValue("")
		m.client.Send(protocol.Message(v))
		return m, nil
	}
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return m, cmd
}

func (m Model) handleInputReqKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	ir := m.inputReq
	switch msg.String() {
	case "esc":
		m.inputReq = nil
	case "up":
		if ir.Cursor > 0 {
			ir.Cursor--
		}
	case "down":
		if ir.Cursor < len(ir.Options)-1 {
			ir.Cursor++
		}
	case " ":
		if ir.Kind == "multi_select" {
			ir.Chosen[ir.Cursor] = !ir.Chosen[ir.Cursor]
		}
	case "enter":
		m.client.Send(protocol.InputResponse(ir.ID, ir.Value()))
		m.inputReq = nil
	case "backspace":
		if ir.Kind == "text" && len(ir.Text) > 0 {
			ir.Text = ir.Text[:len(ir.Text)-1]
		}
	default:
		if ir.Kind == "text" && len(msg.String()) == 1 {
			ir.Text += msg.String()
		}
	}
	return m, nil
}

func (m Model) handlePaletteKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	p := m.palette
	switch msg.String() {
	case "esc":
		if p.Mode == ModeRoot {
			m.palette = nil
		} else {
			p.Mode = ModeRoot
			p.Filter = ""
			p.Selected = 0
		}
	case "up":
		if p.Selected > 0 {
			p.Selected--
		}
	case "down":
		if p.Selected < len(p.items())-1 {
			p.Selected++
		}
	case "enter":
		return m.paletteSelect()
	case "backspace":
		if p.Mode == ModeProjectNew {
			if len(p.NewProj) > 0 {
				p.NewProj = p.NewProj[:len(p.NewProj)-1]
			}
		} else if len(p.Filter) > 0 {
			p.Filter = p.Filter[:len(p.Filter)-1]
		}
	default:
		if len(msg.String()) == 1 {
			if p.Mode == ModeProjectNew {
				p.NewProj += msg.String()
			} else {
				p.Filter += msg.String()
				p.Selected = 0
			}
		}
	}
	// Fetch data when entering data modes.
	switch p.Mode {
	case ModeProjectSwitch, ModeAssign:
		m.client.Send(protocol.ProjectList())
	case ModeHistory:
		m.client.Send(protocol.SessionList(""))
	case ModeHistoryAll:
		m.client.Send(protocol.SessionList(""))
	}
	return m, nil
}

func (m Model) paletteSelect() (tea.Model, tea.Cmd) {
	p := m.palette
	if p.Mode == ModeProjectNew {
		if strings.TrimSpace(p.NewProj) != "" {
			m.client.Send(protocol.ProjectCreate(strings.TrimSpace(p.NewProj)))
		}
		m.palette = nil
		return m, nil
	}
	items := p.items()
	if p.Selected >= len(items) {
		return m, nil
	}
	it := items[p.Selected]
	switch p.Mode {
	case ModeRoot:
		if next, ok := modeForRootID(it.ID); ok {
			p.Mode = next
			p.Filter = ""
			p.Selected = 0
			return m, nil
		}
		if it.ID == "reset" {
			m.turns = nil
			m.arts = nil
		} else {
			m.turns = append(m.turns, Turn{Role: "user", Text: "Run the " + it.ID + " task.", Time: time.Now().Format("15:04")})
			m.busy = true
			m.client.Send(protocol.Message("Run the " + it.ID + " task."))
		}
		m.palette = nil
	case ModeProjectSwitch:
		m.project = it.Title
		m.client.Send(protocol.SessionList(it.ID))
		m.palette = nil
	case ModeAssign:
		m.client.Send(protocol.ProjectAssign(m.sessionID, it.ID))
		m.palette = nil
	case ModeHistory, ModeHistoryAll:
		m.client.Send(protocol.Resume(it.ID))
		m.palette = nil
	}
	return m, nil
}

func (m Model) View() string {
	if m.width == 0 {
		return "starting…"
	}
	top := RenderTopBar(m.width, m.profile, m.sessionID, m.project, m.busy)

	convW := m.width
	if m.railOpen {
		convW = m.width - railWidth - 1
	}

	var body string
	if len(m.turns) == 0 {
		body = RenderHero(convW)
	} else {
		body = Transcript{Turns: m.turns, AllExpanded: m.toolsAll}.Render(convW, m.frame)
	}

	conv := lipgloss.JoinVertical(lipgloss.Left,
		lipgloss.NewStyle().Width(convW).Height(maxInt(1, m.height-6)).Render(body),
		RenderComposer(m.input, convW, m.busy),
	)

	center := conv
	if m.railOpen {
		rail := RenderRail(RailData{
			Todos: m.todos, Profile: m.profile, SessionID: m.sessionID,
			Project: m.project, TokIn: m.tokIn, TokOut: m.tokOut, Cost: m.cost,
			Artifacts: m.arts,
		}, maxInt(1, m.height-6))
		center = lipgloss.JoinHorizontal(lipgloss.Top, conv, rail)
	}

	status := RenderStatusBar(m.width, m.busy, m.focusWork, m.tokIn, m.tokOut, m.toolsAll, m.theme)

	view := lipgloss.JoinVertical(lipgloss.Left, top, disconnectBanner(m), center, status)

	// Overlays render centered on top.
	switch {
	case m.approval != nil:
		return overlay(view, RenderApproval(*m.approval), m.width, m.height)
	case m.inputReq != nil:
		return overlay(view, RenderInputRequest(*m.inputReq), m.width, m.height)
	case m.palette != nil:
		return overlay(view, m.palette.Render(m.width), m.width, m.height)
	}
	return view
}

func disconnectBanner(m Model) string {
	if m.connected {
		return ""
	}
	return lipgloss.NewStyle().Background(ColDel).Foreground(ColBgDeep).
		Width(m.width).Render("Disconnected. Waiting for reconnect…")
}

// overlay places box centered over base. Bubble Tea has no true layering, so we
// render the box centered on a full-size canvas (base is dropped while an overlay
// is up — acceptable for modal focus).
func overlay(base, box string, w, h int) string {
	return lipgloss.Place(w, h, lipgloss.Center, lipgloss.Center, box)
}
```

- [ ] **Step 3: Write the Hero (empty state)**

Append to `tui/internal/ui/model.go` (or create `tui/internal/ui/hero.go`):
```go
package ui

import "github.com/charmbracelet/lipgloss"

// RenderHero is the empty-state splash.
func RenderHero(width int) string {
	lines := []string{
		StDim.Render("  ┌─┐  agent control surface"),
		StDim.Render("  │") + StAccent.Render("◆") + StDim.Render("│  data · code · writing · research"),
		StDim.Render("  └─┘"),
		"",
		StAccentB.Render("◆ harness"),
		StDim.Render("A harness for an agent that does the work in the open."),
		"",
		StFaint.Render("Type a message below, or ^K for the palette."),
	}
	return lipgloss.NewStyle().Width(width).Padding(2, 0).Render(lipgloss.JoinVertical(lipgloss.Left, lines...))
}
```
Note: if placed in its own file `hero.go`, drop the duplicate `package ui` / import when appending to `model.go`. Prefer a separate `hero.go` file.

- [ ] **Step 4: Replace main.go**

Replace `tui/main.go`:
```go
package main

import (
	"fmt"
	"math/rand"
	"os"
	"os/user"

	tea "github.com/charmbracelet/bubbletea"

	"harness-tui/internal/server"
	"harness-tui/internal/ui"
	"harness-tui/internal/ws"
)

const version = "0.2.0"

func randID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

func main() {
	for _, a := range os.Args[1:] {
		if a == "--version" || a == "-v" {
			fmt.Printf("harness-tui %s\n", version)
			return
		}
	}

	port := os.Getenv("HARNESS_PORT")
	if port == "" {
		port = "7337"
	}

	boot, err := server.EnsureServer(port)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer boot.Cleanup()

	userID := os.Getenv("HARNESS_USER")
	if userID == "" {
		if u, err := user.Current(); err == nil {
			userID = u.Username
		} else {
			userID = "user"
		}
	}

	profile := os.Getenv("HARNESS_PROFILE")
	if profile == "" {
		profile = "coding"
	}

	client := ws.New(port, userID)
	model := ui.New(client, profile, randID())

	p := tea.NewProgram(model, tea.WithAltScreen())
	client.Start(p.Send)

	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		boot.Cleanup()
		os.Exit(1)
	}
}
```

- [ ] **Step 5: Verify it builds and all tests pass**

Run (from `tui/`):
```bash
go build ./...
go test ./...
```
Expected: build exit 0; `ok` for protocol, server, and ui packages.

- [ ] **Step 6: Commit**

```bash
git add tui/internal/ui/model.go tui/internal/ui/keys.go tui/internal/ui/hero.go tui/main.go
git commit -m "feat(tui): root Bubble Tea model, key routing, main entrypoint"
```

---

## Task 13: Live smoke test

Verify the Go TUI end-to-end against the real server before deleting Ink.

**Files:** none (verification only)

- [ ] **Step 1: Build the binary**

Run (from `tui/`): `go build -o ../bin/harness-tui-dev .`
Expected: exit 0; `bin/harness-tui-dev` exists.

- [ ] **Step 2: Ensure a valid API key + profile**

Confirm the env var named by the active profile's `model.api_key_env` is set (e.g. `ANTHROPIC_API_KEY`). The default profile is `coding`.

- [ ] **Step 3: Run it (auto-spawns the server)**

Run (from repo root): `./bin/harness-tui-dev`
Expected: alt-screen TUI appears; topbar shows `◆ harness · profile coding · ready`; the disconnect banner does NOT persist (server auto-spawned and connected).

- [ ] **Step 4: Exercise the loop**

Type `list the files in the current directory` and press Enter. Verify:
- busy dot turns amber; status shows `RUN`
- a tool section appears with a spinner, then flips to `✓`
- `^O` expands the tool body; `^B` toggles the rail (todos/session)
- streamed agent text renders

Press `^C` to exit. Expected: the auto-spawned server is terminated (no orphan on `:7337` — verify with `curl -s localhost:7337/health` returning connection refused after a moment).

- [ ] **Step 5: Commit nothing; record result**

If issues are found, fix in the relevant task's files and re-run. No commit for this task.

---

## Task 14: Delete Ink, rewire build + docs

Only after Task 13 passes.

**Files:**
- Delete: `src/tui/` (entire directory)
- Modify: `package.json`
- Modify: `install.sh`
- Modify: `scripts/release.mjs`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Delete the Ink TUI**

Run: `git rm -r src/tui`
Expected: all `src/tui/*` staged for deletion.

- [ ] **Step 2: Update package.json scripts + deps**

In `package.json`:
- Change `"dev:tui"` and `"tui"` to `"go run ./tui"`.
- Change `"start:tui"` to `"./bin/harness-tui"`.
- In `"build:bin"`, remove the three `harness-tui*` bun targets and append Go cross-compiles:
```
&& (cd tui && GOOS=linux GOARCH=amd64 go build -o ../bin/harness-tui-linux-x64 .) \
&& (cd tui && GOOS=darwin GOARCH=arm64 go build -o ../bin/harness-tui-macos-arm64 .) \
&& (cd tui && GOOS=darwin GOARCH=amd64 go build -o ../bin/harness-tui-macos-x64 .) \
&& (cd tui && go build -o ../bin/harness-tui .)
```
- Remove `ink`, `ink-text-input`, `@inkjs/ui` from `dependencies`.
- Remove `react` from `dependencies`; remove `@types/react`, `ink-testing-library`, `react-devtools-core` from `devDependencies`.

- [ ] **Step 3: Drop the removed npm deps from the lockfile**

Run: `pnpm install`
Expected: `pnpm-lock.yaml` updates; no errors. (`react` may remain if another package needs it — check `pnpm why react`; only remove if unused.)

- [ ] **Step 4: Update install.sh**

In `install.sh`, wherever `harness-tui` platform binaries are downloaded/installed, keep the same artifact names (`harness-tui-linux-x64`, `harness-tui-macos-arm64`, `harness-tui-macos-x64`) — they are now produced by Go, so no name change is needed. Verify the script references those exact names and update any comment mentioning "bun".

- [ ] **Step 5: Update scripts/release.mjs**

In `scripts/release.mjs`, ensure the release artifact list still includes the three `harness-tui-*` binaries (now Go-built). Update any bun-specific build invocation to call `pnpm build:bin` (which now cross-compiles Go for the TUI).

- [ ] **Step 6: Update CLAUDE.md**

In `CLAUDE.md`:
- Under Commands, change `pnpm dev:tui` description to "start Bubble Tea TUI (Go)".
- In the Key modules table, replace the `src/tui/` row with: `tui/ | Go + Bubble Tea TUI client (WS client of the server)`.

- [ ] **Step 7: Update README.md**

Update any reference to the Ink/React TUI to describe the Go + Bubble Tea TUI and the `go run ./tui` / `pnpm dev:tui` command.

- [ ] **Step 8: Verify the whole repo still builds/tests**

Run (from repo root):
```bash
pnpm typecheck
pnpm test
(cd tui && go build ./... && go test ./...)
```
Expected: typecheck passes (no dangling imports of `src/tui`), vitest passes, Go builds + tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(tui): replace Ink TUI with Go + Bubble Tea client

Delete src/tui, rewire pnpm scripts and build:bin to Go cross-compiles,
drop React/Ink deps, update docs."
```

---

## Self-Review Notes

- **Spec coverage:** §1 architecture → Tasks 0–3, 12; §2 visual language → Tasks 5–7; §3 layout/rail → Tasks 8, 11, 12; §4 parity map → Tasks 6–12 (each feature has a task); §5 bootstrap → Task 2; §6 build/dist → Task 14; §7 error handling → Task 3 (reconnect), 2 (spawn error), 12 (`error` msg); §8 testing → Tasks 1, 2, 6, 7, 10, 11.
- **Type consistency:** `Section`/`SectionState` (Task 6) used by Task 7/12; `Palette`/`PaletteMode`/`items()` (Task 10) used by Task 12; `protocol.ServerMessage` fields (Task 1) consumed in Task 12 `handleServer`; `ws.ServerMsg`/`ConnectedMsg`/`DisconnectedMsg` (Task 3) consumed in Task 12 `Update`.
- **teatest goldens (spec §8):** deferred as optional hardening — the logic-heavy units (protocol, section, transcript, palette, artifacts, server) are unit-tested; the wired model is covered by the Task 13 live smoke test. Add teatest view goldens later if regression protection on the composed view is wanted.
- **Known simplification:** `overlay()` (Task 12) drops the base view while a modal is up rather than true layering — Bubble Tea has no native compositing; acceptable for modal focus and matches the "centered box" Ink behavior.
