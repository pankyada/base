// Package prefs stores local Bubble Tea client preferences.
package prefs

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const fileName = "tui.json"

// Preferences are intentionally independent of server/profile config. They
// are local UI choices and may be safely lost without changing agent behavior.
type Preferences struct {
	ApprovalModeByProfile map[string]string `json:"approval_mode_by_profile"`
	ModelByProfile        map[string]string `json:"model_by_profile"`
	Theme                 string            `json:"theme"`
	RailVisible           bool              `json:"rail_visible"`
	OverlayTab            string            `json:"overlay_tab"`
	DensityMode           string            `json:"density_mode"`
	RailSections          map[string]bool   `json:"rail_sections"`
	SeenNotices           map[string]bool   `json:"seen_notices"`
}

func pathForHome(home string) string {
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	return filepath.Join(home, ".harness", fileName)
}

// Load reads ~/.harness/tui.json under home. Missing or malformed files
// produce zero-value preferences so a stale local file never blocks startup.
func Load(home string) Preferences {
	return LoadFile(pathForHome(home))
}

// LoadFile is the path-injected variant used by tests and embedding clients.
func LoadFile(path string) Preferences {
	data, err := os.ReadFile(path)
	if err != nil {
		return Preferences{}
	}

	var p Preferences
	if err := json.Unmarshal(data, &p); err != nil {
		return Preferences{}
	}
	return p
}

// Save atomically replaces ~/.harness/tui.json under home. Each call uses a
// private temp file, so concurrent callers can only expose complete JSON.
func (p Preferences) Save(home string) error {
	return p.SaveFile(pathForHome(home))
}

// SaveFile is the path-injected variant used by tests and embedding clients.
func (p Preferences) SaveFile(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, ".tui.json-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	data, err := json.MarshalIndent(p, "", "  ")
	if err == nil {
		_, err = tmp.Write(append(data, '\n'))
	}
	if err == nil {
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
