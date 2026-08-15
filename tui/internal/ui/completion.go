package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

type CompletionKind int

const (
	CompletionCommand CompletionKind = iota
	CompletionSkill
	CompletionFile
)

type CompletionItem struct {
	Label  string
	Detail string
	Insert string
	Kind   CompletionKind
}

type Completion struct {
	Open    bool
	Items   []CompletionItem
	Cursor  int
	trigger rune
}

// Recompute builds one completion list from the active token. Trigger parsing
// stays in slashQuery and activeMentionQuery so rendering and acceptance share
// the same boundary rules as the older inline hints.
func (c *Completion) Recompute(value string, invocables []CompletionItem, files []string) {
	c.Open = false
	c.Items = nil
	c.Cursor = 0
	c.trigger = 0

	if query, ok := slashQuery(value); ok {
		// Call slashMatches so the built-in command prefix rule remains the
		// source of truth. The query helper also permits skills/custom commands
		// that have no built-in match yet.
		builtinMatches := slashMatches(value)
		byLabel := make(map[string]CompletionItem, len(invocables))
		for _, item := range invocables {
			if _, exists := byLabel[item.Label]; !exists {
				byLabel[item.Label] = item
			}
		}
		seen := map[string]bool{}
		for _, label := range builtinMatches {
			if item, exists := byLabel[label]; exists {
				c.Items = append(c.Items, item)
				seen[label] = true
			}
		}
		for _, item := range invocables {
			if seen[item.Label] || !strings.HasPrefix(item.Label, "/"+query) {
				continue
			}
			c.Items = append(c.Items, item)
			seen[item.Label] = true
		}
		c.trigger = '/'
	} else if _, ok := activeMentionQuery(value); ok {
		query, _ := activeMentionQuery(value)
		for _, file := range files {
			label := "@" + file
			if strings.HasPrefix(file, query) {
				c.Items = append(c.Items, CompletionItem{Label: label, Insert: label, Kind: CompletionFile})
			}
		}
		c.trigger = '@'
	}

	c.Open = len(c.Items) > 0
}

func (c *Completion) Move(delta int) {
	if len(c.Items) == 0 || delta == 0 {
		return
	}
	c.Cursor = (c.Cursor + delta) % len(c.Items)
	if c.Cursor < 0 {
		c.Cursor += len(c.Items)
	}
}

func (c Completion) Accept(value string) (string, bool) {
	if !c.Open || c.Cursor < 0 || c.Cursor >= len(c.Items) {
		return value, false
	}
	item := c.Items[c.Cursor]
	insert := item.Insert
	if insert == "" {
		insert = item.Label
	}
	switch c.trigger {
	case '/':
		query, ok := slashQuery(value)
		if !ok {
			return value, false
		}
		return value[:len(value)-len(query)-1] + insert, true
	case '@':
		query, ok := activeMentionQuery(value)
		if !ok {
			return value, false
		}
		at := strings.LastIndex(value, "@")
		return value[:at] + insert + value[at+1+len(query):], true
	default:
		return value, false
	}
}

func (c Completion) View(width int) string {
	if !c.Open || len(c.Items) == 0 {
		return ""
	}
	width = maxInt(1, width)
	const maxRows = 8
	itemLimit := minInt(len(c.Items), maxRows)
	if len(c.Items) > maxRows {
		itemLimit = maxRows - 1
	}
	lines := make([]string, 0, itemLimit+1)
	for i, item := range c.Items[:itemLimit] {
		marker := "  "
		if i == c.Cursor {
			marker = "› "
		}
		row := marker + item.Label
		if item.Detail != "" {
			row += " — " + item.Detail
		}
		row = truncate(row, width)
		lines = append(lines, completionStyle(item.Kind).Render(row))
	}
	if len(c.Items) > itemLimit {
		lines = append(lines, StFaint.Render(truncate(fmt.Sprintf("… %d more", len(c.Items)-itemLimit), width)))
	}
	return strings.Join(lines, "\n")
}

func completionStyle(kind CompletionKind) lipgloss.Style {
	return lipgloss.NewStyle().Foreground(completionColor(kind))
}

func completionColor(kind CompletionKind) lipgloss.Color {
	switch kind {
	case CompletionSkill:
		return ColPurple
	case CompletionFile:
		return ColDim
	default:
		return ColAccent
	}
}
