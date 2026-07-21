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

// ClientMessage is any client->server frame. Concrete types below implement it
// implicitly via Go's structural typing (each has a `Type` field marshaled first).
type ClientMessage interface{}

type helloMsg struct {
	Type   string `json:"type"`
	UserID string `json:"user_id"`
}

func Hello(userID string) ClientMessage {
	return helloMsg{Type: "hello", UserID: userID}
}

type messageMsg struct {
	Type    string `json:"type"`
	Content string `json:"content"`
}

func Message(content string) ClientMessage {
	return messageMsg{Type: "message", Content: content}
}

type cancelMsg struct {
	Type string `json:"type"`
}

func Cancel() ClientMessage { return cancelMsg{Type: "cancel"} }

type resumeMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
}

func Resume(sessionID string) ClientMessage {
	return resumeMsg{Type: "resume", SessionID: sessionID}
}

type toolApproveMsg struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

func ToolApprove(id string) ClientMessage {
	return toolApproveMsg{Type: "tool_approve", ID: id}
}

type toolDenyMsg struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

func ToolDeny(id string) ClientMessage {
	return toolDenyMsg{Type: "tool_deny", ID: id}
}

type inputResponseMsg struct {
	Type  string `json:"type"`
	ID    string `json:"id"`
	Value string `json:"value"`
}

func InputResponse(id, value string) ClientMessage {
	return inputResponseMsg{Type: "input_response", ID: id, Value: value}
}

type projectCreateMsg struct {
	Type string `json:"type"`
	Name string `json:"name"`
}

func ProjectCreate(name string) ClientMessage {
	return projectCreateMsg{Type: "project_create", Name: name}
}

type projectListMsg struct {
	Type string `json:"type"`
}

func ProjectList() ClientMessage { return projectListMsg{Type: "project_list"} }

type projectAssignMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	ProjectID string `json:"projectId"`
}

func ProjectAssign(sessionID, projectID string) ClientMessage {
	return projectAssignMsg{Type: "project_assign", SessionID: sessionID, ProjectID: projectID}
}

type sessionListMsg struct {
	Type      string `json:"type"`
	ProjectID string `json:"projectId,omitempty"`
}

func SessionList(projectID string) ClientMessage {
	return sessionListMsg{Type: "session_list", ProjectID: projectID}
}
