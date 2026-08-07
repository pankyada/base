package ui

import (
	"fmt"
	"strings"

	"harness-tui/internal/protocol"
)

// pendingInboxView renders the inbox with its default answer state. Tests and
// small callers can use this stable shape; the model uses the stateful helper
// below to render option cursors and multi-select marks.
func pendingInboxView(pending []protocol.PendingInput, cursor int, answering bool, answerInput string, width, height int) string {
	return pendingInboxViewState(pending, cursor, answering, answerInput, 0, nil, width, height)
}

func pendingInboxViewState(pending []protocol.PendingInput, cursor int, answering bool, answerInput string, optionCursor int, selected map[int]bool, width, height int) string {
	inner := modalInnerWidth(width)
	lines := []string{sectionHeader(fmt.Sprintf("inbox %d", len(pending)), inner)}
	if len(pending) == 0 {
		lines = append(lines, "", StDim.Render("no open questions"), StFaint.Render("parked work appears here after the server asks"))
		return strings.Join(lines, "\n")
	}

	for i, item := range pending {
		marker := "  "
		if i == cursor {
			marker = StAccent.Render("› ")
		}
		kind := StDim.Render("[" + item.Kind + "]")
		lines = append(lines, marker+StText.Render(truncate(item.Prompt, maxInt(1, inner-12)))+" "+kind)
		meta := fmt.Sprintf("%s · run %s · expires %s", item.Profile, item.RunID, item.ExpiresAt)
		if item.Channel != "" {
			meta += " · " + item.Channel
		}
		lines = append(lines, "  "+StFaint.Render(truncate(meta, maxInt(1, inner-2))))
	}

	if answering && cursor >= 0 && cursor < len(pending) {
		item := pending[cursor]
		lines = append(lines, "", sectionHeader("answer", inner))
		switch item.Kind {
		case "text":
			lines = append(lines, answerInput)
		case "select", "multi_select":
			for i, option := range item.Options {
				marker := "  "
				if i == optionCursor {
					marker = StAccent.Render("› ")
				}
				check := " "
				if item.Kind == "multi_select" && selected[i] {
					check = StOK.Render("✓")
				} else if item.Kind == "select" && option == answerInput {
					check = StOK.Render("●")
				}
				lines = append(lines, marker+"["+check+"] "+StText.Render(option))
			}
		}
		lines = append(lines, "", StDim.Render("enter submit · esc back"))
	} else {
		lines = append(lines, "", StDim.Render("enter answer · ↑/↓ select"))
	}
	return strings.Join(lines, "\n")
}

func pendingAnswerValue(item protocol.PendingInput, optionCursor int, answerInput string, selected map[int]bool) (string, bool) {
	switch item.Kind {
	case "text":
		value := strings.TrimSpace(answerInput)
		return value, value != ""
	case "select":
		for _, option := range item.Options {
			if option == answerInput {
				return answerInput, true
			}
		}
		return "", false
	case "multi_select":
		values := make([]string, 0, len(selected))
		for i, option := range item.Options {
			if selected[i] {
				values = append(values, option)
			}
		}
		return strings.Join(values, ","), len(values) > 0
	default:
		_ = optionCursor
		return "", false
	}
}
