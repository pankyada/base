package ui

import "testing"

func TestApplyThemeSetsTealAndRose(t *testing.T) {
	for name := range Themes {
		ApplyTheme(name)
		if ColTeal == "" {
			t.Fatalf("theme %q: ColTeal not set", name)
		}
		if ColRose == "" {
			t.Fatalf("theme %q: ColRose not set", name)
		}
	}
	ApplyTheme("ember")
}
