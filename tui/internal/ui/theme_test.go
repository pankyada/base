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

func TestRoleAndChromeColorsStayBelowProse(t *testing.T) {
	for name := range Themes {
		ApplyTheme(name)
		for _, role := range []string{"agent", "user", "task", "memory", "local"} {
			if roleColor(role) == ColText {
				t.Fatalf("theme %q: %s role color equals prose", name, role)
			}
		}
		if ColFaint == ColText || categorySoftColor("files") == ColText {
			t.Fatalf("theme %q: chrome color equals prose", name)
		}
	}
	ApplyTheme("ember")
}
