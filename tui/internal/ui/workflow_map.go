package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"harness-tui/internal/protocol"
)

const (
	workflowMapMaxAttempts    = 48
	workflowMapMaxTransitions = 96
	workflowMapMaxAdvice      = 48
	workflowMapMaxSeenEvents  = 128
)

// WorkflowMapState is the client-side projection for one exact selected run.
// It is intentionally transient and contains only the bounded protocol data.
type WorkflowMapState struct {
	Scope                protocol.WorkflowMapScope
	Revision             uint64
	Availability         protocol.WorkflowMapAvailability
	Terminal             string
	Attempts             []protocol.WorkflowMapAttempt
	Transitions          []protocol.WorkflowMapTransition
	Advice               []protocol.WorkflowMapAdvice
	RetainedFromRevision *uint64
	seenEvents           map[string]struct{}
	seenEventOrder       []string
	awaitingSnapshot     bool
}

func newWorkflowMapState(scope protocol.WorkflowMapScope) *WorkflowMapState {
	return &WorkflowMapState{
		Scope:        scope,
		Availability: protocol.WorkflowMapAvailability{State: "available"},
		seenEvents:   map[string]struct{}{},
	}
}

func (s *WorkflowMapState) Visible() bool {
	return s != nil && s.Availability.State != "empty"
}

func (s *WorkflowMapState) applySnapshot(snapshot protocol.WorkflowMapSnapshot) bool {
	if snapshot.Version != 1 || snapshot.Revision < s.Revision || !sameWorkflowScope(snapshot.Scope, s.Scope) {
		return false
	}
	s.Revision = snapshot.Revision
	s.Availability = snapshot.Availability
	s.Terminal = snapshot.Terminal
	s.Attempts = append([]protocol.WorkflowMapAttempt(nil), snapshot.Attempts...)
	s.Transitions = append([]protocol.WorkflowMapTransition(nil), snapshot.Transitions...)
	s.Advice = append([]protocol.WorkflowMapAdvice(nil), snapshot.Advice...)
	truncated := s.capCollections()
	if truncated && s.Availability.State == "available" {
		s.Availability = protocol.WorkflowMapAvailability{State: "partial", Reason: "retention_overflow"}
	}
	s.RetainedFromRevision = snapshot.RetainedFromRevision
	s.awaitingSnapshot = snapshot.Availability.State == "partial" && snapshot.Availability.Reason == "event_gap"
	s.seenEvents = map[string]struct{}{}
	s.seenEventOrder = nil
	return true
}

// applyObservation accepts only the next revision. A gap is visible and asks
// the caller to fetch an authoritative snapshot; it never guesses the edge.
func (s *WorkflowMapState) applyObservation(o protocol.WorkflowMapObservation) (accepted, gap bool) {
	if !sameWorkflowScope(o.Scope, s.Scope) || o.EventID == "" || o.Revision == 0 {
		return false, false
	}
	if _, duplicate := s.seenEvents[o.EventID]; duplicate || o.Revision <= s.Revision {
		return false, false
	}
	if o.Revision != s.Revision+1 {
		s.Availability = protocol.WorkflowMapAvailability{State: "partial", Reason: "event_gap"}
		s.awaitingSnapshot = true
		return false, true
	}
	s.seenEvents[o.EventID] = struct{}{}
	s.seenEventOrder = append(s.seenEventOrder, o.EventID)
	if len(s.seenEventOrder) > workflowMapMaxSeenEvents {
		delete(s.seenEvents, s.seenEventOrder[0])
		s.seenEventOrder = append([]string(nil), s.seenEventOrder[1:]...)
	}
	s.Revision = o.Revision
	if !s.awaitingSnapshot && s.Availability.State == "available" {
		s.Availability = protocol.WorkflowMapAvailability{State: "available"}
	}
	switch o.Kind {
	case "attempt_started", "attempt_updated":
		if o.Attempt != nil && o.Attempt.AttemptID != "" {
			replaced := false
			for i := range s.Attempts {
				if s.Attempts[i].AttemptID == o.Attempt.AttemptID {
					s.Attempts[i] = *o.Attempt
					replaced = true
					break
				}
			}
			if !replaced {
				s.Attempts = append(s.Attempts, *o.Attempt)
				if s.capCollections() && s.Availability.State == "available" {
					s.Availability = protocol.WorkflowMapAvailability{State: "partial", Reason: "retention_overflow"}
				}
			}
		}
	case "transition":
		if o.Transition != nil && o.Transition.TransitionID != "" {
			if !hasTransition(s.Transitions, o.Transition.TransitionID) {
				s.Transitions = append(s.Transitions, *o.Transition)
				if s.capCollections() && s.Availability.State == "available" {
					s.Availability = protocol.WorkflowMapAvailability{State: "partial", Reason: "retention_overflow"}
				}
			}
		}
	case "advice":
		if o.Advice != nil && o.Advice.AdviceID != "" {
			if !hasAdvice(s.Advice, o.Advice.AdviceID) {
				s.Advice = append(s.Advice, *o.Advice)
				if s.capCollections() && s.Availability.State == "available" {
					s.Availability = protocol.WorkflowMapAvailability{State: "partial", Reason: "retention_overflow"}
				}
			}
		}
	case "terminal":
		s.Terminal = o.Terminal
	}
	return true, false
}

// capCollections bounds the client projection even if an upstream sends an
// oversized snapshot or an observer remains connected beyond server retention.
// Keeping the newest items preserves recent run state; partial availability
// makes the discarded path history explicit.
func (s *WorkflowMapState) capCollections() bool {
	truncated := false
	if len(s.Attempts) > workflowMapMaxAttempts {
		s.Attempts = append([]protocol.WorkflowMapAttempt(nil), s.Attempts[len(s.Attempts)-workflowMapMaxAttempts:]...)
		truncated = true
	}
	if len(s.Transitions) > workflowMapMaxTransitions {
		s.Transitions = append([]protocol.WorkflowMapTransition(nil), s.Transitions[len(s.Transitions)-workflowMapMaxTransitions:]...)
		truncated = true
	}
	if len(s.Advice) > workflowMapMaxAdvice {
		s.Advice = append([]protocol.WorkflowMapAdvice(nil), s.Advice[len(s.Advice)-workflowMapMaxAdvice:]...)
		truncated = true
	}
	return truncated
}

func sameWorkflowScope(a, b protocol.WorkflowMapScope) bool {
	return a.RunID == b.RunID && a.SessionID == b.SessionID && a.Profile == b.Profile
}

func hasTransition(items []protocol.WorkflowMapTransition, id string) bool {
	for _, item := range items {
		if item.TransitionID == id {
			return true
		}
	}
	return false
}

func hasAdvice(items []protocol.WorkflowMapAdvice, id string) bool {
	for _, item := range items {
		if item.AdviceID == id {
			return true
		}
	}
	return false
}

func renderWorkflowMapCompact(s *WorkflowMapState, width int) string {
	if s == nil || !s.Visible() || width < 1 {
		return ""
	}
	path := workflowMapPath(s)
	if path == "" {
		path = "no observed attempts"
	}
	actualCount := len(s.Attempts)
	status := workflowMapStatus(s)
	line := fmt.Sprintf("MAP observed · %d attempts · %s · %s", actualCount, status, path)
	if len([]rune(line)) > width {
		line = truncate(line, maxInt(1, width-1))
	}
	return lipgloss.NewStyle().Width(width).MaxWidth(width).Foreground(ColText).Render(line)
}

func workflowMapPath(s *WorkflowMapState) string {
	attemptByID := make(map[string]protocol.WorkflowMapAttempt, len(s.Attempts))
	for _, attempt := range s.Attempts {
		attemptByID[attempt.AttemptID] = attempt
	}
	var parts []string
	for _, edge := range s.Transitions {
		from, fromOK := attemptByID[edge.FromAttemptID]
		to, toOK := attemptByID[edge.ToAttemptID]
		if edge.FromAttemptID == "" && toOK {
			parts = append(parts, "entry → "+workflowAttemptBadge(to))
		} else if fromOK && toOK {
			parts = append(parts, workflowAttemptBadge(from)+" —"+edge.Kind+"→ "+workflowAttemptBadge(to))
		} else if fromOK && edge.ToAttemptID == "" {
			parts = append(parts, workflowAttemptBadge(from)+" —terminal→")
		}
	}
	return strings.Join(parts, "  ")
}

func workflowAttemptBadge(attempt protocol.WorkflowMapAttempt) string {
	state := map[string]string{
		"running": "…", "done": "✓", "escalated": "↑", "skipped": "↷",
		"failed": "!", "cancelled": "×", "budget_exceeded": "$",
	}[attempt.State]
	badge := fmt.Sprintf("%s#%d%s", attempt.Stage, attempt.Attempt, state)
	if attempt.Explore {
		badge += " [explore tier]"
	}
	return badge
}

func workflowMapStatus(s *WorkflowMapState) string {
	if s.Availability.State == "partial" {
		return "partial: " + s.Availability.Reason
	}
	if s.Availability.State == "unavailable" {
		return "unavailable: " + s.Availability.Reason
	}
	if s.Terminal != "" {
		return s.Terminal
	}
	return s.Availability.State
}

func workflowMapDetailsView(s *WorkflowMapState, selected, width, height int) string {
	if s == nil {
		return ""
	}
	inner := maxInt(4, modalInnerWidth(width))
	lines := []string{
		StAccentB.Render("WORKFLOW MAP · OBSERVED PATH"),
		StDim.Render("↑/↓ select attempt · esc close"),
		"Status: " + workflowMapStatus(s),
	}
	if s.Terminal != "" {
		lines = append(lines, "Run: "+s.Terminal)
	}
	path := workflowMapPath(s)
	if path != "" {
		lines = append(lines, truncate("Actual: "+path, inner))
	}
	if len(s.Attempts) == 0 {
		lines = append(lines, "No retained attempts.")
	} else {
		selected = clampInt(selected, 0, len(s.Attempts)-1)
		lines = append(lines, fmt.Sprintf("Attempts (%d):", len(s.Attempts)))
		start := maxInt(0, selected-2)
		attemptRows := maxInt(1, minInt(4, height/6))
		end := minInt(len(s.Attempts), start+attemptRows)
		if end == len(s.Attempts) {
			start = maxInt(0, end-attemptRows)
		}
		for i := start; i < end; i++ {
			prefix := "  "
			if i == selected {
				prefix = "› "
			}
			attempt := s.Attempts[i]
			kind := "actual"
			if attempt.Explore {
				kind = "actual · exploratory tier"
			}
			label := fmt.Sprintf("%s%s · %s/%s · %s · %s · %s", prefix, workflowAttemptBadge(attempt), attempt.Playbook, attempt.Tier, attempt.Model, attempt.State, kind)
			lines = append(lines, truncate(label, inner))
		}
		attempt := s.Attempts[selected]
		lines = append(lines,
			truncate(fmt.Sprintf("Selected: %s#%d · %s · %s", attempt.Stage, attempt.Attempt, attempt.State, attempt.Playbook), inner),
			truncate(fmt.Sprintf("tier/model: %s / %s · intensity %d", attempt.Tier, attempt.Model, attempt.Intensity), inner),
		)
		cost := "cost: unknown"
		if attempt.CostUSD == nil {
		} else {
			cost = fmt.Sprintf("cost: $%.4f", *attempt.CostUSD)
		}
		if attempt.DurationMS != nil {
			cost += fmt.Sprintf(" · %dms", *attempt.DurationMS)
		}
		if attempt.ContractOK != nil {
			cost += fmt.Sprintf(" · contract %t", *attempt.ContractOK)
		}
		lines = append(lines, truncate(cost, inner))
	}
	lines = append(lines, "Advice · not an executed path:")
	if len(s.Advice) == 0 {
		lines = append(lines, "  none")
	} else {
		adviceRows := maxInt(1, minInt(len(s.Advice), height-len(lines)-4))
		for _, advice := range s.Advice[:adviceRows] {
			label := "Shadow suggestion"
			if advice.Mode == "enforce" && !advice.Applied {
				label = "Not applied"
			} else if advice.Mode == "enforce" && advice.Applied {
				label = "Enforced advice"
			}
			detail := advice.Summary
			if detail == "" {
				detail = advice.Action
			}
			lines = append(lines, truncate(fmt.Sprintf("  %s · %s · %s", label, advice.Kind, detail), inner))
		}
		if adviceRows < len(s.Advice) {
			lines = append(lines, fmt.Sprintf("  … %d more", len(s.Advice)-adviceRows))
		}
	}
	return modalFrame(strings.Join(lines, "\n"), width, height)
}

func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
