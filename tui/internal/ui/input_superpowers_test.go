package ui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMentionIndexRunsAsCommandAndSkipsIgnoredDirs(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"src/login.go", ".git/config"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	cmd := mentionIndexCmd("@src/l", root)
	msg, ok := cmd().(mentionIndexMsg)
	if !ok || len(msg.Matches) != 1 || msg.Matches[0] != "@src/login.go" {
		t.Fatalf("mention result=%#v", msg)
	}
	if strings.Contains(strings.Join(msg.Matches, " "), ".git") {
		t.Fatal("ignored path indexed")
	}
}

func TestMentionIndexRespectsGitignore(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("*.log\nbuild/\nsecret.txt\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "build"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"keep.go", "debug.log", "secret.txt", "build/output.bin"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	entries := buildMentionIndex(root, 20_000)
	joined := strings.Join(entries, " ")
	if !strings.Contains(joined, "keep.go") || strings.Contains(joined, "debug.log") || strings.Contains(joined, "secret.txt") || strings.Contains(joined, "build/") {
		t.Fatalf("gitignored entries leaked: %v", entries)
	}
}

func TestLocalCommandCanBeInterrupted(t *testing.T) {
	cmd, cancel := runLocalCommand("sleep 30", ".")
	cancel()
	result, ok := cmd().(localResultMsg)
	if !ok || result.Code != 130 {
		t.Fatalf("local result=%#v", result)
	}
}
