package ui

import (
	"strings"
	"testing"
)

func TestHelpCoversEveryKeyBinding(t *testing.T) {
	keys := NewKeyMap()
	view := stripANSI(helpView(keys, 100, 30))
	for _, binding := range keys.FullHelp()[0] {
		if help := binding.Help(); help.Desc != "" && !strings.Contains(view, help.Desc) {
			t.Errorf("help missing %q", help.Desc)
		}
	}
	for _, group := range keys.FullHelp()[1:] {
		for _, binding := range group {
			if help := binding.Help(); help.Desc != "" && !strings.Contains(view, help.Desc) {
				t.Errorf("help missing %q", help.Desc)
			}
		}
	}
}
