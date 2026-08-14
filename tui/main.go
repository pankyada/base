package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"harness-tui/internal/prefs"
	"harness-tui/internal/server"
	"harness-tui/internal/setup"
	"harness-tui/internal/ui"
	"harness-tui/internal/ws"
)

var version = "0.2.2"

func main() {
	showVersion := flag.Bool("version", false, "print version")
	profile := flag.String("profile", "", "profile YAML path")
	port := flag.String("port", envOr("HARNESS_PORT", "7337"), "harness server port")
	noSplash := flag.Bool("no-splash", false, "disable boot splash")
	noMotion := flag.Bool("no-motion", false, "disable motion")
	noNotify := flag.Bool("no-notify", false, "disable terminal notifications")
	reconfigure := flag.Bool("reconfigure", false, "re-run first-run setup, backing up the existing profile")
	flag.Parse()

	if *showVersion {
		fmt.Printf("harness-tui %s\n", version)
		return
	}

	profilePath, err := resolveProfilePath(*profile)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if *reconfigure {
		backup, err := setup.Reconfigure(profilePath)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if backup != "" {
			fmt.Printf("Backed up existing profile to %s\n", backup)
		}
	}
	if _, err := setup.EnsureProfile(profilePath, os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if home, err := os.UserHomeDir(); err == nil {
		if err := setup.EnsurePromptFile(filepath.Join(home, ".harness", "prompts", "coding.md")); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}

	serverResult, err := server.EnsureServer(*port, profilePath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer serverResult.Cleanup()
	stdoutInfo, _ := os.Stdout.Stat()
	interactive := stdoutInfo != nil && stdoutInfo.Mode()&os.ModeCharDevice != 0 && os.Getenv("TERM") != "dumb"
	profileName := profileNameFromPath(profilePath)
	ui.BootSplash(os.Stdout, profileName, *noSplash || !interactive)

	userID := envOr("HARNESS_USER", currentUser())
	client := ws.New(*port, userID, profileName)
	model := ui.NewModel(client, "connecting", userID, prefs.Load(""))
	model.Configure(ui.Options{NoMotion: *noMotion || os.Getenv("NO_COLOR") != "", NoNotify: *noNotify, NotifyTTY: interactive})
	program := tea.NewProgram(model, tea.WithAltScreen(), tea.WithReportFocus(), tea.WithMouseCellMotion())
	client.Start(program.Send)
	defer client.Close()

	if _, err := program.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// profileNameFromPath supplies the WebSocket override used when the TUI joins
// an already-running multi-profile server. Read the YAML name when possible;
// the filename is only a fallback for malformed or unavailable files.
func profileNameFromPath(profilePath string) string {
	if info, err := os.Stat(profilePath); err == nil && info.IsDir() {
		return "coding"
	}
	if file, err := os.Open(profilePath); err == nil {
		defer file.Close()
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if !strings.HasPrefix(line, "name:") {
				continue
			}
			name := strings.TrimSpace(strings.TrimPrefix(line, "name:"))
			name = strings.Trim(name, "\"'")
			if name != "" {
				return name
			}
		}
	}
	base := filepath.Base(profilePath)
	if ext := filepath.Ext(base); ext != "" {
		base = strings.TrimSuffix(base, ext)
	}
	if base != "." && base != "" {
		return base
	}
	return "coding"
}

// resolveProfilePath mirrors src/server/index.ts's default-path logic so the
// TUI checks (and, if needed, provisions) the exact file the server will
// load — an empty flag means "~/.harness/profiles/coding.yaml", anything
// else resolves relative to the launch directory, same as Node's resolve().
func resolveProfilePath(profileArg string) (string, error) {
	if profileArg == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("failed to determine home directory: %w", err)
		}
		return filepath.Join(home, ".harness", "profiles", "coding.yaml"), nil
	}
	abs, err := filepath.Abs(profileArg)
	if err != nil {
		return "", fmt.Errorf("failed to resolve profile path %q: %w", profileArg, err)
	}
	return abs, nil
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func currentUser() string {
	if current, err := user.Current(); err == nil && current.Username != "" {
		return current.Username
	}
	return "local-user"
}
