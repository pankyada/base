package ui

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

var toolCategory = map[string]string{
	"Read": "files", "Write": "files", "Edit": "files", "Glob": "files", "Grep": "files",
	"Bash": "exec", "ExecuteCode": "exec",
	"MemoryRead": "memory", "MemoryWrite": "memory", "MemoryList": "memory",
	"MemoryDelete": "memory", "MemoryLinked": "memory",
	"Delegate": "agents", "DelegateFanout": "agents",
}

var categoryLabels = map[string]string{
	"files":  "FILES",
	"exec":   "EXEC",
	"memory": "MEMORY",
	"agents": "AGENTS",
	"misc":   "MISC",
}

// categorize maps a tool name to its activity category and display label.
// MCP names use the server prefix as their group label.
func categorize(toolName string) (category, label string) {
	if idx := strings.Index(toolName, "__"); idx >= 0 {
		server := toolName[:idx]
		return "mcp", "MCP · " + server
	}
	if category, ok := toolCategory[toolName]; ok {
		return category, categoryLabels[category]
	}
	return "misc", categoryLabels["misc"]
}

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
	Name             string // tool name, e.g. "read"
	Arg              string // one-line arg summary
	Metric           string // e.g. "(142 lines)" or "+6 -2"
	Body             string // rolled-up detail (tool output); shown when Expanded
	State            SectionState
	Expanded         bool
	Motion           bool
	RevealAt         int // frame when expansion began; -1 means no easing pending
	Category         string
	AwaitingApproval bool
}

func (s *Section) Toggle() { s.Expanded = !s.Expanded }

func (s Section) glyph(frame int) string {
	switch s.State {
	case SectionRunning:
		return spinCharForTool(s.Name, frame)
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
	default:
		return s.categoryStyle()
	}
}

func (s Section) categoryStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(categorySoftColor(s.Category))
}

// nameStyle keeps the tool name behind its target. The row exists to say which
// file was touched, and the category header above already says what kind of
// work it was, so the name only lifts out of the background while a call is
// live or has failed.
func (s Section) nameStyle() lipgloss.Style {
	switch s.State {
	case SectionRunning:
		return StDim
	case SectionError:
		return StErr
	default:
		return StFaint
	}
}

// displayName drops the MCP server prefix — the group header already names the
// server, and repeating it costs the columns the path needs.
func (s Section) displayName() string {
	if idx := strings.Index(s.Name, "__"); idx >= 0 {
		return s.Name[idx+2:]
	}
	return s.Name
}

const (
	sectionNameMax       = 12
	sectionFixedOverhead = 20 // glyph(3) + name(13) + metric gap(2) + chevron gap+char(2)
	sectionMetricMax     = 12
	errorPreviewLines    = 4
)

// Render draws the section at the given content width and spinner frame.
// allExpanded forces the body open (the ^O toggle).
func (s Section) Render(width, frame int, allExpanded bool) string {
	chev := "▸"
	open := (s.Expanded || allExpanded) && s.Body != ""
	if open {
		chev = "▾"
	}
	// A failure is the one case where output belongs on screen unasked — enough
	// to say what broke, with the rest still behind the chevron.
	preview := !open && s.State == SectionError && s.Body != ""
	metric := truncate(s.Metric, sectionMetricMax)
	// The arg fills its column so the metric and chevron land on the right edge
	// — a straight rule down the block instead of a ragged one per row.
	argBudget := maxInt(0, width-sectionFixedOverhead-len([]rune(metric)))
	// Pad by display width, not rune count: a double-width arg that fits by
	// runes would otherwise be padded past the row's edge and wrap.
	fitted := fitArg(s.Arg, argBudget)
	fitted += strings.Repeat(" ", maxInt(0, argBudget-lipgloss.Width(fitted)))
	head := lipgloss.JoinHorizontal(
		lipgloss.Top,
		s.color().Render(" "+s.glyph(frame)+" "),
		s.nameStyle().Render(pad(truncate(s.displayName(), sectionNameMax), sectionNameMax)+" "),
		StDim.Render(fitted),
		"  "+StFaint.Render(metric),
		" "+StFaint.Render(chev),
	)
	if !open && !preview {
		return head
	}
	bodyText := s.Body
	if preview {
		bodyText = firstLines(s.Body, errorPreviewLines)
	}
	if open && s.Motion && s.RevealAt >= 0 {
		visible := frame - s.RevealAt + 1
		bodyLines := strings.Split(s.Body, "\n")
		if visible < len(bodyLines) {
			visible = maxInt(1, visible)
			bodyText = strings.Join(bodyLines[:visible], "\n") + "\n" + StFaint.Render("… expanding")
		}
	}
	// Bodies are opt-in detail, so they sit at the quietest readable step —
	// the row above them is what the eye should land on.
	body := lipgloss.NewStyle().
		Foreground(ColFaint).
		BorderStyle(lipgloss.NormalBorder()).
		BorderLeft(true).
		BorderForeground(ColBorder).
		MarginLeft(3).
		PaddingLeft(1).
		Render(bodyText)
	return lipgloss.JoinVertical(lipgloss.Left, head, body)
}

// --- small helpers (shared across ui package) ---

func pad(s string, n int) string {
	l := lipgloss.Width(s)
	if l >= n {
		return s
	}
	return s + strings.Repeat(" ", n-l)
}

// truncate clips s to n visible columns, appending an ellipsis when it
// overflows. It is ANSI-aware (via charmbracelet/x/ansi) so it never counts
// escape-code bytes as width and never cuts inside an escape sequence —
// both of which corrupt styling and misalign borders in modals/panels when
// truncate runs on an already-styled (colored) string.
func truncate(s string, n int) string {
	if n <= 0 {
		return ""
	}
	return ansi.Truncate(s, n, "…")
}

// fitArg trims a tool argument to n columns. A bare path is trimmed from the
// left so the basename — the part that says which file this was — survives;
// anything with a space is a command or query, which reads left to right and is
// trimmed from the right as usual.
func fitArg(s string, n int) string {
	r := []rune(s)
	if n <= 0 || len(r) <= n {
		return s
	}
	if strings.ContainsAny(s, " \t") || !strings.Contains(s, "/") {
		return truncate(s, n)
	}
	if n == 1 {
		return string(r[len(r)-1:])
	}
	return "…" + string(r[len(r)-(n-1):])
}

// firstLines caps a block at n lines and says how much was left off.
func firstLines(text string, n int) string {
	lines := strings.Split(text, "\n")
	if len(lines) <= n {
		return text
	}
	return strings.Join(lines[:n], "\n") + fmt.Sprintf("\n… %d more lines", len(lines)-n)
}

func plural(n int, unit string) string {
	if n == 1 {
		return "1 " + unit
	}
	return strconv.Itoa(n) + " " + unit + "s"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
