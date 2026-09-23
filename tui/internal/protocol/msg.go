// Package protocol mirrors the WS message shapes defined in src/types.ts.
package protocol

import "encoding/json"

const ProtocolVersion = 2

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
	Input                 int      `json:"input"`
	Output                int      `json:"output"`
	CostUSD               float64  `json:"cost_usd"`
	BillingMode           string   `json:"billing_mode,omitempty"`
	CostBasis             string   `json:"cost_basis,omitempty"`
	BilledCostUSD         *float64 `json:"billed_cost_usd,omitempty"`
	APIEstimateUSD        float64  `json:"api_estimate_usd,omitempty"`
	APIEquivalentUSD      float64  `json:"api_equivalent_usd,omitempty"`
	UsageStatus           string   `json:"usage_status,omitempty"`
	CachedInputTokens     int      `json:"cached_input_tokens,omitempty"`
	ReasoningOutputTokens int      `json:"reasoning_output_tokens,omitempty"`
	ModelAttempts         int      `json:"model_attempts,omitempty"`
}

type ProviderStatus struct {
	Auth   string `json:"auth"`
	Status string `json:"status"`
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

type ModelInfo struct {
	ID            string   `json:"id"`
	Label         string   `json:"label"`
	Provider      string   `json:"provider"`
	BaseURL       string   `json:"base_url"`
	ContextWindow int      `json:"context_window"`
	InputPrice    float64  `json:"input_price"`
	OutputPrice   float64  `json:"output_price"`
	Tags          []string `json:"tags"`
	Available     bool     `json:"available"`
	Reason        string   `json:"reason,omitempty"`
}

type SkillSummary struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Path        string `json:"path"`
	Source      string `json:"source"`
	MTime       string `json:"mtime"`
}

type CommandSummary struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Template    string `json:"template"`
}

// PendingInput mirrors PendingInput in src/runs/pending.ts.
type PendingInput struct {
	ID          string                 `json:"id"`
	RunID       string                 `json:"run_id"`
	SessionID   string                 `json:"session_id"`
	User        string                 `json:"user"`
	Profile     string                 `json:"profile"`
	Prompt      string                 `json:"prompt"`
	Kind        string                 `json:"kind"`
	Options     []string               `json:"options,omitempty"`
	ToolCallID  string                 `json:"tool_call_id,omitempty"`
	Purpose     string                 `json:"purpose,omitempty"`
	ToolName    string                 `json:"tool_name,omitempty"`
	ToolInput   map[string]interface{} `json:"tool_input,omitempty"`
	IsMCP       bool                   `json:"is_mcp,omitempty"`
	Channel     string                 `json:"channel,omitempty"`
	CreatedAt   string                 `json:"created_at"`
	ExpiresAt   string                 `json:"expires_at"`
	State       string                 `json:"state"`
	Answer      string                 `json:"answer,omitempty"`
	AnsweredAt  *string                `json:"answered_at"`
	AnsweredVia string                 `json:"answered_via,omitempty"`
}

type UndoEntry struct {
	ID        string `json:"id"`
	TS        string `json:"ts"`
	Tool      string `json:"tool"`
	Target    string `json:"target"`
	ExpiresAt string `json:"expires_at,omitempty"`
	Available bool   `json:"available"`
	Forceable bool   `json:"forceable"`
	Applied   bool   `json:"applied"`
	Reason    string `json:"reason,omitempty"`
}

// ServerMessage is a flat envelope over every server->client message.
// Only the fields relevant to msg.Type are populated.
type ServerMessage struct {
	Type string `json:"type"`

	Content string                 `json:"content,omitempty"` // token
	Name    string                 `json:"name,omitempty"`    // tool_start/end/prompt/parked
	Risk    string                 `json:"risk,omitempty"`    // tool_prompt
	Reason  string                 `json:"reason,omitempty"`  // tool_prompt/notice
	Preview interface{}            `json:"preview,omitempty"` // tool_prompt rehearsal proposal
	Level   string                 `json:"level,omitempty"`   // notice
	Detail  string                 `json:"detail,omitempty"`  // notice
	Input   map[string]interface{} `json:"input,omitempty"`   // tool_start/prompt
	Result  string                 `json:"result,omitempty"`  // tool_end
	OK      *bool                  `json:"ok,omitempty"`      // tool_end; nil for pre-status servers
	RunID   string                 `json:"run_id,omitempty"`  // turn-scoped server messages

	ID      string   `json:"id,omitempty"`      // tool_prompt/input_request
	Prompt  string   `json:"prompt,omitempty"`  // input_request
	Kind    string   `json:"kind,omitempty"`    // input_request: text|select|multi_select
	Options []string `json:"options,omitempty"` // input_request

	SessionID       string          `json:"sessionId,omitempty"`        // session_ready/end/resumed, artifacts
	Profile         string          `json:"profile,omitempty"`          // session_ready, session_resumed
	Model           string          `json:"model,omitempty"`            // session_ready
	WorkingDir      string          `json:"working_dir,omitempty"`      // session_ready
	Yolo            bool            `json:"yolo,omitempty"`             // session_ready
	ProtocolVersion int             `json:"protocol_version,omitempty"` // hello/session_ready
	ProviderStatus  *ProviderStatus `json:"provider_status,omitempty"`

	TokensIn      int     `json:"tokens_in,omitempty"`      // stats
	TokensOut     int     `json:"tokens_out,omitempty"`     // stats
	CostUSD       float64 `json:"cost_usd,omitempty"`       // stats, stage
	ContextWindow int     `json:"context_window,omitempty"` // stats
	ContextTokens int     `json:"context_tokens,omitempty"` // stats
	Usage         *Usage  `json:"usage,omitempty"`          // stats/agent_stats
	Mode          string  `json:"mode,omitempty"`           // approval_mode_changed

	Message string `json:"message,omitempty"` // error

	Todos     []TodoItem       `json:"todos,omitempty"`     // todos
	Artifacts []Artifact       `json:"artifacts,omitempty"` // artifacts
	Projects  []Project        `json:"projects,omitempty"`  // projects
	Sessions  []SessionSummary `json:"sessions,omitempty"`  // sessions
	Project   *Project         `json:"project,omitempty"`   // project_created
	Models    []ModelInfo      `json:"models,omitempty"`    // models
	Current   string           `json:"current,omitempty"`   // models
	Proposed  []SkillSummary   `json:"proposed,omitempty"`
	Installed []SkillSummary   `json:"installed,omitempty"`
	Commands  []CommandSummary `json:"commands,omitempty"`
	Source    string           `json:"source,omitempty"`
	Path      string           `json:"path,omitempty"`
	Action    string           `json:"action,omitempty"`
	Stage     string           `json:"stage,omitempty"`
	Intensity int              `json:"intensity,omitempty"`
	Tier      string           `json:"tier,omitempty"`
	State     string           `json:"state,omitempty"`
	Pending   []PendingInput   `json:"pending,omitempty"`
	Undo      []UndoEntry      `json:"entries,omitempty"`
	Mission   json.RawMessage  `json:"mission,omitempty"`
	Receipt   json.RawMessage  `json:"receipt,omitempty"`
	Runtime   *RuntimeSnapshot `json:"snapshot,omitempty"`

	WorkflowMapSnapshot    *WorkflowMapSnapshot    `json:"-"`
	WorkflowMapObservation *WorkflowMapObservation `json:"observation,omitempty"`
}

// RuntimeSnapshot is the bounded recovery projection. Actionable IDs alone
// never authorize a TUI control; Actionable carries the complete prompt.
type RuntimeSnapshot struct {
	SessionID  string              `json:"session_id"`
	Actionable []RecoverablePrompt `json:"actionable,omitempty"`
}

// WorkflowMapScope mirrors WorkflowMapScope in src/types.ts. Every value is
// required: a run id alone is not enough to associate observed execution with
// a TUI turn.
type WorkflowMapScope struct {
	RunID     string `json:"run_id"`
	SessionID string `json:"session_id"`
	Profile   string `json:"profile"`
}

type WorkflowMapAvailability struct {
	State  string `json:"state"`
	Reason string `json:"reason,omitempty"`
}

type WorkflowMapAttempt struct {
	AttemptID    string   `json:"attempt_id"`
	PassID       string   `json:"pass_id"`
	ParentPassID string   `json:"parent_pass_id,omitempty"`
	Playbook     string   `json:"playbook"`
	Stage        string   `json:"stage"`
	Attempt      int      `json:"attempt"`
	Intensity    int      `json:"intensity"`
	Tier         string   `json:"tier"`
	Model        string   `json:"model"`
	State        string   `json:"state"`
	CostUSD      *float64 `json:"cost_usd,omitempty"`
	DurationMS   *int64   `json:"duration_ms,omitempty"`
	ContractOK   *bool    `json:"contract_ok,omitempty"`
	Explore      bool     `json:"explore,omitempty"`
}

type WorkflowMapTransition struct {
	TransitionID  string `json:"transition_id"`
	FromAttemptID string `json:"from_attempt_id,omitempty"`
	ToAttemptID   string `json:"to_attempt_id,omitempty"`
	Kind          string `json:"kind"`
}

type WorkflowMapAdvice struct {
	AdviceID string `json:"advice_id"`
	Kind     string `json:"kind"`
	Mode     string `json:"mode"`
	Applied  bool   `json:"applied"`
	Action   string `json:"action,omitempty"`
	Summary  string `json:"summary,omitempty"`
}

type WorkflowMapObservation struct {
	EventID    string                 `json:"event_id"`
	Revision   uint64                 `json:"revision"`
	Kind       string                 `json:"kind"`
	Scope      WorkflowMapScope       `json:"scope"`
	PassID     string                 `json:"pass_id,omitempty"`
	Attempt    *WorkflowMapAttempt    `json:"attempt,omitempty"`
	Transition *WorkflowMapTransition `json:"transition,omitempty"`
	Advice     *WorkflowMapAdvice     `json:"advice,omitempty"`
	Terminal   string                 `json:"terminal,omitempty"`
}

type WorkflowMapSnapshot struct {
	Version              int                     `json:"version"`
	Scope                WorkflowMapScope        `json:"scope"`
	Revision             uint64                  `json:"revision"`
	Availability         WorkflowMapAvailability `json:"availability"`
	Terminal             string                  `json:"terminal,omitempty"`
	Attempts             []WorkflowMapAttempt    `json:"attempts"`
	Transitions          []WorkflowMapTransition `json:"transitions"`
	Advice               []WorkflowMapAdvice     `json:"advice"`
	RetainedFromRevision *uint64                 `json:"retained_from_revision,omitempty"`
}

type RecoverablePrompt struct {
	ID      string                 `json:"id"`
	Name    string                 `json:"name"`
	Input   map[string]interface{} `json:"input"`
	Risk    string                 `json:"risk,omitempty"`
	Reason  string                 `json:"reason,omitempty"`
	Preview interface{}            `json:"preview,omitempty"`
}

// DecodeServer parses one server->client frame.
func DecodeServer(raw []byte) (ServerMessage, error) {
	var m ServerMessage
	err := json.Unmarshal(raw, &m)
	if err != nil {
		return m, err
	}
	if m.Type == "workflow_map" {
		var envelope struct {
			Snapshot *WorkflowMapSnapshot `json:"snapshot"`
		}
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return m, err
		}
		m.WorkflowMapSnapshot = envelope.Snapshot
		m.Runtime = nil // the shared JSON key "snapshot" belongs to this message's typed snapshot
	}
	return m, err
}

// ClientMessage is any client->server frame. Only the constructors in this
// file may produce one — see isClientMessage.
type ClientMessage interface {
	isClientMessage()
}

type helloMsg struct {
	Type            string `json:"type"`
	UserID          string `json:"user_id"`
	ProtocolVersion int    `json:"protocol_version"`
	Profile         string `json:"profile,omitempty"`
	WorkingDir      string `json:"working_dir,omitempty"`
}

func (helloMsg) isClientMessage()            {}
func (messageMsg) isClientMessage()          {}
func (planRequestMsg) isClientMessage()      {}
func (cancelMsg) isClientMessage()           {}
func (resumeMsg) isClientMessage()           {}
func (toolApproveMsg) isClientMessage()      {}
func (toolDenyMsg) isClientMessage()         {}
func (inputResponseMsg) isClientMessage()    {}
func (projectCreateMsg) isClientMessage()    {}
func (projectListMsg) isClientMessage()      {}
func (projectAssignMsg) isClientMessage()    {}
func (sessionListMsg) isClientMessage()      {}
func (setApprovalModeMsg) isClientMessage()  {}
func (modelsListMsg) isClientMessage()       {}
func (setModelMsg) isClientMessage()         {}
func (skillsListMsg) isClientMessage()       {}
func (commandsListMsg) isClientMessage()     {}
func (skillGetMsg) isClientMessage()         {}
func (skillSaveMsg) isClientMessage()        {}
func (skillPromoteMsg) isClientMessage()     {}
func (skillDiscardMsg) isClientMessage()     {}
func (skillsMineMsg) isClientMessage()       {}
func (compactMsg) isClientMessage()          {}
func (pendingListMsg) isClientMessage()      {}
func (pendingAnswerMsg) isClientMessage()    {}
func (undoListMsg) isClientMessage()         {}
func (undoApplyMsg) isClientMessage()        {}
func (runtimeSubscribeMsg) isClientMessage() {}

func (workflowMapRequestMsg) isClientMessage() {}

func Hello(userID string, profile ...string) ClientMessage {
	msg := helloMsg{Type: "hello", UserID: userID, ProtocolVersion: ProtocolVersion}
	if len(profile) > 0 {
		msg.Profile = profile[0]
	}
	return msg
}

func HelloWithWorkingDir(userID, profile, workingDir string) ClientMessage {
	return helloMsg{Type: "hello", UserID: userID, ProtocolVersion: ProtocolVersion, Profile: profile, WorkingDir: workingDir}
}

type messageMsg struct {
	Type    string `json:"type"`
	Content string `json:"content"`
}

func Message(content string) ClientMessage {
	return messageMsg{Type: "message", Content: content}
}

type planRequestMsg struct {
	Type    string `json:"type"`
	Content string `json:"content"`
}

func PlanRequest(content string) ClientMessage {
	return planRequestMsg{Type: "plan_request", Content: content}
}

type setApprovalModeMsg struct {
	Type string `json:"type"`
	Mode string `json:"mode"`
}

func SetApprovalMode(mode string) ClientMessage {
	return setApprovalModeMsg{Type: "set_approval_mode", Mode: mode}
}

type modelsListMsg struct {
	Type string `json:"type"`
}

func ModelsList() ClientMessage { return modelsListMsg{Type: "models_list"} }

type setModelMsg struct {
	Type  string `json:"type"`
	Model string `json:"model"`
}

func SetModel(model string) ClientMessage { return setModelMsg{Type: "set_model", Model: model} }

type compactMsg struct {
	Type string `json:"type"`
}

func Compact() ClientMessage { return compactMsg{Type: "compact"} }

type pendingListMsg struct {
	Type string `json:"type"`
}

func PendingList() ClientMessage { return pendingListMsg{Type: "pending_list"} }

type undoListMsg struct {
	Type string `json:"type"`
}

func UndoList() ClientMessage { return undoListMsg{Type: "undo_list"} }

type undoApplyMsg struct {
	Type  string `json:"type"`
	ID    string `json:"id"`
	Force bool   `json:"force,omitempty"`
}

func UndoApply(id string, force ...bool) ClientMessage {
	forced := len(force) > 0 && force[0]
	return undoApplyMsg{Type: "undo_apply", ID: id, Force: forced}
}

type pendingAnswerMsg struct {
	Type      string `json:"type"`
	PendingID string `json:"pending_id"`
	Value     string `json:"value"`
}

func PendingAnswer(pendingID, value string) ClientMessage {
	return pendingAnswerMsg{Type: "pending_answer", PendingID: pendingID, Value: value}
}

type skillsListMsg struct {
	Type string `json:"type"`
}

func SkillsList() ClientMessage { return skillsListMsg{Type: "skills_list"} }

type commandsListMsg struct {
	Type string `json:"type"`
}

func CommandsList() ClientMessage { return commandsListMsg{Type: "commands_list"} }

type skillGetMsg struct {
	Type   string `json:"type"`
	Name   string `json:"name"`
	Source string `json:"source"`
}

func SkillGet(name, source string) ClientMessage {
	return skillGetMsg{Type: "skill_get", Name: name, Source: source}
}

type skillSaveMsg struct {
	Type    string `json:"type"`
	Name    string `json:"name"`
	Content string `json:"content"`
}

func SkillSave(name, content string) ClientMessage {
	return skillSaveMsg{Type: "skill_save", Name: name, Content: content}
}

type skillPromoteMsg struct {
	Type string `json:"type"`
	Name string `json:"name"`
}

func SkillPromote(name string) ClientMessage {
	return skillPromoteMsg{Type: "skill_promote", Name: name}
}

type skillDiscardMsg struct {
	Type string `json:"type"`
	Name string `json:"name"`
}

func SkillDiscard(name string) ClientMessage {
	return skillDiscardMsg{Type: "skill_discard", Name: name}
}

type skillsMineMsg struct {
	Type string `json:"type"`
}

func SkillsMine() ClientMessage { return skillsMineMsg{Type: "skills_mine"} }

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

type runtimeSubscribeMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
}

func RuntimeSubscribe(sessionID string) ClientMessage {
	return runtimeSubscribeMsg{Type: "runtime_subscribe", SessionID: sessionID}
}

type workflowMapRequestMsg struct {
	Type          string           `json:"type"`
	Scope         WorkflowMapScope `json:"scope"`
	AfterRevision *uint64          `json:"after_revision,omitempty"`
}

// WorkflowMap requests a scoped map recovery. A nil revision asks the server
// for its authoritative snapshot; a value asks for retained events after it.
func WorkflowMap(scope WorkflowMapScope, afterRevision *uint64) ClientMessage {
	return workflowMapRequestMsg{Type: "workflow_map", Scope: scope, AfterRevision: afterRevision}
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
