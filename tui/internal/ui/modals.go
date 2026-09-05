package ui

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/lipgloss"
	"harness-tui/internal/protocol"
)

type ApprovalRequest struct {
	ID      string
	Name    string
	Input   map[string]interface{}
	Risk    string
	Reason  string
	Preview interface{}
}

type InputRequest struct {
	ID       string
	Prompt   string
	Kind     string
	Options  []string
	Cursor   int
	Selected map[int]bool
	Text     textinput.Model
}

func newInputRequest(id, prompt, kind string, options []string) *InputRequest {
	input := textinput.New()
	input.Prompt = "› "
	input.Placeholder = "type response"
	input.CharLimit = 4096
	if kind == "text" {
		input.Focus()
	}
	return &InputRequest{ID: id, Prompt: prompt, Kind: kind, Options: options, Selected: map[int]bool{}, Text: input}
}

func approvalModal(req ApprovalRequest, width, height int) string {
	risk := req.Risk
	if risk == "" {
		risk = "caution"
	}
	badge := StDim.Render("[" + risk + "]")
	if risk == "danger" {
		badge = StErr.Render("[" + risk + "]")
	} else if risk == "caution" {
		badge = StAccent.Render("[" + risk + "]")
	}
	preview, err := json.MarshalIndent(req.Input, "", "  ")
	if err != nil {
		preview = []byte("input unavailable")
	}
	lines := []string{
		StAccentB.Render("APPROVAL REQUIRED") + "  " + badge,
		StText.Render(req.Name),
	}
	if req.Reason != "" {
		lines = append(lines, StDim.Render(req.Reason))
	}
	if req.Preview != nil {
		proposal, proposalErr := json.MarshalIndent(req.Preview, "", "  ")
		if proposalErr == nil {
			lines = append(lines, StInfo.Render("PROPOSED EFFECT"), StFaint.Render(truncate(string(proposal), maxInt(80, width/2))))
		}
	}
	lines = append(lines, "", StFaint.Render(truncate(string(preview), maxInt(80, width/2))), "", StDim.Render("y/enter approve · n/esc deny · a approve + yolo"))
	return modalFrame(strings.Join(lines, "\n"), width, height)
}

func inputModal(req *InputRequest, width, height int) string {
	lines := []string{StInfo.Render("INPUT REQUIRED"), StText.Render(req.Prompt), ""}
	switch req.Kind {
	case "text":
		lines = append(lines, req.Text.View())
	case "select", "multi_select":
		for i, option := range req.Options {
			cursor := " "
			if i == req.Cursor {
				cursor = "›"
			}
			mark := " "
			if req.Kind == "multi_select" && req.Selected[i] {
				mark = "✓"
			}
			lines = append(lines, fmt.Sprintf("%s [%s] %s", cursor, mark, option))
		}
		if req.Kind == "multi_select" {
			count := 0
			for _, selected := range req.Selected {
				if selected {
					count++
				}
			}
			lines = append(lines, "", StDim.Render(fmt.Sprintf("%d selected", count)))
		}
	}
	lines = append(lines, "", StDim.Render("enter confirm · esc skip"))
	return modalFrame(strings.Join(lines, "\n"), width, height)
}

// approvalBody renders the approval-mode chooser as bare content, sized to the
// caller's inner width. Callers wrap it: standalone pickers in modalFrame, the
// overlay in its own tab frame.
func approvalBody(current string, cursor, innerWidth int) string {
	modes := []struct{ name, detail string }{
		{"strict", "ask for every mutating tool"},
		{"bash", "ask Bash and code execution"},
		{"danger", "ask only for risky calls · default"},
		{"yolo", "allow every non-denied tool"},
	}
	nameWidth := 0
	for _, mode := range modes {
		if w := lipgloss.Width(mode.name); w > nameWidth {
			nameWidth = w
		}
	}
	lines := []string{StDim.Render("current: " + current), ""}
	for i, mode := range modes {
		marker := "  "
		if i == cursor {
			marker = StAccent.Render("› ")
		}
		selected := StFaint.Render("○")
		label := StText.Render(pad(mode.name, nameWidth))
		if mode.name == current {
			selected = StOK.Render("●")
			label = StAccentB.Render(pad(mode.name, nameWidth))
		}
		row := marker + selected + " " + label + "  " + StDim.Render(mode.detail)
		lines = append(lines, truncate(row, innerWidth))
	}
	if current == "yolo" || modes[cursor].name == "yolo" {
		lines = append(lines, "", StErr.Render("⚠ YOLO allows every tool the profile does not explicitly deny"))
	}
	return strings.Join(lines, "\n")
}

func approvalPicker(current string, cursor, width, height int) string {
	return modalFrame(StAccentB.Render("APPROVAL MODE")+"\n"+
		approvalBody(current, cursor, modalInnerWidth(width))+"\n\n"+
		StDim.Render("↑/↓ choose · enter apply · esc close"), width, height)
}

// modelBody renders the model list as bare content in aligned columns.
func modelBody(models []protocol.ModelInfo, cursor int, filter string, custom bool, customInput string, innerWidth int) string {
	var lines []string
	if filter != "" {
		lines = append(lines, StFaint.Render("filter: "+filter+"▏"))
	} else {
		lines = append(lines, StDim.Render("same-provider models selectable · / to filter"))
	}
	lines = append(lines, "")

	visible := make([]protocol.ModelInfo, 0, len(models))
	query := strings.ToLower(filter)
	for _, model := range models {
		if query == "" || strings.Contains(strings.ToLower(model.ID), query) || strings.Contains(strings.ToLower(model.Label), query) {
			visible = append(visible, model)
		}
	}

	if len(models) == 0 {
		lines = append(lines, StFaint.Render("loading model registry…"))
	} else if len(visible) == 0 {
		lines = append(lines, StFaint.Render("no models match "+filter))
	}

	// Align label and id into fixed columns so the list reads as a table.
	labelWidth, idWidth := 0, 0
	for _, model := range visible {
		if w := lipgloss.Width(model.Label); w > labelWidth {
			labelWidth = w
		}
		if w := lipgloss.Width(model.ID); w > idWidth {
			idWidth = w
		}
	}
	labelWidth = minInt(labelWidth, 22)
	idWidth = minInt(idWidth, 28)

	for i, model := range visible {
		marker := "  "
		if i == cursor {
			marker = StAccent.Render("› ")
		}
		label := truncate(model.Label, labelWidth)
		id := truncate(model.ID, idWidth)
		meta := fmt.Sprintf("%s ctx · $%.2f/$%.2f per Mtok", compactNumber(model.ContextWindow), model.InputPrice*1_000_000, model.OutputPrice*1_000_000)

		labelStyle, idStyle := StText, StDim
		if !model.Available {
			labelStyle, idStyle = StFaint, StFaint
			meta = model.Reason
		} else if i == cursor {
			labelStyle = StAccentB
		}
		// Truncate meta as plain text against its own width budget before
		// styling — truncating the fully-assembled (already-colored) row
		// risks cutting mid-escape-sequence, which corrupts styling and
		// misaligns the modal border on long strings like model.Reason.
		metaWidth := maxInt(0, innerWidth-lipgloss.Width(marker)-labelWidth-idWidth-4)
		row := marker + labelStyle.Render(pad(label, labelWidth)) + "  " +
			idStyle.Render(pad(id, idWidth)) + "  " + StFaint.Render(truncate(meta, metaWidth))
		lines = append(lines, row)
	}

	lines = append(lines, "")
	if custom {
		lines = append(lines, StDim.Render("custom model id:"), customInput)
	} else {
		marker := "  "
		if cursor == len(visible) {
			marker = StAccent.Render("› ")
		}
		lines = append(lines, marker+StDim.Render("custom id…"))
	}
	return strings.Join(lines, "\n")
}

func modelPicker(models []protocol.ModelInfo, cursor int, filter string, custom bool, customInput string, width, height int) string {
	return modalFrame(StAccentB.Render("MODEL")+"\n"+
		modelBody(models, cursor, filter, custom, customInput, modalInnerWidth(width))+"\n\n"+
		StDim.Render("↑/↓ choose · / filter · enter apply · esc close"), width, height)
}

func sessionBody(sessions []protocol.SessionSummary, cursor, innerWidth int) string {
	if len(sessions) == 0 {
		return StFaint.Render("no past sessions")
	}
	dateWidth, costWidth := 12, 10
	titleWidth := maxInt(8, innerWidth-dateWidth-costWidth-5)
	lines := []string{StDim.Render("date"), ""}
	for i, session := range sessions {
		marker := "  "
		if i == cursor {
			marker = StAccent.Render("› ")
		}
		title := session.Title
		if title == "" {
			title = session.Summary
		}
		if title == "" {
			title = session.ID
		}
		row := marker + pad(truncate(sessionDate(session.CreatedAt), dateWidth), dateWidth) + "  " +
			pad(truncate(title, titleWidth), titleWidth) + "  " + StFaint.Render(fmt.Sprintf("$%.4f", session.Usage.CostUSD))
		lines = append(lines, truncate(row, innerWidth))
	}
	return strings.Join(lines, "\n")
}

func sessionDate(createdAt string) string {
	created, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return "unknown"
	}
	age := time.Since(created)
	switch {
	case age < time.Minute:
		return "now"
	case age < time.Hour:
		return fmt.Sprintf("%dm ago", int(age/time.Minute))
	case age < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(age/time.Hour))
	case age < 7*24*time.Hour:
		return fmt.Sprintf("%dd ago", int(age/(24*time.Hour)))
	default:
		return created.Local().Format("Jan 02")
	}
}

func sessionPicker(sessions []protocol.SessionSummary, cursor, width, height int) string {
	return modalFrame(StAccentB.Render("SESSIONS")+"\n"+
		sessionBody(sessions, cursor, modalInnerWidth(width))+"\n\n"+
		StDim.Render("↑/↓ choose · enter resume · esc close"), width, height)
}

// themeBody renders the theme chooser as bare content — a swatch of each
// theme's own accent/ok/error/info colors so a pick previews as a palette,
// not just a name, plus a live full-screen preview since moving the cursor
// applies the theme immediately (see updateThemeTab).
func themeBody(current string, cursor, innerWidth int) string {
	nameWidth := 0
	for _, name := range themeOrder {
		if w := lipgloss.Width(name); w > nameWidth {
			nameWidth = w
		}
	}
	lines := []string{StDim.Render("current: " + current), ""}
	for i, name := range themeOrder {
		theme := Themes[name]
		marker := "  "
		if i == cursor {
			marker = StAccent.Render("› ")
		}
		selected := StFaint.Render("○")
		label := StText.Render(pad(name, nameWidth))
		if name == current {
			selected = StOK.Render("●")
			label = StAccentB.Render(pad(name, nameWidth))
		}
		swatch := lipgloss.NewStyle().Foreground(lipgloss.Color(theme.Accent)).Render("██") +
			lipgloss.NewStyle().Foreground(lipgloss.Color(theme.OK)).Render("██") +
			lipgloss.NewStyle().Foreground(lipgloss.Color(theme.Info)).Render("██") +
			lipgloss.NewStyle().Foreground(lipgloss.Color(theme.Error)).Render("██")
		row := marker + selected + " " + label + "  " + swatch
		lines = append(lines, truncate(row, innerWidth))
	}
	return strings.Join(lines, "\n")
}

// densityBody renders the fold-density chooser — three fixed options, no
// filter, same shape as approvalBody.
func densityBody(current string, cursor, innerWidth int) string {
	nameWidth := 0
	for _, mode := range densityModes {
		if w := lipgloss.Width(mode.name); w > nameWidth {
			nameWidth = w
		}
	}
	lines := []string{StDim.Render("current: " + current), ""}
	for i, mode := range densityModes {
		marker := "  "
		if i == cursor {
			marker = StAccent.Render("› ")
		}
		selected := StFaint.Render("○")
		label := StText.Render(pad(mode.name, nameWidth))
		if mode.name == current {
			selected = StOK.Render("●")
			label = StAccentB.Render(pad(mode.name, nameWidth))
		}
		row := marker + selected + " " + label + "  " + StDim.Render(mode.detail)
		lines = append(lines, truncate(row, innerWidth))
	}
	return strings.Join(lines, "\n")
}

func modalOuterWidth(width int) int {
	if width < 60 {
		return maxInt(1, width-2)
	}
	return maxInt(20, width*80/100)
}

// modalInnerWidth is the usable text width inside a modalFrame, after its
// border (2 cells) and horizontal padding (4 cells).
func modalInnerWidth(width int) int {
	return maxInt(1, modalOuterWidth(width)-6)
}

func modalFrame(content string, width, height int) string {
	maxHeight := maxInt(8, height*80/100)
	if width < 60 {
		maxHeight = maxInt(1, height-2)
	}
	return lipgloss.NewStyle().Width(modalOuterWidth(width)).MaxHeight(maxHeight).
		BorderStyle(lipgloss.RoundedBorder()).BorderForeground(ColAccent).
		Background(ColPanel).Padding(1, 2).Render(content)
}
