package setup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureInitializedExecsHarnessInit(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".harness", "config.json")
	argsPath := filepath.Join(dir, "args")
	stub := filepath.Join(dir, "harness")
	script := "#!/bin/sh\nprintf '%s' \"$*\" > \"$HARNESS_TEST_ARGS\"\nmkdir -p \"$(dirname \"$HARNESS_TEST_CONFIG\")\"\nprintf '{\"version\":1}' > \"$HARNESS_TEST_CONFIG\"\n"
	if err := os.WriteFile(stub, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("HARNESS_TEST_ARGS", argsPath)
	t.Setenv("HARNESS_TEST_CONFIG", configPath)

	if err := EnsureInitialized(configPath, false); err != nil {
		t.Fatalf("EnsureInitialized returned error: %v", err)
	}
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("stub did not run: %v", err)
	}
	if string(args) != "init" {
		t.Fatalf("expected init handoff, got %q", args)
	}
}

func TestEnsureInitializedForwardsReconfigure(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".harness", "config.json")
	argsPath := filepath.Join(dir, "args")
	stub := filepath.Join(dir, "harness")
	script := "#!/bin/sh\nprintf '%s' \"$*\" > \"$HARNESS_TEST_ARGS\"\n"
	if err := os.WriteFile(stub, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte(`{"version":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("HARNESS_TEST_ARGS", argsPath)

	if err := EnsureInitialized(configPath, true); err != nil {
		t.Fatalf("EnsureInitialized returned error: %v", err)
	}
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("stub did not run: %v", err)
	}
	if string(args) != "init --reconfigure" {
		t.Fatalf("expected reconfigure handoff, got %q", args)
	}
}

func TestEnsureInitializedSkipsExistingConfig(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	if err := os.WriteFile(configPath, []byte(`{"version":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	oldPath := os.Getenv("PATH")
	t.Setenv("PATH", filepath.Join(dir, "does-not-exist"))
	defer t.Setenv("PATH", oldPath)
	if err := EnsureInitialized(configPath, false); err != nil {
		t.Fatalf("existing config should skip init: %v", err)
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
}

func TestResolveDefaultProfileUsesConfiguredDirectoryAndName(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".harness", "config.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatal(err)
	}
	config := `{"default_profile":"data","profiles_dir":"~/.harness/profiles"}`
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	path, err := ResolveDefaultProfile(configPath, dir)
	if err != nil {
		t.Fatalf("ResolveDefaultProfile returned error: %v", err)
	}
	want := filepath.Join(dir, ".harness", "profiles", "data.yaml")
	if path != want {
		t.Fatalf("expected %q, got %q", want, path)
	}
	if strings.Contains(path, "config.json") {
		t.Fatal("profile resolver returned config path")
	}
}
