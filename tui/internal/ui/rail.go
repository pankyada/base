package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"harness-tui/internal/protocol"
)

// railWidth is the fixed column the rail occupies. It never reflows with the
// transcript — the whole point of the rail is that its controls stay put.
const railWidth = 34

// railBorder and railPadding are the rail's own chrome. lipgloss draws the
// border outside Width() and the padding inside it, so the block width is
// railWidth-railBorder and the usable content width is that minus the padding.
// Getting this wrong makes content wrap and the panel grow past its column.
const (
	railBorder  = 1
	railPadding = 2
	railInner   = railWidth - railBorder - railPadding
)

// RailHit is one clickable region in the rail, in rail-content coordinates:
// Y counts rows from the first rail line, X counts cells from the first
// content cell (i.e. after the border and padding).
type RailHit struct {
	Y      int
	X1, X2 int
	Action string
}

// TaskStatus is the rail's view of one task's process.
type TaskStatus struct {
	Running  bool
	Finished bool
	Code     int
	Elapsed  string
}

// RailInput is everything the rail draws. Passing a struct keeps the call site
// readable as the panel grows sections.
// Profile, model, trust and session id are deliberately absent: they are
// static for the session and already shown in the topbar and status bar, so
// a rail copy would be a third render of the same four facts.
type RailInput struct {
	Running       bool
	ActiveTool    string
	ActiveElapsed string
	Todos         []protocol.TodoItem
	Artifacts     []protocol.Artifact
	ContextTokens int
	ContextWindow int
	Spark         Sparkline

	Git        GitState
	GitBusy    string // git action currently in flight, "" when idle
	GitConfirm string // git action armed, awaiting a second click

	Tasks         []Task
	TaskState     map[string]TaskStatus
	TasksDetected bool

	// Pressed is the action currently mid click-flash — see pressFlashFrames
	// in model_project.go. Empty when nothing was clicked recently.
	Pressed string

	// Expanded tracks which sections have their secondary actions unfolded,
	// keyed by section name ("git", "tasks").
	Expanded map[string]bool

	Height     int
	Frame      int
	StageCosts map[string]float64
}

// railView renders the right-hand panel as clearly bounded sections and
// returns the clickable regions inside it. The result is always exactly
// Height lines tall so the panel is a fixed, static column: it does not grow,
// shrink, or slide as the transcript, notices, or composer change size.
func railView(in RailInput) (string, []RailHit) {
	inner := maxInt(4, railInner)

	type block struct {
		lines []string
		hits  []RailHit // Y relative to the block
	}
	blocks := []block{}
	// A section that has nothing to say is not rendered at all. "TODOS 0 /
	// none yet" is four wasted rows that push real controls off the panel;
	// the section reappears the moment it has content.
	appendBlock := func(lines []string, hits []RailHit) {
		if len(lines) == 0 {
			return
		}
		blocks = append(blocks, block{lines: lines, hits: hits})
	}

	// Ordered in three bands: what the agent is doing now, what you can drive,
	// then what the session has produced.
	appendBlock(railActiveSection(in, inner), nil)
	appendBlock(railWorkflowSection(in.StageCosts, inner), nil)
	appendBlock(railTodosSection(in.Todos, inner), nil)
	taskLines, taskHits := railTasksSection(in, inner)
	appendBlock(taskLines, taskHits)
	gitLines, gitHits := railGitSection(in, inner)
	appendBlock(gitLines, gitHits)
	appendBlock(railContextSection(in.ContextTokens, in.ContextWindow, inner), nil)
	appendBlock(railArtifactsSection(in.Artifacts, inner), nil)

	// Fill the fixed height in priority order. A section that cannot fit whole
	// is dropped rather than shown headless — except when at least three rows
	// remain, in which case its head is kept and marked as clipped.
	height := maxInt(1, in.Height)
	var lines []string
	var hits []RailHit
	for _, current := range blocks {
		separator := 0
		if len(lines) > 0 {
			separator = 1
		}
		remaining := height - len(lines) - separator
		if remaining <= 0 {
			break
		}
		body := current.lines
		clipped := false
		if len(body) > remaining {
			if remaining < 3 {
				continue
			}
			body = append(append([]string{}, body[:remaining-1]...), StFaint.Render("…"))
			clipped = true
		}
		if separator == 1 {
			lines = append(lines, "")
		}
		offset := len(lines)
		for _, hit := range current.hits {
			if clipped && hit.Y >= len(body) {
				continue
			}
			hit.Y += offset
			hits = append(hits, hit)
		}
		// Clamp on the way in: one over-wide line would wrap and push the whole
		// panel past the fixed height it just promised.
		for _, line := range body {
			lines = append(lines, clampWidth(line, inner))
		}
	}
	for len(lines) < height {
		lines = append(lines, "")
	}

	rendered := lipgloss.NewStyle().Width(railWidth - railBorder).Height(height).
		BorderStyle(lipgloss.NormalBorder()).BorderLeft(true).BorderForeground(ColBorder).
		PaddingLeft(railPadding).Render(strings.Join(lines, "\n"))
	return rendered, hits
}

func railWorkflowSection(costs map[string]float64, inner int) []string {
	if len(costs) == 0 {
		return nil
	}
	rows := []string{sectionHeader("WORKFLOW", inner)}
	total := 0.0
	for _, stage := range []string{"recon", "plan", "design", "build", "verify", "review"} {
		if cost, ok := costs[stage]; ok {
			rows = append(rows, StDim.Render(fmt.Sprintf("%-8s $%.4f", stage, cost)))
			total += cost
		}
	}
	rows = append(rows, StAccent.Render(fmt.Sprintf("total    $%.4f", total)))
	return rows
}

// clampWidth truncates a rendered, already-styled string to a cell width.
// The plain `truncate` helper counts runes and would cut an ANSI escape in
// half, silently swallowing everything styled after it.
func clampWidth(text string, width int) string {
	return lipgloss.NewStyle().MaxWidth(maxInt(0, width)).Inline(true).Render(text)
}

// railActiveSection renders only while something is running. When idle the
// topbar/statusbar READY badge already answers "is it working", so a whole
// section repeating it in words earns nothing.
func railActiveSection(in RailInput, inner int) []string {
	if !in.Running {
		return nil
	}
	tool := in.ActiveTool
	if tool == "" {
		tool = "thinking"
	}
	return []string{
		sectionHeader("active", inner),
		StAccent.Render(thinkingSpinChar(in.Frame)) + " " + StText.Render(truncate(tool, maxInt(1, inner-2))),
		StDim.Render(pad("elapsed", 8) + in.ActiveElapsed),
		StDim.Render(pad("rate", 8) + in.Spark.View()),
	}
}

func railTodosSection(todos []protocol.TodoItem, inner int) []string {
	if len(todos) == 0 {
		return nil
	}
	header := sectionHeader(fmt.Sprintf("todos %d", len(todos)), inner)
	lines := []string{header}
	for index, todo := range todos {
		if index == railListCap {
			lines = append(lines, StFaint.Render(fmt.Sprintf("+%d more", len(todos)-railListCap)))
			break
		}
		lines = append(lines, fmt.Sprintf("%s %s", todoGlyph(todo.Status), truncate(todo.Content, maxInt(1, inner-2))))
	}
	return lines
}

func railContextSection(contextTokens, contextWindow, inner int) []string {
	// Before the first turn the window is unknown and the gauge can only say
	// "context —", which is noise. It appears once there is a real number.
	if contextWindow <= 0 {
		return nil
	}
	// contextGauge appends " NN% · used/window" after the bar, so the bar only
	// gets what is left — otherwise the numbers are clamped off the edge.
	const gaugeLabel = 21
	return []string{sectionHeader("context", inner), contextGauge(contextTokens, contextWindow, maxInt(4, inner-gaugeLabel))}
}

func railArtifactsSection(artifacts []protocol.Artifact, inner int) []string {
	if len(artifacts) == 0 {
		return nil
	}
	header := sectionHeader(fmt.Sprintf("artifacts %d", len(artifacts)), inner)
	lines := []string{header}
	for index, artifact := range artifacts {
		if index == railListCap {
			lines = append(lines, StFaint.Render(fmt.Sprintf("+%d more", len(artifacts)-railListCap)))
			break
		}
		lines = append(lines, StDim.Render(artifact.Icon+" "+truncate(artifact.Title, maxInt(1, inner-3))))
	}
	return lines
}

// railListCap bounds the variable-length sections so one long todo list cannot
// crowd every control out of the panel.
const railListCap = 6

// ─── tasks ───────────────────────────────────────────────────────────────

func railTasksSection(in RailInput, inner int) ([]string, []RailHit) {
	label := fmt.Sprintf("tasks %d", len(in.Tasks))
	if in.TasksDetected && len(in.Tasks) > 0 {
		label += " ·detected"
	}
	lines := []string{sectionHeader(label, inner)}
	var hits []RailHit

	if len(in.Tasks) == 0 {
		lines = append(lines, StFaint.Render("none configured"))
	}
	for index, task := range in.Tasks {
		if index == railListCap {
			lines = append(lines, StFaint.Render(fmt.Sprintf("+%d more · edit to reorder", len(in.Tasks)-railListCap)))
			break
		}
		status := in.TaskState[task.ID]
		glyph, style, suffix := StDim.Render(taskGlyph(task.Kind)), StText, ""
		switch {
		case status.Running:
			glyph = StAccent.Render(spinCharForTool(task.Kind, in.Frame))
			suffix = StAccent.Render(status.Elapsed + " ·stop")
		case status.Finished && status.Code == 0:
			suffix = StOK.Render("✓")
		case status.Finished:
			suffix = StErr.Render(fmt.Sprintf("✗%d", status.Code))
			style = StText
		}
		name := style.Render(truncate(task.Label, maxInt(1, inner-lipgloss.Width(suffix)-3)))
		row := glyph + " " + name
		if suffix != "" {
			gap := maxInt(1, inner-lipgloss.Width(row)-lipgloss.Width(suffix))
			row += strings.Repeat(" ", gap) + suffix
		}
		action := "task:" + task.ID
		hits = append(hits, RailHit{Y: len(lines), X1: 0, X2: inner, Action: action})
		if in.Pressed == action {
			row = flashRow(row, inner)
		}
		lines = append(lines, row)
	}

	// The task rows above are themselves the primary action (click to run), so
	// every chip here is secondary configuration and folds away by default.
	secondary := []chip{
		{Label: "detect", Action: "tasks:detect"},
		{Label: "ask agent", Action: "tasks:ask"},
		{Label: "edit", Action: "tasks:edit"},
	}
	chipRows, chipHits := actionRows(nil, secondary, "tasks", "manage", in.Expanded["tasks"], inner, len(lines), in.Pressed)
	return append(lines, chipRows...), append(hits, chipHits...)
}

// ─── git ─────────────────────────────────────────────────────────────────

func railGitSection(in RailInput, inner int) ([]string, []RailHit) {
	lines := []string{sectionHeader("git", inner)}
	git := in.Git
	if !git.Checked {
		return append(lines, StFaint.Render("reading…")), nil
	}
	if !git.Repo {
		if git.Err != "" {
			return append(lines, StErr.Render(truncate(git.Err, inner))), nil
		}
		return append(lines, StFaint.Render("not a git repository")), nil
	}

	branch := StAccentB.Render(truncate(git.Branch, maxInt(1, inner-10)))
	if git.Ahead > 0 {
		branch += StOK.Render(fmt.Sprintf(" ↑%d", git.Ahead))
	}
	if git.Behind > 0 {
		branch += StInfo.Render(fmt.Sprintf(" ↓%d", git.Behind))
	}
	if git.Upstream == "" {
		branch += StFaint.Render(" ·no upstream")
	}
	lines = append(lines, branch)

	if git.Dirty() {
		var parts []string
		if git.Staged > 0 {
			parts = append(parts, StOK.Render(fmt.Sprintf("%d staged", git.Staged)))
		}
		if git.Unstaged > 0 {
			parts = append(parts, StAccent.Render(fmt.Sprintf("%d changed", git.Unstaged)))
		}
		if git.Untracked > 0 {
			parts = append(parts, StDim.Render(fmt.Sprintf("%d new", git.Untracked)))
		}
		if git.Conflicts > 0 {
			parts = append(parts, StErr.Render(fmt.Sprintf("%d conflict", git.Conflicts)))
		}
		lines = append(lines, clampWidth(strings.Join(parts, StFaint.Render(" · ")), inner))
	} else {
		lines = append(lines, StFaint.Render("working tree clean"))
	}

	if in.GitBusy != "" {
		lines = append(lines, StAccent.Render(spinChar(in.Frame)+" "+in.GitBusy+"…"))
	}

	// stage → commit → push is the loop people actually run; the rest are
	// occasional, so they fold.
	primary := []chip{
		{Label: "stage", Action: "git:stage", Primary: true, Disabled: git.Unstaged+git.Untracked == 0},
		{Label: "commit", Action: "git:commit", Primary: true, Disabled: git.Staged == 0},
		{Label: "push", Action: "git:push", Primary: true},
	}
	secondary := []chip{
		{Label: "unstage", Action: "git:unstage", Disabled: git.Staged == 0},
		{Label: "pull", Action: "git:pull"},
		{Label: "diff", Action: "git:diff"},
		{Label: "log", Action: "git:log"},
		{Label: "refresh", Action: "git:refresh"},
	}
	decorate := func(chips []chip) {
		for i := range chips {
			if chips[i].Action == "git:"+in.GitConfirm {
				chips[i].Armed = true
			}
			if in.GitBusy != "" {
				chips[i].Disabled = true
			}
		}
	}
	decorate(primary)
	decorate(secondary)
	chipRows, chipHits := actionRows(primary, secondary, "git", "more", in.Expanded["git"], inner, len(lines), in.Pressed)
	return append(lines, chipRows...), chipHits
}

// ─── chips ───────────────────────────────────────────────────────────────

// chip is a clickable button rendered as [label].
type chip struct {
	Label    string
	Action   string
	Disabled bool
	Armed    bool // second click confirms
	Primary  bool // the action you probably came for — gets the loud fill
}

// actionRows renders a section's buttons: primary chips always inline, the
// rest behind a fold row. Folding *everything* would put the common path
// (stage → commit → push) two clicks away, so only the secondary set hides.
// foldLabel names the hidden group ("more", "manage").
func actionRows(primary, secondary []chip, sectionKey, foldLabel string, expanded bool, width, startY int, pressed string) ([]string, []RailHit) {
	var lines []string
	var hits []RailHit

	if len(primary) > 0 {
		rows, primaryHits := chipLines(primary, width, startY, pressed)
		lines = append(lines, rows...)
		hits = append(hits, primaryHits...)
		startY += len(rows)
	}
	if len(secondary) == 0 {
		return lines, hits
	}

	// The ▸/▾ chevron is the same disclosure grammar tool sections and prose
	// sections already use, so one glyph means "there is more here" everywhere.
	chevron, caption := "▸", fmt.Sprintf("%s (%d)", foldLabel, len(secondary))
	if expanded {
		chevron, caption = "▾", foldLabel
	}
	foldRow := StDim.Render(chevron + " " + caption)
	hits = append(hits, RailHit{Y: startY, X1: 0, X2: lipgloss.Width(foldRow), Action: "fold:" + sectionKey})
	lines = append(lines, foldRow)
	startY++

	if expanded {
		rows, secondaryHits := chipLines(secondary, width, startY, pressed)
		lines = append(lines, rows...)
		hits = append(hits, secondaryHits...)
	}
	return lines, hits
}

// chipLines packs chips into rows no wider than width and reports where each
// one landed. startY is the row the first chip line will occupy. pressed is
// the action currently mid click-flash (see pressFlashFrames).
//
// Buttons render as filled pills, not plain bracketed text — the rail is
// otherwise all StDim/StFaint labels, so a button has to read as visibly
// raised against that or it disappears into the surrounding status text.
func chipLines(chips []chip, width, startY int, pressed string) ([]string, []RailHit) {
	var lines []string
	var hits []RailHit
	current := ""
	column := 0
	row := startY

	for _, item := range chips {
		label := item.Label
		if item.Armed {
			label += "?"
		}
		text := "[" + label + "]"
		if column > 0 && column+1+lipgloss.Width(text) > width {
			lines = append(lines, current)
			current, column = "", 0
			row++
		}
		if column > 0 {
			current += " "
			column++
		}
		current += chipStyle(item, item.Action == pressed).Render(text)
		if !item.Disabled {
			hits = append(hits, RailHit{Y: row, X1: column, X2: column + lipgloss.Width(text), Action: item.Action})
		}
		column += lipgloss.Width(text)
	}
	if current != "" {
		lines = append(lines, current)
	}
	return lines, hits
}

// chipStyle picks one button's fill. Buttons need real color to register as
// clickable rather than as chrome — but making *every* button equally loud
// just moves the problem, so the fill is tiered: primary actions take the
// solid accent, secondary ones a muted raised pill. Pressed flashes green
// (confirmation), armed turns red (this click is destructive), disabled drops
// the fill entirely — four states an eye sorts without reading labels.
func chipStyle(item chip, pressed bool) lipgloss.Style {
	switch {
	case pressed:
		return lipgloss.NewStyle().Background(ColOK).Foreground(ColBg).Bold(true)
	case item.Disabled:
		return lipgloss.NewStyle().Foreground(ColFaint)
	case item.Armed:
		return lipgloss.NewStyle().Background(ColDel).Foreground(ColBg).Bold(true)
	case item.Primary:
		return lipgloss.NewStyle().Background(ColAccent).Foreground(ColBg).Bold(true)
	default:
		return lipgloss.NewStyle().Background(ColBorderHi).Foreground(ColText)
	}
}

// flashRow gives a non-chip clickable row (a task's own line) the same
// pressed treatment as a button: briefly inverted, full width.
func flashRow(row string, width int) string {
	return lipgloss.NewStyle().Background(ColOK).Foreground(ColBg).Bold(true).Width(width).Render(ansi.Strip(row))
}

func todoGlyph(status string) string {
	switch status {
	case "completed":
		return StOK.Render("✓")
	case "in_progress":
		return StAccent.Render("•")
	default:
		return StFaint.Render("○")
	}
}
