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

const (
	sectionFixedOverhead = 16 // glyph(3) + name(9) + metric gap(2) + chevron gap+char(2)
	sectionMetricMax     = 12
)

// Render draws the section at the given content width and spinner frame.
// allExpanded forces the body open (the ^O toggle).
func (s Section) Render(width, frame int, allExpanded bool) string {
	chev := "▸"
	open := (s.Expanded || allExpanded) && s.Body != ""
	if open {
		chev = "▾"
	}
	metric := truncate(s.Metric, sectionMetricMax)
	argBudget := maxInt(0, width-sectionFixedOverhead-len([]rune(metric)))
	head := lipgloss.JoinHorizontal(
		lipgloss.Top,
		s.color().Render(" "+s.glyph(frame)+" "),
		StText.Render(pad(s.Name, 8)+" "),
		StDim.Render(truncate(s.Arg, argBudget)),
		"  "+StDim.Render(metric),
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
	l := len([]rune(s))
	if l >= n {
		return s
	}
	return s + strings.Repeat(" ", n-l)
}

func truncate(s string, n int) string {
	r := []rune(s)
	if n <= 0 || len(r) <= n {
		return s
	}
	if n <= 1 {
		return string(r[:n])
	}
	return string(r[:n-1]) + "…"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
