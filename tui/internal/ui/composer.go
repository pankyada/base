package ui

import (
	"strings"

	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const (
	composerMinHeight  = 1
	composerMaxHeight  = 6
	composerHistoryMax = 50
)

// Composer owns multiline input and bounded local recall.
type Composer struct {
	input        textarea.Model
	history      []string
	historyIndex int
}

func NewComposer() Composer {
	input := textarea.New()
	input.Placeholder = "/model to switch · Tab for panels · ? for keys"
	input.Prompt = "› "
	input.ShowLineNumbers = false
	input.MaxHeight = composerMaxHeight
	input.FocusedStyle = textarea.Style{
		Base:        lipgloss.NewStyle().Foreground(ColText),
		CursorLine:  lipgloss.NewStyle(),
		Placeholder: lipgloss.NewStyle().Foreground(ColFaint),
		Prompt:      lipgloss.NewStyle().Foreground(ColAccent),
		Text:        lipgloss.NewStyle().Foreground(ColText),
	}
	input.BlurredStyle = input.FocusedStyle
	input.Focus()
	return Composer{input: input}
}

func (c *Composer) SetWidth(width int) {
	inputWidth := maxInt(8, width-4)
	c.input.SetWidth(inputWidth)
	c.syncHeight()
}

func (c *Composer) syncHeight() {
	lines := c.input.LineCount()
	if lines < composerMinHeight {
		lines = composerMinHeight
	}
	if lines > composerMaxHeight {
		lines = composerMaxHeight
	}
	c.input.SetHeight(lines)
}

func (c Composer) Value() string { return c.input.Value() }

func (c *Composer) Reset() {
	c.input.Reset()
	c.historyIndex = len(c.history)
	c.syncHeight()
}

// Submit returns current input and adds it to recall history.
func (c *Composer) Submit() string {
	value := c.input.Value()
	if strings.TrimSpace(value) == "" {
		c.Reset()
		return ""
	}
	c.history = append(c.history, value)
	if len(c.history) > composerHistoryMax {
		c.history = c.history[len(c.history)-composerHistoryMax:]
	}
	c.historyIndex = len(c.history)
	c.input.Reset()
	c.syncHeight()
	return value
}

func (c *Composer) atFirstLine() bool {
	return c.input.LineInfo().RowOffset == 0
}

func (c *Composer) atLastLine() bool {
	info := c.input.LineInfo()
	return info.Height <= 1 || info.RowOffset+1 >= info.Height
}

func (c *Composer) recall(delta int) bool {
	if len(c.history) == 0 {
		return false
	}
	next := c.historyIndex + delta
	if next < 0 {
		next = 0
	}
	if next > len(c.history) {
		next = len(c.history)
	}
	if next == c.historyIndex {
		return true
	}
	c.historyIndex = next
	if next == len(c.history) {
		c.input.Reset()
	} else {
		c.input.SetValue(c.history[next])
	}
	c.syncHeight()
	return true
}

func (c *Composer) Update(msg tea.Msg) tea.Cmd {
	if keyMsg, ok := msg.(tea.KeyMsg); ok {
		switch keyMsg.String() {
		case "up":
			if c.atFirstLine() && c.recall(-1) {
				return nil
			}
		case "down":
			if c.atLastLine() && c.recall(1) {
				return nil
			}
		case "shift+enter":
			c.input.InsertString("\n")
			c.historyIndex = len(c.history)
			c.syncHeight()
			return nil
		}
		c.historyIndex = len(c.history)
	}
	var cmd tea.Cmd
	c.input, cmd = c.input.Update(msg)
	c.syncHeight()
	return cmd
}

func (c Composer) Height() int {
	return lipgloss.Height(c.View())
}

func (c Composer) View() string {
	return lipgloss.NewStyle().
		BorderStyle(lipgloss.RoundedBorder()).
		BorderForeground(ColBorderHi).
		Padding(0, 1).
		Render(c.input.View())
}
