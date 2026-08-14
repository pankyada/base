package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProfileNameFromPathDefaultsToCoding(t *testing.T) {
	if got := profileNameFromPath(filepath.Join(t.TempDir(), "coding.yaml")); got != "coding" {
		t.Fatalf("profile name = %q, want coding", got)
	}
}

func TestProfileNameFromPathReadsExplicitProfileName(t *testing.T) {
	path := filepath.Join(t.TempDir(), "custom-file.yaml")
	if err := os.WriteFile(path, []byte("name: data-analyst\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := profileNameFromPath(path); got != "data-analyst" {
		t.Fatalf("profile name = %q, want data-analyst", got)
	}
}

func TestProfileNameFromPathFallsBackToFilename(t *testing.T) {
	path := filepath.Join(t.TempDir(), "research.yaml")
	if got := profileNameFromPath(path); got != "research" {
		t.Fatalf("profile name = %q, want research", got)
	}
}

func TestParseLaunchFlagsSupportsSessionResume(t *testing.T) {
	options, err := parseLaunchFlags([]string{"--continue", "--resume", "sess-1", "--no-splash"})
	if err != nil {
		t.Fatal(err)
	}
	if !options.continueSession || options.resumeID != "sess-1" || !options.noSplash {
		t.Fatalf("launch options = %#v", options)
	}
}
