package ui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

// Turn is one user message, agent response, local command result, memory
// write, or task run.
type Turn struct {
	Role           string // "user" | "agent" | "local" | "memory" | "task"
	RunID          string // server-owned run identity; workflow maps attach only to this turn
	WorkflowMap    *WorkflowMapState
	TaskID         string // task turns only — the task whose output Text mirrors
	Text           string // user content, or streamed agent text
	Time           string
	Sections       []Section // agent only
	ExpandedGroups map[string]bool
	ExpandedProse  map[string]bool // agent only, keyed by prose section index
	Tokens         int             // agent only, for the footer
	Cost           float64         // agent only, for the footer
	Elapsed        string          // agent only, for the footer
	Started        time.Time       // agent only, for elapsed-time tracking
	Pulse          int             // completion pulse frames remaining
	Revealed       int             // agent only, runes of Text revealed so far (typewriter)
}

// Transcript renders the full conversation.
type Transcript struct {
	Turns       []Turn
	AllExpanded bool // ^O toggle
	Motion      bool
	Density     string // "full" | "normal" | "compact" — prose fold aggressiveness
}

func (tr Transcript) Render(width, frame int) string {
	content, _ := tr.RenderWithHitMap(width, frame)
	return content
}

// HitRow records the interactive transcript row for a group header or item.
// Group keys are stable across render passes; item pointers refer to the
// source Section values in Turn.Sections.
type HitRow struct {
	Y          int
	TurnIndex  int
	GroupKey   string
	Item       *Section
	IsProse    bool
	ProseIndex int
}

// RenderWithHitMap renders the transcript and records rows that can be
// toggled with the mouse. Rows are relative to the transcript content.
func (tr Transcript) RenderWithHitMap(width, frame int) (string, []HitRow) {
	var blocks []string
	var hits []HitRow
	row := 0
	for turnIndex, t := range tr.Turns {
		turnStart := row
		turnWidth := maxInt(4, width-1)
		if t.Role == "user" {
			rendered := roleGutter(t.Role, userBubble(t, turnWidth))
			blocks = append(blocks, rendered)
			row = turnStart + lipgloss.Height(rendered) + 1
			continue
		}
		if t.Role == "local" {
			rendered := roleGutter(t.Role, StDim.Render("LOCAL")+"\n"+lipgloss.NewStyle().Width(turnWidth).Foreground(ColText).Render(t.Text))
			blocks = append(blocks, rendered)
			row = turnStart + lipgloss.Height(rendered) + 1
			continue
		}
		if t.Role == "task" {
			// Task blocks are pre-rendered by the model each frame so they
			// track their process's live output.
			rendered := roleGutter(t.Role, t.Text)
			blocks = append(blocks, rendered)
			row = turnStart + lipgloss.Height(rendered) + 1
			continue
		}
		if t.Role == "memory" {
			rendered := roleGutter(t.Role, StOK.Render("REMEMBERED")+StDim.Render(" · "+t.Time)+"\n"+lipgloss.NewStyle().Width(turnWidth).Foreground(ColText).Render(t.Text))
			blocks = append(blocks, rendered)
			row = turnStart + lipgloss.Height(rendered) + 1
			continue
		}
		if t.Role == "plan" {
			header := StInfo.Render("PLAN ◇") + " " + StFaint.Render(t.Time)
			rendered := roleGutter(t.Role, lipgloss.JoinVertical(lipgloss.Left, header, renderAgentText(t.Text, turnWidth)))
			blocks = append(blocks, rendered)
			row = turnStart + lipgloss.Height(rendered) + 1
			continue
		}
		// agent
		header := agentHeader(t.Time)
		parts := []string{header}
		row += lipgloss.Height(header)
		sectionPtrs := make([]*Section, len(t.Sections))
		for i := range t.Sections {
			sectionPtrs[i] = &t.Sections[i]
		}
		for _, entry := range BuildTimeline(sectionPtrs, t.ExpandedGroups) {
			if entry.Group != nil {
				hits = append(hits, HitRow{Y: row, TurnIndex: turnIndex, GroupKey: entry.Group.Key})
				rendered := entry.Group.Render(turnWidth, frame, tr.AllExpanded)
				itemRow := row + 1
				forceOpen := entry.Group.Expanded || tr.AllExpanded
				for _, item := range entry.Group.Items {
					hits = append(hits, HitRow{Y: itemRow, TurnIndex: turnIndex, Item: item})
					itemRow += lipgloss.Height(item.Render(groupItemWidth(turnWidth), frame, forceOpen))
				}
				parts = append(parts, rendered)
				row += lipgloss.Height(rendered)
				continue
			}
			// Errors and pending approvals sit at the group headers' indent —
			// out of the guide column, so they read as interruptions rather
			// than as one more row of routine work.
			hits = append(hits, HitRow{Y: row, TurnIndex: turnIndex, Item: entry.Standalone})
			rendered := indentLines(groupIndent,
				entry.Standalone.Render(maxInt(0, turnWidth-len([]rune(groupIndent))), frame, tr.AllExpanded))
			parts = append(parts, rendered)
			row += lipgloss.Height(rendered)
		}
		// Between send and the first token or tool call there is otherwise
		// nothing on screen — this is what tells the user the agent is
		// actually working, not stalled.
		if t.Text == "" && len(t.Sections) == 0 && t.Elapsed == "" && !t.Started.IsZero() {
			glyph := thinkingSpinChar(frame)
			elapsed := fmt.Sprintf("%.0fs", time.Since(t.Started).Seconds())
			parts = append(parts, StAccent.Render(glyph)+" "+StDim.Render("thinking… "+elapsed))
			row++
		}
		if t.Text != "" {
			visible := t.Text
			if tr.Motion && t.Elapsed == "" {
				runes := []rune(t.Text)
				if t.Revealed < len(runes) {
					visible = string(runes[:maxInt(0, t.Revealed)])
				}
			}
			// Fold only once a turn has finished streaming — collapsing
			// prose while the user is still reading it stream in would be
			// jarring — and only when density mode + section count call
			// for it. Short or in-progress replies render exactly as
			// before: no fold, no lead/section split at all.
			lead, sections := "", []ProseSection(nil)
			if tr.Density != "full" && t.Elapsed != "" {
				lead, sections = SplitProse(visible)
			}
			if len(sections) < foldThreshold(tr.Density) {
				lead, sections = visible, nil
			}
			addedAny := false
			if lead != "" {
				body := renderAgentText(lead, turnWidth)
				parts = append(parts, body)
				row += lipgloss.Height(body)
				addedAny = true
			}
			for si, sec := range sections {
				key := fmt.Sprintf("%d", si)
				expanded := tr.AllExpanded || (t.ExpandedProse != nil && t.ExpandedProse[key])
				chevron := "▸"
				if expanded {
					chevron = "▾"
				}
				headerRow := StAccentB.Render(chevron+" "+sec.Header) + StDim.Render(fmt.Sprintf(" · %d lines", sec.Lines))
				hits = append(hits, HitRow{Y: row, TurnIndex: turnIndex, IsProse: true, ProseIndex: si})
				parts = append(parts, headerRow)
				row += lipgloss.Height(headerRow)
				addedAny = true
				if !expanded {
					continue
				}
				// The chevron row already carries the header — drop it from
				// the expanded body so it isn't rendered twice.
				bodyOnly := ""
				if rawLines := strings.SplitN(sec.Raw, "\n", 2); len(rawLines) > 1 {
					bodyOnly = rawLines[1]
				}
				expandedBody := lipgloss.NewStyle().
					Foreground(ColDim).
					BorderStyle(lipgloss.NormalBorder()).
					BorderLeft(true).
					BorderForeground(ColBorder).
					MarginLeft(1).
					PaddingLeft(1).
					Render(renderAgentText(bodyOnly, maxInt(4, turnWidth-4)))
				parts = append(parts, expandedBody)
				row += lipgloss.Height(expandedBody)
			}
			if tr.Motion && t.Elapsed == "" && frame%2 == 0 {
				cursor := StAccent.Render("▌")
				if addedAny {
					parts[len(parts)-1] += cursor
				} else {
					parts = append(parts, cursor)
					row++
				}
			}
		}
		if t.WorkflowMap != nil && t.WorkflowMap.Visible() {
			mapLine := renderWorkflowMapCompact(t.WorkflowMap, turnWidth)
			parts = append(parts, mapLine)
			row += lipgloss.Height(mapLine)
		}
		if t.Tokens > 0 || t.Elapsed != "" || t.Cost > 0 {
			footerStyle := StFaint
			if t.Pulse >= 3 {
				footerStyle = StAccent
			} else if t.Pulse > 0 {
				footerStyle = StOK
			}
			footer := footerStyle.Render(fmt.Sprintf("▌ %d tools · %d tok · %s · $%.4f",
				len(t.Sections), t.Tokens, t.Elapsed, t.Cost))
			parts = append(parts, footer)
			row += lipgloss.Height(footer)
		}
		rendered := roleGutter(t.Role, lipgloss.JoinVertical(lipgloss.Left, parts...))
		blocks = append(blocks, rendered)
		row = turnStart + lipgloss.Height(rendered) + 1
	}
	return lipgloss.JoinVertical(lipgloss.Left, spread(blocks)...), hits
}

func roleGutter(role, content string) string {
	return lipgloss.NewStyle().
		BorderStyle(lipgloss.NormalBorder()).
		BorderLeft(true).
		BorderForeground(roleColor(role)).
		Render(content)
}

func agentHeader(timestamp string) string {
	return lipgloss.NewStyle().Foreground(roleColor("agent")).Render("HARNESS ◆") + " " + StFaint.Render(timestamp)
}

// spread inserts a blank line between blocks.
func spread(blocks []string) []string {
	if len(blocks) == 0 {
		return blocks
	}
	out := make([]string, 0, len(blocks)*2)
	for i, b := range blocks {
		out = append(out, b)
		if i < len(blocks)-1 {
			out = append(out, "")
		}
	}
	return out
}
