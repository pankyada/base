package ui

import (
	"path/filepath"
	"testing"

	"harness-tui/internal/prefs"
)

func TestPaletteFuzzyMatchOrdersTightMatches(t *testing.T) {
	entries := []paletteEntry{{label: "go test status"}, {label: "sessions"}, {label: "git stage"}}
	got := paletteFuzzyMatch("gst", entries)
	if len(got) != 2 || got[0].label != "git stage" {
		t.Fatalf("fuzzy order = %+v, want git stage first", got)
	}
}

func TestPaletteDisablesBusySessionEntries(t *testing.T) {
	m := NewModel(nil, "coding", "user", prefs.Preferences{})
	m.running = true
	m.tasks = []Task{{ID: "build", Label: "build", Command: "make", Kind: "build"}}
	entries := paletteEntries(m)
	for _, entry := range entries {
		if entry.label == "run build" || entry.label == "/compact" || entry.label == "/clear" {
			if entry.disabledReason != "session busy" {
				t.Fatalf("%s reason = %q", entry.label, entry.disabledReason)
			}
		}
	}
}

func TestPaletteMutuallyExclusiveWithOverlay(t *testing.T) {
	m := NewModel(nil, "coding", "user", prefs.Preferences{})
	m.overlayOpen = true
	if m.paletteCanOpen() {
		t.Fatal("palette must not open over an active overlay")
	}
	m.overlayOpen = false
	if !m.paletteCanOpen() {
		t.Fatal("palette should open when no modal is active")
	}
}

func TestRecentCommandsPreferencesRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tui.json")
	want := prefs.Preferences{RecentCommands: []string{"/git", "/tasks"}}
	if err := want.SaveFile(path); err != nil {
		t.Fatal(err)
	}
	got := prefs.LoadFile(path)
	if len(got.RecentCommands) != 2 || got.RecentCommands[0] != "/git" {
		t.Fatalf("recent commands = %#v", got.RecentCommands)
	}
}
