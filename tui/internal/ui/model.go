package ui

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"harness-tui/internal/prefs"
	"harness-tui/internal/protocol"
	"harness-tui/internal/ws"
)

// MessageSender is the small client surface the UI needs. It keeps the root
// model testable without a live socket.
type MessageSender interface {
	Send(protocol.ClientMessage)
}

type Options struct {
	NoMotion  bool
	NoNotify  bool
	NotifyTTY bool
}

type Model struct {
	sender             MessageSender
	composer           Composer
	transcript         Transcript
	viewport           viewport.Model
	notices            NoticeStack
	keys               KeyMap
	prefs              prefs.Preferences
	profile            string
	model              string
	approvalMode       string
	userID             string
	sessionID          string
	connected          bool
	focused            bool
	running            bool
	follow             bool
	frame              int
	width              int
	height             int
	tokensIn           int
	tokensOut          int
	costUSD            float64
	displayCost        float64
	contextTokens      int
	contextWindow      int
	contextWarned      bool
	turnTokensOut      int
	turnCost           float64
	queue              []string
	pendingApproval    *ApprovalRequest
	pendingInput       *InputRequest
	approvalPicker     bool
	approvalCursor     int
	yoloConfirm        bool
	modelPicker        bool
	modelCursor        int
	modelOptions       []protocol.ModelInfo
	modelFilter        string
	modelCustom        bool
	modelInput         textinput.Model
	workingDir         string
	activeTool         string
	activeToolStarted  time.Time
	noMotion           bool
	noNotify           bool
	notifyTTY          bool
	notifyPending      bool
	helpOpen           bool
	overlayOpen        bool
	overlayTab         string
	railVisible        bool
	todos              []protocol.TodoItem
	artifacts          []protocol.Artifact
	spark              Sparkline
	proposedSkills     []protocol.SkillSummary
	installedSkills    []protocol.SkillSummary
	skillCursor        int
	skillPreview       string
	skillPreviewOffset int
	skillEditing       bool
	skillEditor        textarea.Model
	skillConfirm       string
	skillEditorConfirm bool
	skillEditorError   string
	mentionValue       string
	mentionMatches     []string
	mentionCapped      bool
	attachments        []Attachment
	localCancel        context.CancelFunc
	lastLocal          *localResultMsg
	density            string // "full" | "normal" | "compact" — prose fold aggressiveness

	git        GitState
	gitBusy    string // git action in flight, "" when idle
	gitConfirm string // git action armed, awaiting a second click

	tasks           []Task
	tasksDetected   bool // tasks came from heuristics, not from tasks.json
	taskRuns        map[string]*TaskRun
	taskCursor      int
	taskEditing     bool
	taskEditor      textarea.Model
	taskEditorError string

	// Rail render and hit map are produced together in reflow so a click can
	// never be resolved against a different layout than the one on screen.
	railBlock    string
	railHits     []RailHit
	contentLines int // rendered transcript height, for the scrollbar
}

func NewModel(sender MessageSender, profile, userID string, preferences prefs.Preferences) Model {
	composer := NewComposer()
	skillEditor := textarea.New()
	skillEditor.ShowLineNumbers = false
	taskEditor := textarea.New()
	taskEditor.ShowLineNumbers = false
	modelInput := textinput.New()
	modelInput.Prompt = "custom id › "
	modelInput.CharLimit = 200
	viewportModel := viewport.New(80, 16)
	m := Model{
		sender:       sender,
		composer:     composer,
		viewport:     viewportModel,
		skillEditor:  skillEditor,
		taskEditor:   taskEditor,
		taskRuns:     map[string]*TaskRun{},
		modelInput:   modelInput,
		keys:         NewKeyMap(),
		prefs:        preferences,
		profile:      profile,
		model:        "connecting",
		workingDir:   ".",
		approvalMode: "danger",
		userID:       userID,
		follow:       true,
		width:        80,
		height:       24,
	}
	if mode := preferences.ApprovalModeByProfile[profile]; mode == "strict" || mode == "bash" || mode == "danger" || mode == "yolo" {
		m.approvalMode = mode
	}
	m.railVisible = preferences.RailVisible
	m.overlayTab = preferences.OverlayTab
	m.density = preferences.DensityMode
	if m.density != "full" && m.density != "compact" && m.density != "normal" {
		m.density = "normal"
	}
	if preferences.Theme == "" {
		preferences.Theme = "ember"
	}
	m.prefs.Theme = preferences.Theme
	ApplyTheme(preferences.Theme)
	m.transcript.Motion = true
	m.focused = true
	m.refreshProject()
	m.reflow()
	return m
}

// refreshProject reloads the task list for the current working directory. It
// is called at startup and again whenever the server tells us which directory
// the session actually runs in.
func (m *Model) refreshProject() {
	tasks, detected, err := LoadTasks(m.workingDir)
	m.tasks = tasks
	m.tasksDetected = detected
	if m.taskCursor >= len(m.tasks) {
		m.taskCursor = maxInt(0, len(m.tasks)-1)
	}
	if err != nil {
		m.notices.Add(NoticeWarn, "tasks.json unreadable", err.Error(), "/tasks edit to fix it")
	}
}

func (m *Model) Configure(options Options) {
	m.noMotion = options.NoMotion
	m.noNotify = options.NoNotify
	m.notifyTTY = options.NotifyTTY
	m.transcript.Motion = !options.NoMotion
}

func (m Model) Init() tea.Cmd { return tea.Batch(spinnerTick(), gitStatusCmd(m.workingDir)) }

// gitPollFrames is how often the rail re-reads git state on its own, in
// spinner frames (100ms each). Agent tool calls and local shell commands change
// the tree without telling us, so the panel polls rather than going stale.
const gitPollFrames = 50

func (m Model) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := message.(type) {
	case tea.WindowSizeMsg:
		m.width = maxInt(1, msg.Width)
		m.height = maxInt(1, msg.Height)
		m.reflow()
		return m, nil
	case tickMsg:
		m.frame++
		if m.displayCost < m.costUSD {
			step := (m.costUSD - m.displayCost) * 0.35
			if step < 0.000001 {
				m.displayCost = m.costUSD
			} else {
				m.displayCost += step
			}
		}
		for i := range m.transcript.Turns {
			turn := &m.transcript.Turns[i]
			if turn.Pulse > 0 {
				turn.Pulse--
			}
			total := len([]rune(turn.Text))
			if !m.transcript.Motion {
				turn.Revealed = total
				continue
			}
			if turn.Revealed < total {
				step := maxInt(2, (total-turn.Revealed)/6)
				turn.Revealed = minInt(total, turn.Revealed+step)
			}
		}
		if m.running {
			m.spark.Add(float64(m.tokensOut))
		}
		m.notices.Expire(time.Now())
		m.reflow()
		// Nothing to poll once we know this is not a repository — that answer
		// only changes if the working dir does, which re-checks anyway.
		if m.frame%gitPollFrames == 0 && m.gitBusy == "" && !(m.git.Checked && !m.git.Repo) {
			return m, tea.Batch(spinnerTick(), gitStatusCmd(m.workingDir))
		}
		return m, spinnerTick()
	case gitStatusMsg:
		m.git = msg.State
		m.reflow()
		return m, nil
	case gitActionMsg:
		return m.handleGitAction(msg)
	case taskExitMsg:
		return m.handleTaskExit(msg)
	case ws.ConnectedMsg:
		wasDisconnected := !m.notices.DisconnectedAt.IsZero()
		m.connected = true
		m.send(protocol.ModelsList())
		m.send(protocol.SkillsList())
		m.notices.SetDisconnected(false)
		if wasDisconnected {
			m.notices.Add(NoticeInfo, "reconnected", "", "")
		}
		m.reflow()
		return m, nil
	case ws.DisconnectedMsg:
		m.connected = false
		m.notices.SetDisconnected(true)
		m.reflow()
		return m, nil
	case ws.MalformedMsg:
		m.notices.Add(NoticeError, "malformed server frame", msg.Err.Error(), "connection remains open")
		m.reflow()
		return m, nil
	case ws.ServerMsg:
		previousDir := m.workingDir
		m.handleServerMessage(msg.Msg)
		var cmds []tea.Cmd
		if m.workingDir != previousDir {
			m.refreshProject()
			cmds = append(cmds, gitStatusCmd(m.workingDir))
		}
		m.reflow()
		if m.notifyPending {
			m.notifyPending = false
			cmds = append(cmds, tea.Printf("%s", OSC9("harness turn finished")+"\a"))
		}
		return m, tea.Batch(cmds...)
	case tea.FocusMsg:
		m.focused = true
		return m, nil
	case tea.BlurMsg:
		m.focused = false
		return m, nil
	case tea.MouseMsg:
		if msg.Button == tea.MouseButtonWheelUp || msg.Button == tea.MouseButtonWheelDown {
			var cmd tea.Cmd
			m.viewport, cmd = m.viewport.Update(msg)
			m.follow = m.viewport.AtBottom()
			return m, cmd
		}
		if msg.Action != tea.MouseActionRelease || msg.Button != tea.MouseButtonLeft {
			return m, nil
		}
		topBarHeight := lipgloss.Height(topBar(m.profile, m.sessionID, m.connected, m.running, m.frame, time.Now(), m.width))
		if m.railShown() && msg.X >= m.width-railWidth {
			// Rail coordinates: the block starts at the rail column, and its
			// content starts after the left border and PaddingLeft(2).
			return m.clickRail(msg.X-(m.width-railWidth)-3, msg.Y-topBarHeight)
		}
		clickRow := msg.Y - topBarHeight + m.viewport.YOffset
		if clickRow < 0 {
			return m, nil
		}
		_, hits := m.transcript.RenderWithHitMap(m.viewport.Width, m.frame)
		for _, hit := range hits {
			if hit.Y != clickRow {
				continue
			}
			if hit.IsProse {
				turn := &m.transcript.Turns[hit.TurnIndex]
				if turn.ExpandedProse == nil {
					turn.ExpandedProse = map[string]bool{}
				}
				key := fmt.Sprintf("%d", hit.ProseIndex)
				turn.ExpandedProse[key] = !turn.ExpandedProse[key]
			} else if hit.GroupKey != "" {
				turn := &m.transcript.Turns[hit.TurnIndex]
				if turn.ExpandedGroups == nil {
					turn.ExpandedGroups = map[string]bool{}
				}
				turn.ExpandedGroups[hit.GroupKey] = !turn.ExpandedGroups[hit.GroupKey]
			} else if hit.Item != nil {
				hit.Item.Toggle()
			}
			m.reflow()
			break
		}
		return m, nil
	case mentionIndexMsg:
		if msg.Value == m.composer.Value() {
			m.mentionValue = msg.Value
			m.mentionMatches = msg.Matches
			m.mentionCapped = msg.Capped
			m.reflow()
		}
		return m, nil
	case localResultMsg:
		m.localCancel = nil
		result := msg
		m.lastLocal = &result
		m.transcript.Turns = append(m.transcript.Turns, Turn{Role: "local", Text: localView(msg), Time: time.Now().Format("15:04")})
		m.reflow()
		return m, nil
	case tea.KeyMsg:
		return m.updateKey(msg)
	default:
		return m, nil
	}
}

func (m Model) updateKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.pendingApproval != nil {
		return m.updateApproval(msg)
	}
	if m.pendingInput != nil {
		return m.updateInput(msg)
	}
	if m.approvalPicker {
		return m.updateApprovalPicker(msg)
	}
	if m.modelPicker {
		return m.updateModelPicker(msg)
	}
	if m.overlayOpen {
		return m.updateOverlay(msg)
	}
	if m.helpOpen {
		m.helpOpen = false
		m.reflow()
		return m, nil
	}
	switch {
	case matches(msg, m.keys.Quit):
		return m, tea.Quit
	case matches(msg, m.keys.Cancel):
		if len(slashMatches(m.composer.Value())) > 0 {
			return m, nil
		}
		if m.running {
			m.send(protocol.Cancel())
			m.running = false
		}
		if m.localCancel != nil {
			m.localCancel()
			m.localCancel = nil
			m.notices.Add(NoticeInfo, "local command interrupted", "", "")
		}
		m.composer.Reset()
		m.notices.Clear()
		m.reflow()
		return m, nil
	case msg.String() == "tab" && len(slashMatches(m.composer.Value())) > 0:
		matches := slashMatches(m.composer.Value())
		m.composer.input.SetValue(matches[0] + " ")
		m.reflow()
		return m, nil
	case msg.String() == "tab":
		mentions := m.mentionMatches
		if m.mentionValue == m.composer.Value() && len(mentions) > 0 {
			value := m.composer.Value()
			at := strings.LastIndex(value, "@")
			m.composer.input.SetValue(value[:at] + mentions[0] + " ")
			m.reflow()
			return m, nil
		}
		m.openOverlay(m.prefs.OverlayTab)
		m.reflow()
		return m, nil
	case msg.String() == "ctrl+x":
		m.queue = nil
		m.notices.Add(NoticeInfo, "queue cleared", "", "")
		m.reflow()
		return m, nil
	case matches(msg, m.keys.ExpandAll):
		m.transcript.AllExpanded = !m.transcript.AllExpanded
		for turn := range m.transcript.Turns {
			for section := range m.transcript.Turns[turn].Sections {
				if m.transcript.AllExpanded && m.transcript.Motion {
					m.transcript.Turns[turn].Sections[section].RevealAt = m.frame
				} else {
					m.transcript.Turns[turn].Sections[section].RevealAt = -1
				}
			}
		}
		m.reflow()
		return m, nil
	case matches(msg, m.keys.PageUp), matches(msg, m.keys.PageDown), matches(msg, m.keys.HalfPageUp), matches(msg, m.keys.HalfPageDown):
		var cmd tea.Cmd
		m.viewport, cmd = m.viewport.Update(msg)
		m.follow = m.viewport.AtBottom()
		return m, cmd
	case msg.String() == "end":
		m.viewport.GotoBottom()
		m.follow = true
		return m, nil
	// "?" is only a shortcut on an empty composer — mid-message it must reach
	// the composer as a literal character instead of being eaten.
	case msg.String() == "?" && m.composer.Value() == "":
		m.helpOpen = true
		m.reflow()
		return m, nil
	case matches(msg, m.keys.Overlay):
		m.openOverlay(m.prefs.OverlayTab)
		m.reflow()
		return m, nil
	case matches(msg, m.keys.Rail):
		if m.width < 100 {
			m.notices.Add(NoticeInfo, "context rail unavailable", "requires 100+ columns", "resize terminal")
		} else {
			m.railVisible = !m.railVisible
			m.prefs.RailVisible = m.railVisible
			_ = m.prefs.Save("")
		}
		m.reflow()
		return m, nil
	case matches(msg, m.keys.Send):
		if m.composer.Value() == "" && m.lastLocal != nil {
			m.startMessage("Use this local command output as context:\n" + m.lastLocal.Output)
			m.lastLocal = nil
			return m, nil
		}
		return m, m.submit()
	case msg.String() == "ctrl+r":
		if len(m.attachments) > 0 {
			m.attachments = nil
			m.notices.Add(NoticeInfo, "attachments cleared", "", "")
			m.reflow()
			return m, nil
		}
	}
	cmd := m.composer.Update(msg)
	// A drag-and-drop arrives from the terminal as one bulk paste event, not
	// individual keystrokes — gating on msg.Paste is what keeps ordinary
	// typing (e.g. mentioning a real file path in a message) from being
	// silently swallowed into an attachment.
	if msg.Paste {
		m.captureDroppedFiles(string(msg.Runes))
	}
	mentionCmd := m.scheduleMentionIndex()
	m.reflow()
	return m, tea.Batch(cmd, mentionCmd)
}

// captureDroppedFiles turns a pasted block of text into attachments, but only
// when it looks like a real drop: every whitespace-separated token in the
// paste must resolve to an existing file. A clipboard paste of ordinary prose
// that merely mentions a path is left untouched.
func (m *Model) captureDroppedFiles(pasted string) {
	if pasted == "" || !strings.ContainsAny(pasted, "/\\") {
		return
	}
	tokens := splitDropTokens(pasted)
	candidates := parseDroppedPaths(pasted)
	if len(candidates) == 0 || len(candidates) != len(tokens) {
		return
	}
	remaining := m.composer.Value()
	added := 0
	for _, candidate := range candidates {
		if m.hasAttachment(candidate.path) {
			continue
		}
		attachment := newAttachment(candidate.path, m.workingDir)
		m.attachments = append(m.attachments, attachment)
		remaining = strings.Replace(remaining, candidate.raw, "", 1)
		added++
	}
	if added == 0 {
		return
	}
	m.composer.input.SetValue(strings.TrimSpace(remaining))
	m.composer.syncHeight()
	m.notices.Add(NoticeInfo, fmt.Sprintf("attached %d file(s)", added),
		"sent with your next message", "ctrl+r clears")
}

func (m Model) hasAttachment(path string) bool {
	for _, attachment := range m.attachments {
		if attachment.Path == path {
			return true
		}
	}
	return false
}

func (m Model) updateApproval(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	decision := msg.String()
	clearAwaitingApproval := func() {
		if m.pendingApproval == nil {
			return
		}
		agent := m.currentAgent()
		for i := len(agent.Sections) - 1; i >= 0; i-- {
			section := &agent.Sections[i]
			if section.Name == m.pendingApproval.Name && section.AwaitingApproval {
				section.AwaitingApproval = false
				break
			}
		}
	}
	if decision == "n" || decision == "esc" {
		clearAwaitingApproval()
		m.send(protocol.ToolDeny(m.pendingApproval.ID))
		m.pendingApproval = nil
		m.notices.Add(NoticeWarn, "tool denied", "request declined", "")
		m.reflow()
		return m, nil
	}
	if decision == "y" || decision == "enter" || decision == "a" {
		clearAwaitingApproval()
		id := m.pendingApproval.ID
		if decision == "a" {
			m.approvalMode = "yolo"
			m.send(protocol.SetApprovalMode("yolo"))
			m.notices.Add(NoticeWarn, "yolo enabled", "future tools run without approval", "set /approval danger to restore prompts")
		}
		m.send(protocol.ToolApprove(id))
		m.pendingApproval = nil
		m.reflow()
	}
	return m, nil
}

func (m Model) updateInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	req := m.pendingInput
	if msg.String() == "esc" {
		m.send(protocol.InputResponse(req.ID, ""))
		m.pendingInput = nil
		m.reflow()
		return m, nil
	}
	if req.Kind == "text" {
		if msg.String() == "enter" {
			m.send(protocol.InputResponse(req.ID, req.Text.Value()))
			m.pendingInput = nil
			m.reflow()
			return m, nil
		}
		var cmd tea.Cmd
		req.Text, cmd = req.Text.Update(msg)
		m.reflow()
		return m, cmd
	}
	if msg.String() == "up" && req.Cursor > 0 {
		req.Cursor--
	} else if msg.String() == "down" && req.Cursor < len(req.Options)-1 {
		req.Cursor++
	} else if msg.String() == "space" && req.Kind == "multi_select" {
		req.Selected[req.Cursor] = !req.Selected[req.Cursor]
	} else if msg.String() == "enter" {
		value := ""
		if req.Kind == "select" && len(req.Options) > 0 {
			value = req.Options[req.Cursor]
		} else {
			chosen := make([]string, 0)
			for i, option := range req.Options {
				if req.Selected[i] {
					chosen = append(chosen, option)
				}
			}
			value = strings.Join(chosen, ", ")
		}
		m.send(protocol.InputResponse(req.ID, value))
		m.pendingInput = nil
		m.reflow()
	}
	return m, nil
}

var approvalModes = []string{"strict", "bash", "danger", "yolo"}

// applyApprovalCursor commits the highlighted mode, requiring a second enter
// for yolo. Returns false when it only armed the confirmation.
func (m *Model) applyApprovalCursor() bool {
	if approvalModes[m.approvalCursor] == "yolo" && !m.yoloConfirm {
		m.yoloConfirm = true
		m.notices.Add(NoticeWarn, "confirm YOLO", "press enter again to allow all tools", "profile deny still wins")
		return false
	}
	m.approvalMode = approvalModes[m.approvalCursor]
	m.yoloConfirm = false
	m.send(protocol.SetApprovalMode(m.approvalMode))
	m.persistApprovalMode()
	m.notices.Add(NoticeInfo, "approval mode", m.approvalMode, "")
	return true
}

// moveApprovalCursor returns true when the key was a navigation key.
func (m *Model) moveApprovalCursor(key string) bool {
	switch key {
	case "up":
		if m.approvalCursor > 0 {
			m.approvalCursor--
			m.yoloConfirm = false
		}
		return true
	case "down":
		if m.approvalCursor < len(approvalModes)-1 {
			m.approvalCursor++
			m.yoloConfirm = false
		}
		return true
	}
	return false
}

func (m Model) updateApprovalPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case msg.String() == "esc":
		m.approvalPicker = false
	case m.moveApprovalCursor(msg.String()):
	case msg.String() == "enter":
		if m.applyApprovalCursor() {
			m.approvalPicker = false
		}
	}
	m.reflow()
	return m, nil
}

// updateApprovalTab drives the Approval tab inside the overlay. Unlike the
// standalone picker it keeps the overlay open on esc-to-close and lets
// left/right cycle tabs, since it has no filter input to consume them.
func (m Model) updateApprovalTab(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case msg.String() == "esc":
		m.overlayOpen = false
	case msg.String() == "left":
		m.cycleOverlay(-1)
	case msg.String() == "right":
		m.cycleOverlay(1)
	case m.moveApprovalCursor(msg.String()):
	case msg.String() == "enter":
		m.applyApprovalCursor()
	}
	m.reflow()
	return m, nil
}

// updateModelTab drives the Model tab inside the overlay, sharing the list,
// filter, and custom-id behaviour with the standalone picker.
func (m Model) updateModelTab(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.modelCustom {
		switch msg.String() {
		case "esc":
			m.modelCustom = false
			m.modelInput.Blur()
		case "enter":
			if value := strings.TrimSpace(m.modelInput.Value()); value != "" {
				m.selectModel(value)
				m.modelCustom = false
				m.modelInput.Blur()
				m.overlayOpen = false
			}
		default:
			var cmd tea.Cmd
			m.modelInput, cmd = m.modelInput.Update(msg)
			m.reflow()
			return m, cmd
		}
		m.reflow()
		return m, nil
	}

	visible := m.visibleModels()
	switch msg.String() {
	case "esc":
		if m.modelFilter != "" {
			m.modelFilter = ""
			m.modelCursor = 0
		} else {
			m.overlayOpen = false
		}
	case "left":
		if m.modelFilter == "" {
			m.cycleOverlay(-1)
		}
	case "right":
		if m.modelFilter == "" {
			m.cycleOverlay(1)
		}
	case "backspace":
		if len(m.modelFilter) > 0 {
			m.modelFilter = m.modelFilter[:len(m.modelFilter)-1]
			m.modelCursor = 0
		}
	case "up":
		if m.modelCursor > 0 {
			m.modelCursor--
		}
	case "down":
		if m.modelCursor < len(visible) {
			m.modelCursor++
		}
	case "enter":
		if m.modelCursor == len(visible) {
			m.modelCustom = true
			m.modelInput.Reset()
			m.modelInput.Focus()
		} else if len(visible) > 0 && visible[m.modelCursor].Available {
			m.selectModel(visible[m.modelCursor].ID)
			m.overlayOpen = false
		} else if len(visible) > 0 {
			m.notices.Add(NoticeWarn, "model unavailable", visible[m.modelCursor].Reason, "switch profile to use it")
		}
	default:
		if msg.Type == tea.KeyRunes && len(msg.Runes) > 0 {
			// '/' clears the filter to start a fresh query; other runes extend it.
			if string(msg.Runes) == "/" {
				m.modelFilter = ""
			} else {
				m.modelFilter += string(msg.Runes)
			}
			m.modelCursor = 0
		}
	}
	m.reflow()
	return m, nil
}

func (m Model) updateModelPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.modelCustom {
		switch msg.String() {
		case "esc":
			m.modelCustom = false
			m.modelInput.Blur()
		case "enter":
			if value := strings.TrimSpace(m.modelInput.Value()); value != "" {
				m.selectModel(value)
				m.modelCustom = false
				m.modelInput.Blur()
			}
		default:
			var cmd tea.Cmd
			m.modelInput, cmd = m.modelInput.Update(msg)
			m.reflow()
			return m, cmd
		}
		m.reflow()
		return m, nil
	}
	visible := m.visibleModels()
	switch msg.String() {
	case "esc":
		if m.modelFilter != "" {
			m.modelFilter = ""
			m.modelCursor = 0
			m.reflow()
			return m, nil
		}
		m.modelPicker = false
	case "/":
		m.modelFilter = ""
		m.modelCursor = 0
	case "backspace":
		if len(m.modelFilter) > 0 {
			m.modelFilter = m.modelFilter[:len(m.modelFilter)-1]
			m.modelCursor = 0
		}
	case "up":
		if m.modelCursor > 0 {
			m.modelCursor--
		}
	case "down":
		if m.modelCursor < len(visible) {
			m.modelCursor++
		}
	case "enter":
		if m.modelCursor == len(visible) {
			m.modelCustom = true
			m.modelInput.Reset()
			m.modelInput.Focus()
		} else if len(visible) > 0 && visible[m.modelCursor].Available {
			m.selectModel(visible[m.modelCursor].ID)
			m.modelPicker = false
		}
	default:
		if msg.Type == tea.KeyRunes && len(msg.Runes) > 0 {
			m.modelFilter += string(msg.Runes)
			m.modelCursor = 0
		}
	}
	m.reflow()
	return m, nil
}

func (m *Model) selectModel(id string) {
	m.model = id
	m.send(protocol.SetModel(id))
	if m.prefs.ModelByProfile == nil {
		m.prefs.ModelByProfile = map[string]string{}
	}
	m.prefs.ModelByProfile[m.profile] = id
	_ = m.prefs.Save("")
	m.notices.Add(NoticeInfo, "model selected", id, "applies next turn")
}

func (m Model) visibleModels() []protocol.ModelInfo {
	if m.modelFilter == "" {
		return append([]protocol.ModelInfo{}, m.modelOptions...)
	}
	query := strings.ToLower(m.modelFilter)
	visible := make([]protocol.ModelInfo, 0)
	for _, model := range m.modelOptions {
		if strings.Contains(strings.ToLower(model.ID), query) || strings.Contains(strings.ToLower(model.Label), query) {
			visible = append(visible, model)
		}
	}
	return visible
}

func (m Model) updateOverlay(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.overlayTab == "skills" && m.skillEditing {
		return m.updateSkillEditor(msg)
	}
	if m.overlayTab == "tasks" && m.taskEditing {
		return m.updateTaskEditor(msg)
	}
	if m.overlayTab == "skills" && msg.String() == "esc" && m.skillConfirm != "" {
		m.skillConfirm = ""
		m.reflow()
		return m, nil
	}
	if msg.String() == "esc" {
		m.overlayOpen = false
		m.reflow()
		return m, nil
	}
	// Tab always cycles; left/right only cycle when the active tab is not
	// using them for its own navigation (the model filter consumes runes).
	if msg.String() == "tab" {
		m.cycleOverlay(1)
		m.reflow()
		return m, nil
	}
	if m.overlayTab == "model" {
		return m.updateModelTab(msg)
	}
	if m.overlayTab == "approval" {
		return m.updateApprovalTab(msg)
	}
	if m.overlayTab == "tasks" {
		return m.updateTasksTab(msg)
	}
	if msg.String() == "right" {
		m.cycleOverlay(1)
	} else if msg.String() == "left" {
		m.cycleOverlay(-1)
	} else if m.overlayTab == "skills" && msg.String() == "m" {
		m.send(protocol.SkillsMine())
	} else if m.overlayTab == "skills" && msg.String() == "r" {
		m.send(protocol.SkillsList())
	} else if m.overlayTab == "skills" && msg.String() == "ctrl+u" {
		m.skillPreviewOffset = maxInt(0, m.skillPreviewOffset-5)
	} else if m.overlayTab == "skills" && msg.String() == "ctrl+d" {
		m.skillPreviewOffset += 5
	} else if m.overlayTab == "skills" && msg.String() == "up" {
		if m.skillCursor > 0 {
			m.skillCursor--
		}
	} else if m.overlayTab == "skills" && msg.String() == "down" {
		if m.skillCursor < len(m.proposedSkills)+len(m.installedSkills)-1 {
			m.skillCursor++
		}
	} else if m.overlayTab == "skills" && msg.String() == "enter" {
		if skill, ok := m.selectedSkill(); ok {
			m.send(protocol.SkillGet(skill.Name, skill.Source))
		}
	} else if m.overlayTab == "skills" && (msg.String() == "p" || msg.String() == "d") {
		if skill, ok := m.selectedSkill(); ok {
			action := msg.String()
			if m.skillConfirm != action {
				m.skillConfirm = action
				verb := "promote"
				if action == "d" {
					verb = "discard"
				}
				m.notices.Add(NoticeWarn, "confirm "+verb, skill.Name+" · "+skill.Path, "press "+action+" again")
			} else {
				if action == "p" {
					m.send(protocol.SkillPromote(skill.Name))
				} else {
					m.send(protocol.SkillDiscard(skill.Name))
				}
				m.skillConfirm = ""
			}
		}
	} else if m.overlayTab == "skills" && msg.String() == "e" {
		if _, ok := m.selectedSkill(); ok && m.skillPreview != "" {
			m.skillEditing = true
			m.skillEditor.SetValue(m.skillPreview)
			m.skillEditor.Focus()
		}
	}
	m.reflow()
	return m, nil
}

// updateTaskEditor drives the tasks.json editor inside the Tasks overlay.
func (m Model) updateTaskEditor(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.taskEditing = false
		m.taskEditorError = ""
		m.taskEditor.Blur()
		m.reflow()
		return m, nil
	case "ctrl+s":
		m.saveTaskEditor()
		m.reflow()
		return m, nil
	}
	var cmd tea.Cmd
	m.taskEditor, cmd = m.taskEditor.Update(msg)
	m.taskEditorError = ""
	m.reflow()
	return m, cmd
}

// updateTasksTab drives the Tasks overlay list — the project's build, run and
// serve commands.
func (m Model) updateTasksTab(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	switch msg.String() {
	case "esc":
		m.overlayOpen = false
	case "left":
		m.cycleOverlay(-1)
	case "right":
		m.cycleOverlay(1)
	case "up":
		if m.taskCursor > 0 {
			m.taskCursor--
		}
	case "down":
		if m.taskCursor < len(m.tasks)-1 {
			m.taskCursor++
		}
	case "enter":
		if m.taskCursor >= 0 && m.taskCursor < len(m.tasks) {
			cmd = m.toggleTask(m.tasks[m.taskCursor].ID)
			m.overlayOpen = false
		}
	case "e":
		m.openTaskEditor(TasksJSON(m.tasks))
	case "d":
		m.openTaskEditor(TasksJSON(DetectTasks(m.workingDir)))
		m.notices.Add(NoticeInfo, "detected tasks from project files", "review, then ^s to save", "nothing is written until you save")
	case "a":
		m.overlayOpen = false
		m.askAgentForTasks()
	case "r":
		m.refreshProject()
	}
	m.reflow()
	return m, cmd
}

func (m Model) updateSkillEditor(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if msg.String() == "esc" {
		if m.skillEditor.Value() != m.skillPreview && !m.skillEditorConfirm {
			m.skillEditorConfirm = true
			m.notices.Add(NoticeWarn, "unsaved skill changes", "press esc again to discard", "ctrl+s saves")
			m.reflow()
			return m, nil
		}
		m.skillEditorConfirm = false
		m.skillEditing = false
		m.skillEditor.Blur()
		m.reflow()
		return m, nil
	}
	if msg.String() == "ctrl+s" {
		if skill, ok := m.selectedSkill(); ok {
			if err := validateSkillDraft(m.skillEditor.Value()); err != nil {
				m.skillEditorError = err.Error()
				m.reflow()
				return m, nil
			}
			m.send(protocol.SkillSave(skill.Name, m.skillEditor.Value()))
			m.skillEditing = false
			m.skillEditor.Blur()
			m.skillEditorError = ""
		}
		m.reflow()
		return m, nil
	}
	var cmd tea.Cmd
	m.skillEditor, cmd = m.skillEditor.Update(msg)
	m.skillEditorConfirm = false
	m.skillEditorError = ""
	m.reflow()
	return m, cmd
}

// openOverlay opens the overlay on a tab and primes that tab's state — the
// model list has to be requested from the server or the tab renders empty.
func (m *Model) openOverlay(tab string) {
	valid := false
	for _, known := range overlayTabs {
		if known == tab {
			valid = true
		}
	}
	if !valid {
		tab = "model"
	}
	m.overlayOpen = true
	m.overlayTab = tab
	m.prefs.OverlayTab = tab
	_ = m.prefs.Save("")
	m.primeOverlayTab()
}

// primeOverlayTab resets per-tab transient state and fetches whatever the tab
// needs to render.
func (m *Model) primeOverlayTab() {
	switch m.overlayTab {
	case "model":
		m.modelFilter = ""
		m.modelCustom = false
		m.modelInput.Blur()
		m.modelCursor = 0
		for i, option := range m.modelOptions {
			if option.ID == m.model {
				m.modelCursor = i
			}
		}
		m.send(protocol.ModelsList())
	case "approval":
		m.yoloConfirm = false
		for i, mode := range approvalModes {
			if mode == m.approvalMode {
				m.approvalCursor = i
			}
		}
	case "skills":
		m.skillConfirm = ""
		m.send(protocol.SkillsList())
	case "tasks":
		m.taskEditing = false
		m.taskEditorError = ""
		m.taskEditor.Blur()
		m.refreshProject()
	}
}

func (m *Model) cycleOverlay(delta int) {
	index := 0
	for i, tab := range overlayTabs {
		if tab == m.overlayTab {
			index = i
		}
	}
	index = (index + delta + len(overlayTabs)) % len(overlayTabs)
	m.overlayTab = overlayTabs[index]
	m.prefs.OverlayTab = m.overlayTab
	_ = m.prefs.Save("")
	m.primeOverlayTab()
}

func (m Model) selectedSkill() (protocol.SkillSummary, bool) {
	all := append(append([]protocol.SkillSummary{}, m.proposedSkills...), m.installedSkills...)
	if m.skillCursor < 0 || m.skillCursor >= len(all) {
		return protocol.SkillSummary{}, false
	}
	return all[m.skillCursor], true
}

func matches(msg tea.KeyMsg, binding interface {
	Enabled() bool
	Keys() []string
}) bool {
	if !binding.Enabled() {
		return false
	}
	for _, pressed := range binding.Keys() {
		if msg.String() == pressed {
			return true
		}
	}
	return false
}

func (m *Model) submit() tea.Cmd {
	content := m.composer.Submit()
	// Attachments alone are a valid message — dropping a file and pressing
	// enter should send it without requiring accompanying text.
	if content == "" && len(m.attachments) == 0 {
		return nil
	}
	if m.running {
		m.queue = append(m.queue, content)
		m.notices.Add(NoticeInfo, "message queued", fmt.Sprintf("%d waiting", len(m.queue)), "ctrl+x clears queue")
		return nil
	}
	if cmd, handled := m.handleSlash(content); handled {
		m.reflow()
		return cmd
	}
	if strings.HasPrefix(content, "!") {
		if m.approvalMode == "strict" {
			m.notices.Add(NoticeWarn, "local shell disabled", "strict mode blocks ! commands", "switch to bash or danger")
			m.reflow()
			return nil
		}
		command, cancel := runLocalCommand(strings.TrimSpace(strings.TrimPrefix(content, "!")), m.workingDir)
		m.localCancel = cancel
		return command
	}
	if strings.HasPrefix(content, "#") {
		memory := strings.TrimSpace(strings.TrimPrefix(content, "#"))
		if memory == "" {
			m.notices.Add(NoticeInfo, "remember what?", "type # followed by a preference", "")
			m.reflow()
			return nil
		}
		m.transcript.Turns = append(m.transcript.Turns, Turn{Role: "memory", Text: memory, Time: time.Now().Format("15:04")})
		m.startAgentMessage("Remember this user preference using MemoryWrite: " + memory)
		return nil
	}
	m.startMessage(content)
	return nil
}

func (m *Model) startMessage(content string) {
	now := time.Now()
	m.turnTokensOut = m.tokensOut
	m.turnCost = m.costUSD

	// The bubble shows a compact attachment line; the wire payload carries the
	// inlined file contents so the transcript stays readable.
	bubble := content
	payload := content + attachmentsBlock(m.attachments)
	if len(m.attachments) > 0 {
		names := make([]string, 0, len(m.attachments))
		for _, attachment := range m.attachments {
			names = append(names, attachment.Display)
		}
		line := "📎 " + strings.Join(names, ", ")
		if bubble == "" {
			bubble = line
		} else {
			bubble += "\n" + line
		}
		m.attachments = nil
	}

	m.transcript.Turns = append(m.transcript.Turns,
		Turn{Role: "user", Text: bubble, Time: now.Format("15:04")},
		Turn{Role: "agent", Time: now.Format("15:04"), Started: now},
	)
	m.running = true
	m.send(protocol.Message(payload))
}

func (m *Model) startAgentMessage(content string) {
	now := time.Now()
	m.turnTokensOut = m.tokensOut
	m.turnCost = m.costUSD
	m.transcript.Turns = append(m.transcript.Turns, Turn{Role: "agent", Time: now.Format("15:04"), Started: now})
	m.running = true
	m.send(protocol.Message(content))
}

func (m *Model) handleSlash(content string) (tea.Cmd, bool) {
	command, args, ok := slashCommand(content)
	if !ok {
		return nil, false
	}
	var deferred tea.Cmd
	switch command {
	case "approval":
		if args == "" {
			m.openOverlay("approval")
			m.reflow()
			return nil, true
		}
		for _, mode := range []string{"strict", "bash", "danger", "yolo"} {
			if args == mode {
				m.approvalMode = mode
				m.send(protocol.SetApprovalMode(mode))
				m.persistApprovalMode()
				m.notices.Add(NoticeInfo, "approval mode", mode, "")
				return nil, true
			}
		}
		m.notices.Add(NoticeError, "unknown approval mode", args, "use strict, bash, danger, or yolo")
	case "clear":
		m.transcript.Turns = nil
	case "help":
		m.notices.Add(NoticeInfo, "commands", slashHelp(), "")
	case "quit":
		m.notices.Add(NoticeInfo, "quit", "press ctrl+c to exit", "")
	case "model":
		if args != "" {
			m.selectModel(args)
		} else {
			m.openOverlay("model")
		}
	case "compact":
		m.send(protocol.Compact())
	case "theme":
		name := args
		if name == "" {
			name = nextTheme(m.prefs.Theme)
		}
		m.prefs.Theme = ApplyTheme(name)
		_ = m.prefs.Save("")
		m.notices.Add(NoticeInfo, "theme", m.prefs.Theme, "")
	case "density":
		name := args
		if name == "" {
			name = nextDensity(m.density)
		}
		switch name {
		case "full", "normal", "compact":
			m.density = name
			m.prefs.DensityMode = name
			_ = m.prefs.Save("")
			m.notices.Add(NoticeInfo, "density", name, "")
		default:
			m.notices.Add(NoticeError, "unknown density", name, "use full, normal, or compact")
		}
	case "skills":
		m.openOverlay("skills")
		if args == "mine" {
			m.send(protocol.SkillsMine())
		}
	case "git":
		action, rest, _ := strings.Cut(args, " ")
		if action == "" {
			action = "status"
		}
		// The slash form is the deliberate one: skip the click-twice arming
		// the rail buttons use, since the user has already typed the verb.
		if _, needs := gitNeedsConfirm[action]; needs {
			m.gitConfirm = action
		}
		deferred = m.startGitAction(action, rest)
	case "tasks":
		action, rest, _ := strings.Cut(args, " ")
		switch action {
		case "", "list":
			m.openOverlay("tasks")
		case "edit":
			m.openTaskEditor(TasksJSON(m.tasks))
		case "detect":
			m.openTaskEditor(TasksJSON(DetectTasks(m.workingDir)))
			m.notices.Add(NoticeInfo, "detected tasks from project files", "review, then ^s to save", "nothing is written until you save")
		case "ask":
			m.askAgentForTasks()
		case "run", "stop":
			if strings.TrimSpace(rest) == "" {
				m.notices.Add(NoticeError, "which task?", "/tasks "+action+" <id>", m.taskIDList())
			} else {
				deferred = m.toggleTask(strings.TrimSpace(rest))
			}
		default:
			m.notices.Add(NoticeError, "unknown tasks action", action, "list · edit · detect · ask · run <id> · stop <id>")
		}
	default:
		m.notices.Add(NoticeError, "unknown command", "/"+command, slashHelp())
	}
	m.reflow()
	return deferred, true
}

// taskIDList is the "did you mean" line for task commands.
func (m Model) taskIDList() string {
	if len(m.tasks) == 0 {
		return "no tasks configured · /tasks detect"
	}
	ids := make([]string, 0, len(m.tasks))
	for _, task := range m.tasks {
		ids = append(ids, task.ID)
	}
	return strings.Join(ids, " · ")
}

func (m *Model) persistApprovalMode() {
	if m.prefs.ApprovalModeByProfile == nil {
		m.prefs.ApprovalModeByProfile = map[string]string{}
	}
	m.prefs.ApprovalModeByProfile[m.profile] = m.approvalMode
	_ = m.prefs.Save("")
}

func (m *Model) send(message protocol.ClientMessage) {
	if m.sender != nil {
		m.sender.Send(message)
	}
}

func (m *Model) scheduleMentionIndex() tea.Cmd {
	value := m.composer.Value()
	if _, ok := activeMentionQuery(value); !ok {
		m.mentionValue = ""
		m.mentionMatches = nil
		m.mentionCapped = false
		return nil
	}
	m.mentionValue = value
	return mentionIndexCmd(value, m.workingDir)
}

func (m *Model) currentAgent() *Turn {
	if len(m.transcript.Turns) == 0 || m.transcript.Turns[len(m.transcript.Turns)-1].Role != "agent" {
		m.transcript.Turns = append(m.transcript.Turns, Turn{Role: "agent", Time: time.Now().Format("15:04"), Started: time.Now()})
	}
	return &m.transcript.Turns[len(m.transcript.Turns)-1]
}

func (m *Model) handleServerMessage(msg protocol.ServerMessage) {
	switch msg.Type {
	case "session_ready":
		m.contextWarned = false
		m.sessionID = msg.SessionID
		if msg.Model != "" {
			m.model = msg.Model
		}
		if msg.Profile != "" {
			m.profile = msg.Profile
		}
		if msg.WorkingDir != "" {
			m.workingDir = msg.WorkingDir
		}
		if msg.Yolo {
			m.approvalMode = "yolo"
		}
		if remembered := m.prefs.ApprovalModeByProfile[m.profile]; remembered != "" && remembered != m.approvalMode && !msg.Yolo {
			if remembered == "strict" || remembered == "bash" || remembered == "danger" || remembered == "yolo" {
				m.approvalMode = remembered
				m.send(protocol.SetApprovalMode(remembered))
			}
		}
		if remembered := m.prefs.ModelByProfile[m.profile]; remembered != "" && remembered != m.model {
			m.send(protocol.SetModel(remembered))
			m.notices.Add(NoticeInfo, "remembered model applied", remembered, "applies to this session")
		}
	case "models":
		m.modelOptions = msg.Models
		for i, option := range m.modelOptions {
			if option.ID == msg.Current {
				m.modelCursor = i
				break
			}
		}
	case "model_changed":
		m.model = msg.Model
		m.notices.Add(NoticeInfo, "model changed", msg.Model, "")
	case "todos":
		m.todos = msg.Todos
	case "artifacts":
		m.artifacts = append(m.artifacts, msg.Artifacts...)
	case "skills":
		m.proposedSkills = msg.Proposed
		m.installedSkills = msg.Installed
		if m.skillCursor >= len(m.proposedSkills)+len(m.installedSkills) {
			m.skillCursor = maxInt(0, len(m.proposedSkills)+len(m.installedSkills)-1)
		}
	case "skill_content":
		m.skillPreview = msg.Content
		m.skillPreviewOffset = 0
	case "skill_result":
		detail, suggestion := msg.Name, "refresh skills to see current state"
		if msg.Action == "promoted" {
			detail = msg.Name + " → " + msg.Path
			suggestion = "takes effect on next server start"
		} else if msg.Action == "discarded" {
			suggestion = "recoverable at " + msg.Path
		}
		m.notices.Add(NoticeInfo, "skill "+msg.Action, detail, suggestion)
		if msg.Action == "saved" {
			if skill, ok := m.selectedSkill(); ok {
				m.send(protocol.SkillGet(skill.Name, skill.Source))
			}
		}
	case "approval_mode_changed":
		if msg.Mode != "" {
			m.approvalMode = msg.Mode
		}
	case "token":
		m.running = true
		m.currentAgent().Text += msg.Content
	case "tool_start":
		m.running = true
		m.activeTool = msg.Name
		m.activeToolStarted = time.Now()
		agent := m.currentAgent()
		category, _ := categorize(msg.Name)
		agent.Sections = append(agent.Sections, Section{Name: msg.Name, Arg: summarizeInput(msg.Input), State: SectionRunning, Motion: m.transcript.Motion, RevealAt: -1, Category: category})
	case "tool_end":
		agent := m.currentAgent()
		for i := len(agent.Sections) - 1; i >= 0; i-- {
			section := &agent.Sections[i]
			if section.Name == msg.Name && section.State == SectionRunning {
				section.Body = truncateToolResult(msg.Result)
				section.State = SectionDone
				if strings.HasPrefix(msg.Result, "Error:") {
					section.State = SectionError
				}
				break
			}
		}
		if m.activeTool == msg.Name {
			m.activeTool = ""
			m.activeToolStarted = time.Time{}
		}
	case "stats":
		m.tokensIn = msg.TokensIn
		m.tokensOut = msg.TokensOut
		m.costUSD = maxFloat(m.costUSD, msg.CostUSD)
		m.contextTokens = msg.ContextTokens
		m.contextWindow = msg.ContextWindow
		if m.contextWindow > 0 && m.contextTokens*100 >= m.contextWindow*80 && !m.contextWarned {
			m.contextWarned = true
			m.notices.Add(NoticeWarn, "context above 80%", "conversation is nearing the model limit", "run /compact")
		}
		m.currentAgent().Tokens = msg.TokensOut
	case "session_end":
		m.running = false
		m.activeTool = ""
		m.activeToolStarted = time.Time{}
		agent := m.currentAgent()
		if !agent.Started.IsZero() {
			elapsed := time.Since(agent.Started)
			agent.Elapsed = fmt.Sprintf("%.1fs", elapsed.Seconds())
			if elapsed > 20*time.Second && !m.focused && !m.noNotify && m.notifyTTY {
				m.notifyPending = true
			}
		}
		if m.transcript.Motion {
			agent.Pulse = 4
		}
		agent.Tokens = maxInt(0, m.tokensOut-m.turnTokensOut)
		agent.Cost = maxFloat(0, m.costUSD-m.turnCost)
		if len(m.queue) > 0 {
			next := m.queue[0]
			m.queue = m.queue[1:]
			m.startMessage(next)
		}
	case "error":
		m.running = false
		m.addServerError(msg.Message)
	case "tool_prompt":
		m.pendingApproval = &ApprovalRequest{ID: msg.ID, Name: msg.Name, Input: msg.Input, Risk: msg.Risk, Reason: msg.Reason}
		agent := m.currentAgent()
		for i := len(agent.Sections) - 1; i >= 0; i-- {
			section := &agent.Sections[i]
			if section.Name == msg.Name && section.State == SectionRunning {
				section.AwaitingApproval = true
				break
			}
		}
	case "input_request":
		m.pendingInput = newInputRequest(msg.ID, msg.Prompt, msg.Kind, msg.Options)
	case "notice":
		if msg.Message == "ambiguous tools classified" || strings.HasPrefix(msg.Message, "ambiguous tools classified") {
			if m.prefs.SeenNotices != nil && m.prefs.SeenNotices[m.profile+":safety-classifier"] {
				return
			}
			if m.prefs.SeenNotices == nil {
				m.prefs.SeenNotices = map[string]bool{}
			}
			m.prefs.SeenNotices[m.profile+":safety-classifier"] = true
			_ = m.prefs.Save("")
		}
		m.notices.Add(NoticeLevel(msg.Level), msg.Message, msg.Detail, "")
	}
}

func (m *Model) addServerError(message string) {
	lower := strings.ToLower(message)
	suggestion := ""
	if strings.Contains(lower, "unknown model") {
		suggestion = "run /model"
	}
	if strings.Contains(lower, "api key") || strings.Contains(lower, "provider api key") {
		suggestion = "check profile model.api_key_env"
	}
	m.notices.Add(NoticeError, message, "", suggestion)
}

func summarizeInput(input map[string]interface{}) string {
	if len(input) == 0 {
		return ""
	}
	b, err := json.Marshal(input)
	if err != nil {
		return "input"
	}
	return truncate(string(b), 48)
}

func truncateToolResult(result string) string {
	lines := strings.Split(result, "\n")
	if len(lines) <= 40 {
		return result
	}
	return strings.Join(lines[:40], "\n") + fmt.Sprintf("\n… %d more lines", len(lines)-40)
}

func (m *Model) reflow() {
	width := maxInt(1, m.width)
	// The composer, notices and status bar span the full terminal; only the
	// transcript gives up columns to the rail, which keeps the rail a fixed
	// column beside the scrollback rather than a sidebar around everything.
	m.composer.SetWidth(width)
	m.transcript.Density = m.density
	m.syncTaskTurns()

	contentWidth := m.contentWidth()
	noticeHeight := lipgloss.Height(m.notices.View(width))
	composerHeight := m.composer.Height()
	attachmentHeight := 0
	if len(m.attachments) > 0 {
		attachmentHeight = lipgloss.Height(attachmentBar(m.attachments, width))
	}
	m.viewport.Width = contentWidth
	content := m.transcript.Render(contentWidth, m.frame)
	if len(m.artifacts) > 0 {
		artifactLines := make([]string, 0, len(m.artifacts))
		for _, artifact := range m.artifacts {
			artifactLines = append(artifactLines, renderArtifact(artifact, contentWidth))
		}
		content = lipgloss.JoinVertical(lipgloss.Left, content, strings.Join(artifactLines, "\n\n"))
	}
	if len(m.queue) > 0 {
		queued := make([]string, 0, len(m.queue))
		for _, message := range m.queue {
			queued = append(queued, StFaint.Render("queued ⏳  "+truncate(message, maxInt(1, contentWidth-12))))
		}
		content = lipgloss.JoinVertical(lipgloss.Left, content, strings.Join(queued, "\n"))
	}
	if content == "" {
		content = heroView(m.workingDir, m.git, m.tasks, contentWidth)
	}

	m.contentLines = lipgloss.Height(content)
	available := maxInt(1, m.height-2-noticeHeight-composerHeight-attachmentHeight)
	hintHeight := 0
	if !m.follow && m.contentLines > available-1 {
		hintHeight = 1
	}
	m.viewport.Height = maxInt(1, available-hintHeight)
	m.viewport.SetContent(content)
	if m.follow {
		m.viewport.GotoBottom()
	}
	m.reflowRail()
}

// reflowRail renders the rail to exactly the transcript's height and records
// where its buttons landed, so a later click resolves against this same frame.
func (m *Model) reflowRail() {
	if !m.railShown() {
		m.railBlock, m.railHits = "", nil
		return
	}
	activeElapsed := ""
	if !m.activeToolStarted.IsZero() {
		activeElapsed = fmt.Sprintf("%.1fs", time.Since(m.activeToolStarted).Seconds())
	}
	m.railBlock, m.railHits = railView(RailInput{
		Profile:       m.profile,
		Model:         m.model,
		Approval:      m.approvalMode,
		Session:       m.sessionID,
		Running:       m.running,
		ActiveTool:    m.activeTool,
		ActiveElapsed: activeElapsed,
		Todos:         m.todos,
		Artifacts:     m.artifacts,
		ContextTokens: m.contextTokens,
		ContextWindow: m.contextWindow,
		Spark:         m.spark,
		Git:           m.git,
		GitBusy:       m.gitBusy,
		GitConfirm:    m.gitConfirm,
		Tasks:         m.tasks,
		TaskState:     m.taskStates(),
		TasksDetected: m.tasksDetected,
		Height:        m.viewport.Height,
		Frame:         m.frame,
	})
}

func (m Model) View() string {
	// The body row is [transcript | scrollbar | rail]; everything else spans
	// the full width above or below it.
	body := lipgloss.JoinHorizontal(lipgloss.Top,
		m.viewport.View(),
		scrollbarView(m.viewport.Height, m.viewport.Height, m.contentLines, m.viewport.YOffset),
	)
	if m.railShown() {
		body = lipgloss.JoinHorizontal(lipgloss.Top, body, m.railBlock)
	}
	parts := []string{
		topBar(m.profile, m.sessionID, m.connected, m.running, m.frame, time.Now(), m.width),
		body,
	}
	if hint := scrollHint(m.follow, m.viewport.Height, m.contentLines, m.viewport.YOffset, m.width); hint != "" {
		parts = append(parts, hint)
	}
	if notices := m.notices.View(m.width); notices != "" {
		parts = append(parts, notices)
	}
	if suggestions := slashMatches(m.composer.Value()); len(suggestions) > 0 {
		parts = append(parts, StDim.Render(strings.Join(suggestions, "  ")))
	} else if m.mentionValue == m.composer.Value() && len(m.mentionMatches) > 0 {
		hint := strings.Join(m.mentionMatches[:minInt(5, len(m.mentionMatches))], "  ")
		if m.mentionCapped {
			hint += "  " + StFaint.Render("showing first 20k")
		}
		parts = append(parts, StDim.Render(hint))
	}
	if chips := attachmentBar(m.attachments, m.width); chips != "" {
		parts = append(parts, chips)
	}
	parts = append(parts,
		m.composer.View(),
		statusBar(m.running, m.model, m.approvalMode, m.tokensIn, m.tokensOut, m.displayCost, m.contextTokens, m.contextWindow, len(m.queue), m.width, m.frame),
	)
	background := lipgloss.JoinVertical(lipgloss.Left, parts...)
	if m.pendingApproval != nil {
		return Center(background, approvalModal(*m.pendingApproval, m.width, m.height), m.width, m.height)
	}
	if m.pendingInput != nil {
		return Center(background, inputModal(m.pendingInput, m.width, m.height), m.width, m.height)
	}
	if m.helpOpen {
		return Center(background, helpView(m.keys, m.width, m.height), m.width, m.height)
	}
	if m.approvalPicker {
		return Center(background, approvalPicker(m.approvalMode, m.approvalCursor, m.width, m.height), m.width, m.height)
	}
	if m.modelPicker {
		return Center(background, modelPicker(m.modelOptions, m.modelCursor, m.modelFilter, m.modelCustom, m.modelInput.View(), m.width, m.height), m.width, m.height)
	}
	if m.overlayOpen {
		body := skillsPlaceholder()
		if m.overlayTab == "model" {
			body = modelBody(m.modelOptions, m.modelCursor, m.modelFilter, m.modelCustom, m.modelInput.View(), modalInnerWidth(m.width))
		} else if m.overlayTab == "approval" {
			body = approvalBody(m.approvalMode, m.approvalCursor, modalInnerWidth(m.width))
		} else if m.overlayTab == "skills" {
			body = skillsTab(m.proposedSkills, m.installedSkills, m.skillCursor, m.skillPreview, m.skillPreviewOffset, m.skillEditing, m.skillEditor.View(), m.skillEditorError, m.width)
		} else if m.overlayTab == "tasks" {
			body = tasksTab(m.tasks, m.taskCursor, m.taskStates(), m.tasksDetected, taskConfigPath(m.workingDir), m.taskEditing, m.taskEditor.View(), m.taskEditorError, m.width)
		}
		return Center(background, tabsView(m.overlayTab, m.width, m.height, body), m.width, m.height)
	}
	return background
}
