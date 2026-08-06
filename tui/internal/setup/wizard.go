// Package setup provisions a first-run harness profile and system prompt so
// harness-tui can boot without the user having hand-written YAML first.
package setup

import (
	"bufio"
	_ "embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultBaseURL   = "https://api.openai.com/v1"
	defaultAPIKeyEnv = "OPENAI_API_KEY"
	defaultModelID   = "gpt-4o"
)

//go:embed assets/coding.md
var defaultSystemPrompt []byte

// EnsureProfile checks whether profilePath already exists. If it does not,
// it interactively prompts on in/out for the three fields the server cannot
// run without (base URL, API key env var, model ID), then writes a starter
// profile with sane defaults for everything else. Returns true if it wrote a
// new profile.
func EnsureProfile(profilePath string, in io.Reader, out io.Writer) (bool, error) {
	if _, err := os.Stat(profilePath); err == nil {
		return false, nil
	} else if !os.IsNotExist(err) {
		return false, fmt.Errorf("failed to check profile %s: %w", profilePath, err)
	}

	fmt.Fprintf(out, "No profile found at %s — let's set one up.\n", profilePath)
	fmt.Fprintln(out, "Press enter to accept the bracketed default.")
	fmt.Fprintln(out)

	reader := bufio.NewReader(in)
	baseURL := promptDefault(reader, out, "Base URL", defaultBaseURL)
	apiKeyEnv := promptDefault(reader, out, "API key env var", defaultAPIKeyEnv)
	modelID := promptDefault(reader, out, "Model ID", defaultModelID)

	if err := os.MkdirAll(filepath.Dir(profilePath), 0o755); err != nil {
		return false, fmt.Errorf("failed to create profile directory: %w", err)
	}
	if err := os.WriteFile(profilePath, []byte(renderProfile(baseURL, apiKeyEnv, modelID)), 0o644); err != nil {
		return false, fmt.Errorf("failed to write profile: %w", err)
	}

	fmt.Fprintf(out, "\nWrote profile to %s\n\n", profilePath)
	return true, nil
}

// Reconfigure moves an existing profile out of the way (timestamped backup)
// so a subsequent EnsureProfile call treats it as absent and re-prompts. If
// no profile exists yet, it is a no-op and returns an empty backup path.
func Reconfigure(profilePath string) (backupPath string, err error) {
	if _, err := os.Stat(profilePath); err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("failed to check profile %s: %w", profilePath, err)
	}
	backupPath = fmt.Sprintf("%s.bak-%s", profilePath, time.Now().Format("20060102-150405"))
	if err := os.Rename(profilePath, backupPath); err != nil {
		return "", fmt.Errorf("failed to back up existing profile: %w", err)
	}
	return backupPath, nil
}

// EnsurePromptFile writes the bundled default system prompt to path if
// nothing exists there yet. It never overwrites an existing file.
func EnsurePromptFile(path string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("failed to check system prompt %s: %w", path, err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("failed to create prompt directory: %w", err)
	}
	if err := os.WriteFile(path, defaultSystemPrompt, 0o644); err != nil {
		return fmt.Errorf("failed to write system prompt: %w", err)
	}
	return nil
}

func promptDefault(reader *bufio.Reader, out io.Writer, label, def string) string {
	fmt.Fprintf(out, "%s [%s]: ", label, def)
	line, _ := reader.ReadString('\n')
	line = strings.TrimSpace(line)
	if line == "" {
		return def
	}
	return line
}

func renderProfile(baseURL, apiKeyEnv, modelID string) string {
	return fmt.Sprintf(`name: coding
model:
  base_url: %s
  api_key_env: %s
  id: %s
  fallback_id: %s
system_prompt: ~/.harness/prompts/coding.md
working_dir: $CWD
artifact_dir: .harness/coding
tools:
  builtin:
    Read: allow
    Write: allow
    Edit: allow
    Bash: prompt
    Grep: allow
    Glob: allow
    Skill: allow
    MemoryRead: allow
    MemoryWrite: allow
    MemoryList: allow
    Stats: allow
    Delegate: prompt
  mcp_servers: []
hooks:
  pre_tool: []
  post_tool: []
  on_stop: []
improvement:
  enabled: true
  mine_skills_every_n_sessions: 10
`, yamlQuote(baseURL), yamlQuote(apiKeyEnv), yamlQuote(modelID), yamlQuote(modelID))
}

// yamlQuote wraps a scalar in a YAML double-quoted string so user input
// (which may contain colons, `#`, or other flow-scalar-breaking characters)
// can't corrupt the document.
func yamlQuote(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return `"` + s + `"`
}
