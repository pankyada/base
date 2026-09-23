package ui

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"harness-tui/internal/prefs"
	"harness-tui/internal/protocol"
	"harness-tui/internal/ws"
)

func TestWorkflowMapObservationRevisionDedupAndGap(t *testing.T) {
	scope := protocol.WorkflowMapScope{RunID: "r1", SessionID: "s1", Profile: "coding"}
	state := newWorkflowMapState(scope)
	attempt := protocol.WorkflowMapAttempt{AttemptID: "a1", PassID: "p1", Stage: "recon", Attempt: 1, State: "running"}
	first := protocol.WorkflowMapObservation{EventID: "e1", Revision: 1, Kind: "attempt_started", Scope: scope, Attempt: &attempt}
	if accepted, gap := state.applyObservation(first); !accepted || gap {
		t.Fatalf("first observation accepted=%v gap=%v", accepted, gap)
	}
	if accepted, gap := state.applyObservation(first); accepted || gap || state.Revision != 1 {
		t.Fatalf("duplicate changed state: accepted=%v gap=%v revision=%d", accepted, gap, state.Revision)
	}
	wrong := first
	wrong.EventID, wrong.Revision, wrong.Scope.Profile = "e2", 2, "other"
	if accepted, _ := state.applyObservation(wrong); accepted || state.Revision != 1 {
		t.Fatalf("mismatched scope accepted: revision=%d", state.Revision)
	}
	gap := first
	gap.EventID, gap.Revision = "e3", 3
	if accepted, needsSnapshot := state.applyObservation(gap); accepted || !needsSnapshot || state.Availability.State != "partial" || state.Availability.Reason != "event_gap" {
		t.Fatalf("gap state accepted=%v request_snapshot=%v availability=%+v", accepted, needsSnapshot, state.Availability)
	}
	missing := first
	missing.EventID, missing.Revision = "e2", 2
	if accepted, _ := state.applyObservation(missing); !accepted || state.Availability.State != "partial" {
		t.Fatalf("late gap fill cleared partial before snapshot: accepted=%v availability=%+v", accepted, state.Availability)
	}
}

func TestWorkflowMapIncrementalProjectionCapsRetainedCollections(t *testing.T) {
	scope := protocol.WorkflowMapScope{RunID: "r-capped", SessionID: "s-capped", Profile: "coding"}
	state := newWorkflowMapState(scope)
	revision := uint64(0)
	apply := func(kind string, attempt *protocol.WorkflowMapAttempt, transition *protocol.WorkflowMapTransition, advice *protocol.WorkflowMapAdvice) {
		revision++
		accepted, gap := state.applyObservation(protocol.WorkflowMapObservation{
			EventID: fmt.Sprintf("event-%d", revision), Revision: revision, Kind: kind, Scope: scope,
			Attempt: attempt, Transition: transition, Advice: advice,
		})
		if !accepted || gap {
			t.Fatalf("observation revision %d accepted=%v gap=%v", revision, accepted, gap)
		}
	}
	for i := 0; i < workflowMapMaxAttempts+7; i++ {
		apply("attempt_started", &protocol.WorkflowMapAttempt{AttemptID: fmt.Sprintf("attempt-%d", i), Stage: "build", Attempt: i + 1, State: "running"}, nil, nil)
	}
	for i := 0; i < workflowMapMaxTransitions+9; i++ {
		apply("transition", nil, &protocol.WorkflowMapTransition{TransitionID: fmt.Sprintf("transition-%d", i), Kind: "continue"}, nil)
	}
	for i := 0; i < workflowMapMaxAdvice+5; i++ {
		apply("advice", nil, nil, &protocol.WorkflowMapAdvice{AdviceID: fmt.Sprintf("advice-%d", i), Kind: "route", Mode: "shadow"})
	}
	if len(state.Attempts) != workflowMapMaxAttempts || len(state.Transitions) != workflowMapMaxTransitions || len(state.Advice) != workflowMapMaxAdvice {
		t.Fatalf("projection collection bounds attempts=%d transitions=%d advice=%d", len(state.Attempts), len(state.Transitions), len(state.Advice))
	}
	if state.Attempts[0].AttemptID != "attempt-7" || state.Transitions[0].TransitionID != "transition-9" || state.Advice[0].AdviceID != "advice-5" {
		t.Fatalf("projection did not retain newest entries: first attempt=%q transition=%q advice=%q", state.Attempts[0].AttemptID, state.Transitions[0].TransitionID, state.Advice[0].AdviceID)
	}
	if state.Availability != (protocol.WorkflowMapAvailability{State: "partial", Reason: "retention_overflow"}) {
		t.Fatalf("trimmed projection must disclose partial history, got %+v", state.Availability)
	}
	if len(state.seenEvents) != workflowMapMaxSeenEvents || len(state.seenEventOrder) != workflowMapMaxSeenEvents {
		t.Fatalf("dedupe history not bounded: seen=%d order=%d", len(state.seenEvents), len(state.seenEventOrder))
	}
	if _, retained := state.seenEvents["event-1"]; retained {
		t.Fatal("old event ID remained in bounded dedupe window")
	}
	latestID := fmt.Sprintf("event-%d", revision)
	duplicate := protocol.WorkflowMapObservation{EventID: latestID, Revision: revision + 1, Kind: "transition", Scope: scope, Transition: &protocol.WorkflowMapTransition{TransitionID: "duplicate-transition", Kind: "continue"}}
	if accepted, gap := state.applyObservation(duplicate); accepted || gap || state.Revision != revision {
		t.Fatalf("duplicate ID in retained dedupe window accepted=%v gap=%v revision=%d", accepted, gap, state.Revision)
	}
}

func TestWorkflowMapSnapshotResetsDedupeOnlyForAcceptedExactScope(t *testing.T) {
	scope := protocol.WorkflowMapScope{RunID: "r-snapshot", SessionID: "s-snapshot", Profile: "coding"}
	state := newWorkflowMapState(scope)
	event := protocol.WorkflowMapObservation{EventID: "event-before-snapshot", Revision: 1, Kind: "transition", Scope: scope, Transition: &protocol.WorkflowMapTransition{TransitionID: "transition-before-snapshot", Kind: "start"}}
	if accepted, _ := state.applyObservation(event); !accepted {
		t.Fatal("initial observation rejected")
	}
	older := protocol.WorkflowMapSnapshot{Version: 1, Scope: scope, Revision: 0, Availability: protocol.WorkflowMapAvailability{State: "unavailable", Reason: "server_restarted"}}
	if state.applySnapshot(older) || len(state.seenEvents) != 1 {
		t.Fatal("older snapshot should be rejected without clearing dedupe state")
	}
	wrongScope := protocol.WorkflowMapSnapshot{Version: 1, Scope: protocol.WorkflowMapScope{RunID: scope.RunID, SessionID: scope.SessionID, Profile: "research"}, Revision: 5, Availability: protocol.WorkflowMapAvailability{State: "unavailable", Reason: "server_restarted"}}
	if state.applySnapshot(wrongScope) || len(state.seenEvents) != 1 {
		t.Fatal("mismatched snapshot should be rejected without clearing dedupe state")
	}
	unavailable := protocol.WorkflowMapSnapshot{Version: 1, Scope: scope, Revision: 5, Availability: protocol.WorkflowMapAvailability{State: "unavailable", Reason: "server_restarted"}}
	if !state.applySnapshot(unavailable) || state.Availability.State != "unavailable" || len(state.seenEvents) != 0 || len(state.seenEventOrder) != 0 {
		t.Fatalf("accepted unavailable snapshot did not reset scoped dedupe: state=%+v seen=%d order=%d", state.Availability, len(state.seenEvents), len(state.seenEventOrder))
	}
}

func TestWorkflowMapSnapshotRejectsOlderRevisionAndKeepsZeroCost(t *testing.T) {
	scope := protocol.WorkflowMapScope{RunID: "r1", SessionID: "s1", Profile: "coding"}
	state := newWorkflowMapState(scope)
	zero := 0.0
	newer := protocol.WorkflowMapSnapshot{Version: 1, Scope: scope, Revision: 5, Availability: protocol.WorkflowMapAvailability{State: "available"}, Attempts: []protocol.WorkflowMapAttempt{{AttemptID: "a1", Stage: "build", State: "done", CostUSD: &zero}}}
	if !state.applySnapshot(newer) {
		t.Fatal("newer snapshot rejected")
	}
	older := newer
	older.Revision = 4
	older.Availability = protocol.WorkflowMapAvailability{State: "empty"}
	if state.applySnapshot(older) || state.Revision != 5 || state.Availability.State != "available" {
		t.Fatalf("old snapshot replaced current projection: %+v", state)
	}
	view := stripANSI(workflowMapDetailsView(state, 0, 48, 20))
	if !strings.Contains(view, "cost: $0.0000") {
		t.Fatalf("known zero cost not rendered: %q", view)
	}
}

func TestWorkflowMapPathKeepsExploratoryTierActualAndSeparatesAdvice(t *testing.T) {
	scope := protocol.WorkflowMapScope{RunID: "r1", SessionID: "s1", Profile: "coding"}
	state := newWorkflowMapState(scope)
	state.Attempts = []protocol.WorkflowMapAttempt{
		{AttemptID: "a1", Stage: "recon", Attempt: 1, State: "failed"},
		{AttemptID: "a2", Stage: "build", Attempt: 1, State: "done"},
		{AttemptID: "shadow", Stage: "review", Attempt: 1, State: "done", Explore: true},
	}
	state.Transitions = []protocol.WorkflowMapTransition{
		{TransitionID: "t1", FromAttemptID: "a1", ToAttemptID: "a2", Kind: "fail_back"},
		{TransitionID: "t2", FromAttemptID: "a2", ToAttemptID: "shadow", Kind: "continue"},
	}
	state.Advice = []protocol.WorkflowMapAdvice{{AdviceID: "d1", Kind: "route", Mode: "shadow", Summary: "review"}}
	path := workflowMapPath(state)
	if !strings.Contains(path, "recon#1!") || !strings.Contains(path, "—fail_back→") || !strings.Contains(path, "review#1✓ [explore tier]") {
		t.Fatalf("path lost actual/exploratory stage or transition: %q", path)
	}
	view := stripANSI(workflowMapDetailsView(state, 0, 72, 22))
	if !strings.Contains(view, "Shadow suggestion") || !strings.Contains(view, "Advice · not an executed path") || !strings.Contains(view, "explore tier") {
		t.Fatalf("advice/exploration labels missing: %q", view)
	}
}

func TestWorkflowMapDetailsKeyPreservesComposerAndEscapeCloses(t *testing.T) {
	m := NewModel(&recordingSender{}, "coding", "tester", prefs.Preferences{})
	scope := protocol.WorkflowMapScope{RunID: "r1", SessionID: "s1", Profile: "coding"}
	state := newWorkflowMapState(scope)
	state.Attempts = []protocol.WorkflowMapAttempt{{AttemptID: "a1", Stage: "recon", Attempt: 1, State: "done"}, {AttemptID: "a2", Stage: "build", Attempt: 1, State: "running"}}
	m.workflowMaps = map[string]*WorkflowMapState{"r1": state}
	m.transcript.Turns = []Turn{{Role: "agent", RunID: "r1", WorkflowMap: state}}
	m.composer.input.SetValue("keep this draft")
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlG})
	m = updated.(Model)
	if !m.workflowDetailsOpen || m.composer.Value() != "keep this draft" {
		t.Fatalf("ctrl+g open=%v composer=%q", m.workflowDetailsOpen, m.composer.Value())
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m = updated.(Model)
	if m.workflowMapSelection != 1 {
		t.Fatalf("down selected attempt %d, want 1", m.workflowMapSelection)
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	m = updated.(Model)
	if m.workflowDetailsOpen || m.composer.Value() != "keep this draft" {
		t.Fatalf("escape open=%v composer=%q", m.workflowDetailsOpen, m.composer.Value())
	}
}

func TestWorkflowMapFramesRequireSelectedExactScopeAndAttachToRunTurn(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	m.sessionID = "s1"
	m.transcript.Turns = []Turn{{Role: "user", Text: "question"}, {Role: "agent", Text: "answer"}}
	m.handleServerMessage(protocol.ServerMessage{Type: "turn_start", RunID: "r1"})
	scope := protocol.WorkflowMapScope{RunID: "r1", SessionID: "s1", Profile: "coding"}
	attempt := protocol.WorkflowMapAttempt{AttemptID: "a1", PassID: "p1", Playbook: "coding", Stage: "build", Attempt: 1, State: "done"}
	valid := protocol.WorkflowMapSnapshot{Version: 1, Scope: scope, Revision: 2, Availability: protocol.WorkflowMapAvailability{State: "available"}, Attempts: []protocol.WorkflowMapAttempt{attempt}, Transitions: []protocol.WorkflowMapTransition{{TransitionID: "t1", ToAttemptID: "a1", Kind: "start"}}}
	wrong := valid
	wrong.Scope.Profile = "research"
	m.handleServerMessage(protocol.ServerMessage{Type: "workflow_map", WorkflowMapSnapshot: &wrong})
	if m.workflowMaps["r1"] != nil {
		t.Fatal("mismatched profile frame changed selected map")
	}
	m.handleServerMessage(protocol.ServerMessage{Type: "workflow_map", WorkflowMapSnapshot: &valid})
	if m.workflowMaps["r1"] == nil || m.transcript.Turns[1].WorkflowMap != m.workflowMaps["r1"] || m.transcript.Turns[1].RunID != "r1" {
		t.Fatalf("map not attached to its matching agent turn: %#v", m.transcript.Turns)
	}
	if got := stripANSI(m.transcript.Render(80, 0)); !strings.Contains(got, "MAP observed") || !strings.Contains(got, "entry → build#1✓") {
		t.Fatalf("compact path missing from transcript: %q", got)
	}
	m.handleServerMessage(protocol.ServerMessage{Type: "turn_start", RunID: "r2"})
	stale := valid
	stale.Scope.RunID = "r1"
	m.handleServerMessage(protocol.ServerMessage{Type: "workflow_map", WorkflowMapSnapshot: &stale})
	if m.activeRunID != "r2" || m.workflowMaps["r2"] != nil {
		t.Fatal("stale prior run was attached to the newly selected run")
	}
}

func TestWorkflowMapGapRequestsSnapshotAndShowsPartial(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	m.sessionID, m.activeRunID = "s1", "r1"
	m.transcript.Turns = []Turn{{Role: "agent", RunID: "r1"}}
	o := protocol.WorkflowMapObservation{EventID: "e2", Revision: 2, Kind: "attempt_started", Scope: protocol.WorkflowMapScope{RunID: "r1", SessionID: "s1", Profile: "coding"}, Attempt: &protocol.WorkflowMapAttempt{AttemptID: "a1", Stage: "build", Attempt: 1, State: "running"}}
	m.handleServerMessage(protocol.ServerMessage{Type: "workflow_map", WorkflowMapObservation: &o})
	if m.workflowMaps["r1"] == nil || m.workflowMaps["r1"].Availability.State != "partial" || m.transcript.Turns[0].WorkflowMap == nil {
		t.Fatalf("gap not retained visibly: state=%+v turn=%+v", m.workflowMaps["r1"], m.transcript.Turns)
	}
	if !m.workflowMapRecoveryPending || len(sender.messages) != 1 {
		t.Fatalf("snapshot recovery not requested: pending=%v sends=%d", m.workflowMapRecoveryPending, len(sender.messages))
	}
	encoded, err := json.Marshal(sender.messages[0])
	if err != nil || string(encoded) != `{"type":"workflow_map","scope":{"run_id":"r1","session_id":"s1","profile":"coding"}}` {
		t.Fatalf("recovery request=%s err=%v", encoded, err)
	}
	missing := o
	missing.EventID, missing.Revision = "e1", 1
	m.handleServerMessage(protocol.ServerMessage{Type: "workflow_map", WorkflowMapObservation: &missing})
	if m.workflowMaps["r1"].Availability.State != "partial" || !m.workflowMapRecoveryPending {
		t.Fatalf("late gap fill cleared partial before snapshot: %+v pending=%v", m.workflowMaps["r1"].Availability, m.workflowMapRecoveryPending)
	}
	snapshot := protocol.WorkflowMapSnapshot{Version: 1, Scope: o.Scope, Revision: 2, Availability: protocol.WorkflowMapAvailability{State: "available"}, Attempts: []protocol.WorkflowMapAttempt{*o.Attempt}}
	m.handleServerMessage(protocol.ServerMessage{Type: "workflow_map", WorkflowMapSnapshot: &snapshot})
	if m.workflowMaps["r1"].Availability.State != "available" || m.workflowMapRecoveryPending {
		t.Fatalf("authoritative snapshot did not resolve gap: %+v pending=%v", m.workflowMaps["r1"].Availability, m.workflowMapRecoveryPending)
	}
}

func TestWorkflowMapReconnectRequestsExactScopeAfterRevisionAndRetainsSnapshot(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	m.sessionID, m.activeRunID = "s1", "r1"
	scope := protocol.WorkflowMapScope{RunID: "r1", SessionID: "s1", Profile: "coding"}
	state := newWorkflowMapState(scope)
	state.Revision = 9
	state.Attempts = []protocol.WorkflowMapAttempt{{AttemptID: "a1", Stage: "verify", Attempt: 1, State: "running"}}
	m.workflowMaps["r1"] = state
	updated, cmd := m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_resumed", SessionID: "s1", Profile: "coding"}})
	m = updated.(Model)
	if !m.workflowMapRecoveryPending || m.workflowMaps["r1"] != state {
		t.Fatalf("resume cmd=%v pending=%v map-retained=%v", cmd != nil, m.workflowMapRecoveryPending, m.workflowMaps["r1"] == state)
	}
	if len(sender.messages) < 2 { // runtime subscribe plus map recovery
		t.Fatalf("resume sent only %d messages", len(sender.messages))
	}
	encoded, err := json.Marshal(sender.messages[len(sender.messages)-1])
	if err != nil || string(encoded) != `{"type":"workflow_map","scope":{"run_id":"r1","session_id":"s1","profile":"coding"},"after_revision":9}` {
		t.Fatalf("reconnect request=%s err=%v", encoded, err)
	}
	newer := protocol.WorkflowMapSnapshot{Version: 1, Scope: scope, Revision: 10, Availability: protocol.WorkflowMapAvailability{State: "available"}, Attempts: state.Attempts}
	m.handleServerMessage(protocol.ServerMessage{Type: "workflow_map", WorkflowMapSnapshot: &newer})
	if m.workflowMapRecoveryPending || state.Revision != 10 {
		t.Fatalf("recovery snapshot pending=%v revision=%d", m.workflowMapRecoveryPending, state.Revision)
	}
}

func TestWorkflowMapDetailsCoexistWithModalsAndSharedTabNavigation(t *testing.T) {
	m := NewModel(&recordingSender{}, "coding", "tester", prefs.Preferences{})
	state := newWorkflowMapState(protocol.WorkflowMapScope{RunID: "r1", SessionID: "s1", Profile: "coding"})
	state.Attempts = []protocol.WorkflowMapAttempt{{AttemptID: "a1", Stage: "build", Attempt: 1, State: "done"}}
	m.transcript.Turns = []Turn{{Role: "agent", RunID: "r1", WorkflowMap: state}}
	m.pendingInput = &InputRequest{ID: "ask-1", Prompt: "Choose", Kind: "text"}
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlG})
	m = updated.(Model)
	if m.workflowDetailsOpen {
		t.Fatal("map details opened over an input modal")
	}
	m.pendingInput = nil
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyCtrlG})
	m = updated.(Model)
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyTab})
	m = updated.(Model)
	if m.workflowDetailsOpen || !m.overlayOpen {
		t.Fatalf("Tab failed to transfer to shared overlay navigation: details=%v overlay=%v", m.workflowDetailsOpen, m.overlayOpen)
	}
	oldTab := m.overlayTab
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyRight})
	m = updated.(Model)
	if m.overlayTab == oldTab {
		t.Fatalf("shared right-tab navigation was swallowed while map detail was active: tab=%q", m.overlayTab)
	}
}

func TestWorkflowMapIsConditionalAndNarrowPathStaysWithinWidth(t *testing.T) {
	flat := Transcript{Turns: []Turn{{Role: "agent", Text: "flat response"}}}.Render(28, 0)
	if strings.Contains(stripANSI(flat), "MAP observed") {
		t.Fatalf("flat/unobserved transcript grew a map: %q", flat)
	}
	scope := protocol.WorkflowMapScope{RunID: "r1", SessionID: "s1", Profile: "coding"}
	state := newWorkflowMapState(scope)
	state.Attempts = []protocol.WorkflowMapAttempt{{AttemptID: "a1", Stage: "recon", Attempt: 1, State: "done"}}
	state.Transitions = []protocol.WorkflowMapTransition{{TransitionID: "t1", ToAttemptID: "a1", Kind: "start"}}
	line := renderWorkflowMapCompact(state, 28)
	if lipgloss.Width(line) > 28 || !strings.Contains(stripANSI(line), "MAP observed") {
		t.Fatalf("narrow map width=%d, line=%q", lipgloss.Width(line), line)
	}
	empty := newWorkflowMapState(scope)
	if !empty.applySnapshot(protocol.WorkflowMapSnapshot{Version: 1, Scope: scope, Availability: protocol.WorkflowMapAvailability{State: "empty"}}) || empty.Visible() {
		t.Fatal("empty workflow snapshot should not render a map")
	}
	unavailable := newWorkflowMapState(scope)
	if !unavailable.applySnapshot(protocol.WorkflowMapSnapshot{Version: 1, Scope: scope, Availability: protocol.WorkflowMapAvailability{State: "unavailable", Reason: "server_restarted"}}) || !unavailable.Visible() {
		t.Fatal("unavailable history must remain distinguishable from empty")
	}
}

func TestGenericStageFramesDoNotCreateObservedWorkflowMap(t *testing.T) {
	m := NewModel(&recordingSender{}, "coding", "tester", prefs.Preferences{})
	m.sessionID = "s1"
	m.handleServerMessage(protocol.ServerMessage{Type: "turn_start", RunID: "r1"})
	m.handleServerMessage(protocol.ServerMessage{Type: "stage", RunID: "r1", Stage: "recon", State: "done"})
	if len(m.workflowMaps) != 0 || m.currentAgent().WorkflowMap != nil {
		t.Fatalf("generic stage telemetry incorrectly established a map: maps=%d turn=%+v", len(m.workflowMaps), m.currentAgent())
	}
}
