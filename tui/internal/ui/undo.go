package ui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"harness-tui/internal/protocol"
)

func undoPanelView(entries []protocol.UndoEntry, cursor, width, height int) string {
	inner := modalInnerWidth(width)
	lines := []string{sectionHeader(fmt.Sprintf("undo %d", len(entries)), inner)}
	if len(entries) == 0 {
		return strings.Join(append(lines, "", StDim.Render("nothing to undo in this session")), "\n")
	}
	for i, entry := range entries {
		marker := "  "
		if i == cursor && entry.Available {
			marker = StAccent.Render("› ")
		}
		label := fmt.Sprintf("%s · %s", entry.Tool, entry.Target)
		if entry.Applied {
			label += " · applied"
		} else if !entry.Available {
			label += " · unavailable"
		}
		style := StText
		if !entry.Available {
			style = StFaint
		}
		lines = append(lines, marker+style.Render(truncate(label, maxInt(1, inner-2))))
		if entry.Reason != "" {
			lines = append(lines, "  "+StFaint.Render(truncate(entry.Reason, maxInt(1, inner-2))))
		}
	}
	lines = append(lines, "", StDim.Render("↑/↓ select available · enter restore · esc close"))
	return strings.Join(lines, "\n")
}

func nextUndoCursor(entries []protocol.UndoEntry, cursor, delta int) int {
	if len(entries) == 0 {
		return 0
	}
	for next := cursor + delta; next >= 0 && next < len(entries); next += delta {
		if entries[next].Available {
			return next
		}
	}
	return cursor
}

func firstAvailableUndo(entries []protocol.UndoEntry, fallback int) int {
	if fallback >= 0 && fallback < len(entries) && entries[fallback].Available {
		return fallback
	}
	for i, entry := range entries {
		if entry.Available {
			return i
		}
	}
	return 0
}

func (m Model) updateUndoTab(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up":
		m.undoCursor = nextUndoCursor(m.undoEntries, m.undoCursor, -1)
	case "down":
		m.undoCursor = nextUndoCursor(m.undoEntries, m.undoCursor, 1)
	case "enter":
		if m.undoCursor >= 0 && m.undoCursor < len(m.undoEntries) && m.undoEntries[m.undoCursor].Available {
			m.send(protocol.UndoApply(m.undoEntries[m.undoCursor].ID))
		}
	}
	m.reflow()
	return m, nil
}
