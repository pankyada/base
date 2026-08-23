// Package setup hands first-run onboarding to the Node harness CLI so every
// surface uses one profile and secret-management implementation.
package setup

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// EnsureInitialized runs the canonical Node wizard when the user has no
// config. The child inherits the terminal so prompts, masking, and doctor
// output behave exactly as they do for a direct `harness init` invocation.
// Reconfigure always forwards --reconfigure; Node owns backups and diffs.
func EnsureInitialized(configPath string, reconfigure bool) error {
	if !reconfigure {
		if _, err := os.Stat(configPath); err == nil {
			return nil
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("failed to check harness config %s: %w", configPath, err)
		}
	}

	command, err := exec.LookPath("harness")
	if err != nil {
		return fmt.Errorf("harness init is required but harness was not found on PATH: %w", err)
	}
	args := []string{"init"}
	if reconfigure {
		args = append(args, "--reconfigure")
	}
	cmd := exec.Command(command, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("harness init failed: %w", err)
	}
	if _, err := os.Stat(configPath); err != nil {
		return fmt.Errorf("harness init completed without creating %s: %w", configPath, err)
	}
	return nil
}

// Reconfigure is retained for callers that need the old profile backup helper.
// The TUI entrypoint no longer calls it: --reconfigure is forwarded to the
// Node wizard, which backs up config, env, and profile files coherently.
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

// ResolveDefaultProfile reads the user config after init and returns the
// selected profile file. Explicit --profile paths remain untouched.
func ResolveDefaultProfile(configPath, homeDir string) (string, error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return "", fmt.Errorf("failed to read harness config %s: %w", configPath, err)
	}
	var config struct {
		DefaultProfile string `json:"default_profile"`
		ProfilesDir    string `json:"profiles_dir"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		return "", fmt.Errorf("failed to parse harness config %s: %w", configPath, err)
	}
	if config.DefaultProfile == "" {
		return "", fmt.Errorf("harness config %s has no default_profile", configPath)
	}
	profilesDir := config.ProfilesDir
	if profilesDir == "" {
		profilesDir = filepath.Join(homeDir, ".harness", "profiles")
	}
	if profilesDir == "~" {
		profilesDir = homeDir
	} else if len(profilesDir) > 2 && profilesDir[:2] == "~/" {
		profilesDir = filepath.Join(homeDir, profilesDir[2:])
	}
	if !filepath.IsAbs(profilesDir) {
		profilesDir = filepath.Join(homeDir, profilesDir)
	}
	return filepath.Join(profilesDir, config.DefaultProfile+".yaml"), nil
}
