package ui

import (
	"github.com/charmbracelet/bubbles/key"
)

// KeyMap is the single source of truth for global and transcript navigation.
// Tab belongs to either the overlay or completion mode, never both at once.
type KeyMap struct {
	Send             key.Binding
	Newline          key.Binding
	Cancel           key.Binding
	Quit             key.Binding
	Overlay          key.Binding
	Rail             key.Binding
	ExpandAll        key.Binding
	PageUp           key.Binding
	PageDown         key.Binding
	HalfPageUp       key.Binding
	HalfPageDown     key.Binding
	HistoryUp        key.Binding
	HistoryDown      key.Binding
	AcceptCompletion key.Binding
}

var DefaultKeyMap = NewKeyMap()

func NewKeyMap() KeyMap {
	return KeyMap{
		Send:             key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "send")),
		Newline:          key.NewBinding(key.WithKeys("shift+enter"), key.WithHelp("shift+enter", "newline")),
		Cancel:           key.NewBinding(key.WithKeys("esc"), key.WithHelp("esc", "cancel")),
		Quit:             key.NewBinding(key.WithKeys("ctrl+c"), key.WithHelp("ctrl+c", "quit")),
		Overlay:          key.NewBinding(key.WithKeys("tab"), key.WithHelp("tab", "panels")),
		Rail:             key.NewBinding(key.WithKeys("ctrl+b"), key.WithHelp("^b", "context rail")),
		ExpandAll:        key.NewBinding(key.WithKeys("ctrl+o"), key.WithHelp("^o", "expand all")),
		PageUp:           key.NewBinding(key.WithKeys("pgup"), key.WithHelp("pgup", "scroll up")),
		PageDown:         key.NewBinding(key.WithKeys("pgdown"), key.WithHelp("pgdn", "scroll down")),
		HalfPageUp:       key.NewBinding(key.WithKeys("ctrl+u"), key.WithHelp("^u", "page up")),
		HalfPageDown:     key.NewBinding(key.WithKeys("ctrl+d"), key.WithHelp("^d", "page down")),
		HistoryUp:        key.NewBinding(key.WithKeys("up"), key.WithHelp("↑/↓", "history")),
		HistoryDown:      key.NewBinding(key.WithKeys("down"), key.WithHelp("↓", "history")),
		AcceptCompletion: key.NewBinding(key.WithKeys("tab"), key.WithHelp("tab", "complete"), key.WithDisabled()),
	}
}

// SetCompletionOpen gives Tab to autocomplete while it is visible.
func (m *KeyMap) SetCompletionOpen(open bool) {
	m.AcceptCompletion.SetEnabled(open)
	m.Overlay.SetEnabled(!open)
}

func (m KeyMap) ShortHelp() []key.Binding {
	return []key.Binding{m.Send, m.Overlay, m.Rail}
}

func (m KeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{
		{m.Send, m.Newline, m.Cancel, m.Quit},
		{m.Overlay, m.Rail, m.ExpandAll},
		{m.PageUp, m.PageDown, m.HalfPageUp, m.HalfPageDown, m.HistoryUp, m.HistoryDown},
		{m.AcceptCompletion},
	}
}
