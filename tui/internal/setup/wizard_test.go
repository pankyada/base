package setup

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureProfileWritesDefaultsOnEmptyInput(t *testing.T) {
	dir := t.TempDir()
	profilePath := filepath.Join(dir, "profiles", "coding.yaml")

	// Empty stdin means every prompt falls through to its bracketed default.
	created, err := EnsureProfile(profilePath, strings.NewReader(""), &bytes.Buffer{})
	if err != nil {
		t.Fatalf("EnsureProfile returned error: %v", err)
	}
	if !created {
		t.Fatal("expected EnsureProfile to report it created a profile")
	}

	data, err := os.ReadFile(profilePath)
	if err != nil {
		t.Fatalf("profile was not written: %v", err)
	}
	content := string(data)
	for _, want := range []string{
		`base_url: "` + defaultBaseURL + `"`,
		`api_key_env: "` + defaultAPIKeyEnv + `"`,
		`id: "` + defaultModelID + `"`,
		`system_prompt: ~/.harness/prompts/coding.md`,
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("profile missing %q; got:\n%s", want, content)
		}
	}
}

func TestEnsureProfileUsesProvidedValues(t *testing.T) {
	dir := t.TempDir()
	profilePath := filepath.Join(dir, "coding.yaml")

	input := "https://api.anthropic.com/v1\nANTHROPIC_API_KEY\nclaude-sonnet-5\n"
	_, err := EnsureProfile(profilePath, strings.NewReader(input), &bytes.Buffer{})
	if err != nil {
		t.Fatalf("EnsureProfile returned error: %v", err)
	}

	data, _ := os.ReadFile(profilePath)
	content := string(data)
	for _, want := range []string{
		`base_url: "https://api.anthropic.com/v1"`,
		`api_key_env: "ANTHROPIC_API_KEY"`,
		`id: "claude-sonnet-5"`,
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("profile missing %q; got:\n%s", want, content)
		}
	}
}

func TestEnsureProfileSkipsWhenProfileExists(t *testing.T) {
	dir := t.TempDir()
	profilePath := filepath.Join(dir, "coding.yaml")
	if err := os.WriteFile(profilePath, []byte("name: existing\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Any read from stdin here would hang forever on a real un-closed
	// pipe — EnsureProfile must short-circuit before touching it.
	created, err := EnsureProfile(profilePath, strings.NewReader(""), &bytes.Buffer{})
	if err != nil {
		t.Fatalf("EnsureProfile returned error: %v", err)
	}
	if created {
		t.Fatal("expected EnsureProfile to leave an existing profile untouched")
	}

	data, _ := os.ReadFile(profilePath)
	if string(data) != "name: existing\n" {
		t.Fatalf("existing profile was overwritten: %q", data)
	}
}

func TestEnsureProfileQuotesUserInputSafely(t *testing.T) {
	dir := t.TempDir()
	profilePath := filepath.Join(dir, "coding.yaml")

	// A stray `#` or `:` in a raw YAML scalar would break parsing or get
	// read as a comment; quoting must neutralize that.
	input := "https://example.com/v1 # not a comment\nMY_KEY\nmodel: weird\n"
	_, err := EnsureProfile(profilePath, strings.NewReader(input), &bytes.Buffer{})
	if err != nil {
		t.Fatalf("EnsureProfile returned error: %v", err)
	}

	data, _ := os.ReadFile(profilePath)
	if !strings.Contains(string(data), `id: "model: weird"`) {
		t.Fatalf("expected quoted scalar to survive intact; got:\n%s", data)
	}
}

func TestReconfigureBacksUpExistingProfile(t *testing.T) {
	dir := t.TempDir()
	profilePath := filepath.Join(dir, "coding.yaml")
	if err := os.WriteFile(profilePath, []byte("name: old\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	backup, err := Reconfigure(profilePath)
	if err != nil {
		t.Fatalf("Reconfigure returned error: %v", err)
	}
	if backup == "" {
		t.Fatal("expected a non-empty backup path")
	}
	if _, err := os.Stat(profilePath); !os.IsNotExist(err) {
		t.Fatal("expected original profile path to be vacated")
	}
	data, err := os.ReadFile(backup)
	if err != nil || string(data) != "name: old\n" {
		t.Fatalf("backup missing or wrong content: %v %q", err, data)
	}

	// A subsequent EnsureProfile must now treat the path as absent.
	created, err := EnsureProfile(profilePath, strings.NewReader(""), &bytes.Buffer{})
	if err != nil {
		t.Fatalf("EnsureProfile after Reconfigure returned error: %v", err)
	}
	if !created {
		t.Fatal("expected EnsureProfile to re-provision after Reconfigure")
	}
}

func TestReconfigureNoOpWhenNothingToBackUp(t *testing.T) {
	dir := t.TempDir()
	profilePath := filepath.Join(dir, "coding.yaml")

	backup, err := Reconfigure(profilePath)
	if err != nil {
		t.Fatalf("Reconfigure returned error: %v", err)
	}
	if backup != "" {
		t.Fatalf("expected empty backup path when nothing existed, got %q", backup)
	}
}

func TestEnsurePromptFileCreatesFromEmbeddedDefault(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "prompts", "coding.md")

	if err := EnsurePromptFile(path); err != nil {
		t.Fatalf("EnsurePromptFile returned error: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("prompt file was not written: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("expected embedded default prompt to be non-empty")
	}
	if !bytes.Equal(data, defaultSystemPrompt) {
		t.Fatal("written prompt does not match the embedded default")
	}
}

func TestEnsurePromptFileNeverOverwrites(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "coding.md")
	if err := os.WriteFile(path, []byte("# my custom prompt"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := EnsurePromptFile(path); err != nil {
		t.Fatalf("EnsurePromptFile returned error: %v", err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != "# my custom prompt" {
		t.Fatalf("existing prompt file was overwritten: %q", data)
	}
}
