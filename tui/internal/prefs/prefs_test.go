package prefs

import (
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func TestPreferencesRoundTrip(t *testing.T) {
	home := t.TempDir()
	want := Preferences{
		ApprovalModeByProfile: map[string]string{"coding": "danger"},
		ModelByProfile:        map[string]string{"coding": "gpt-5.4-mini"},
		Theme:                 "amber",
		RailHidden:            true,
		OverlayTab:            "skills",
		SeenNotices:           map[string]bool{"first-run": true},
	}
	if err := want.Save(home); err != nil {
		t.Fatal(err)
	}
	got := Load(home)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("loaded preferences differ\nwant: %#v\ngot:  %#v", want, got)
	}
	if mode := LoadFile(filepath.Join(home, ".harness", "tui.json")).ApprovalModeByProfile["coding"]; mode != "danger" {
		t.Fatalf("saved approval mode = %q", mode)
	}
}

func TestCorruptPreferencesReturnDefaults(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, ".harness", "tui.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := Load(home); !reflect.DeepEqual(got, Preferences{}) {
		t.Fatalf("corrupt file returned %#v", got)
	}
}

func TestConcurrentSavesLeaveCompleteJSON(t *testing.T) {
	home := t.TempDir()
	const writers = 32
	var wg sync.WaitGroup
	wg.Add(writers)
	for i := 0; i < writers; i++ {
		go func(i int) {
			defer wg.Done()
			p := Preferences{Theme: "theme", OverlayTab: "tab"}
			p.ModelByProfile = map[string]string{"profile": string(rune('a' + i%26))}
			if err := p.Save(home); err != nil {
				t.Errorf("save %d: %v", i, err)
			}
		}(i)
	}
	wg.Wait()
	if got := Load(home); got.Theme != "theme" || got.OverlayTab != "tab" {
		t.Fatalf("final preferences are incomplete: %#v", got)
	}
}
