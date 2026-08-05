package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// ActivityGroup is a merged run of same-category sections within one turn.
type ActivityGroup struct {
	Category string
	Label    string
	Key      string
	Items    []*Section
	Expanded bool
}

// TimelineEntry is either a merged group or an always-open standalone item.
type TimelineEntry struct {
	Group      *ActivityGroup
	Standalone *Section
}

func isStandalone(s *Section) bool {
	return s.State == SectionError || s.AwaitingApproval
}

// BuildTimeline groups non-error, non-approval sections in first-occurrence
// order. Grouping key includes label so MCP servers stay separate.
func BuildTimeline(sections []*Section, expanded map[string]bool) []TimelineEntry {
	var timeline []TimelineEntry
	groupIndex := map[string]int{}
	for _, section := range sections {
		if section == nil {
			continue
		}
		if isStandalone(section) {
			timeline = append(timeline, TimelineEntry{Standalone: section})
			continue
		}
		category := section.Category
		derivedCategory, label := categorize(section.Name)
		if category == "" {
			category = derivedCategory
		}
		key := category + "|" + label
		if idx, ok := groupIndex[key]; ok {
			timeline[idx].Group.Items = append(timeline[idx].Group.Items, section)
			continue
		}
		group := &ActivityGroup{
			Category: category,
			Label:    label,
			Key:      key,
			Items:    []*Section{section},
			Expanded: expanded != nil && expanded[key],
		}
		groupIndex[key] = len(timeline)
		timeline = append(timeline, TimelineEntry{Group: group})
	}
	return timeline
}

// Activities hang off the turn header in two steps: the category header sits
// one step in, its rows another, joined by a guide line so a long run of tool
// calls reads as one indented block instead of a wall of left-aligned rows.
const (
	groupIndent = "  "
	itemIndent  = "  │  "
)

// itemGuide is the styled guide column drawn beside every line of a row,
// including the lines of an expanded body, so the block keeps one spine.
func itemGuide() string { return StFaint.Render(itemIndent) }

// groupItemWidth is the width a row gets once the guide column is taken out.
// The transcript's hit map sizes rows the same way, so header heights and click
// targets stay in step.
func groupItemWidth(width int) int {
	return maxInt(0, width-len([]rune(itemIndent)))
}

// indentLines prefixes every line of a block, keeping multi-line bodies inside
// the column their header hangs off.
func indentLines(prefix, block string) string {
	lines := strings.Split(block, "\n")
	for i, line := range lines {
		lines[i] = prefix + line
	}
	return strings.Join(lines, "\n")
}

// Render draws a group header and its indented items. Group expansion forces
// all item bodies open, while each item's own Expanded flag still works alone.
func (g *ActivityGroup) Render(width, frame int, allExpanded bool) string {
	open := g.Expanded || allExpanded
	chevron := "▸"
	if open {
		chevron = "▾"
	}
	header := groupIndent +
		lipgloss.NewStyle().Foreground(categorySoftColor(g.Category)).Render(chevron+" "+g.Label) +
		StFaint.Render(fmt.Sprintf(" · %s", plural(len(g.Items), "op")))
	lines := []string{header}
	for _, item := range g.Items {
		lines = append(lines, indentLines(itemGuide(), item.Render(groupItemWidth(width), frame, open)))
	}
	return lipgloss.JoinVertical(lipgloss.Left, lines...)
}
