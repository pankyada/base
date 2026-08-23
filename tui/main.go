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

var version = "0.3.0"

type launchOptions struct {
	showVersion     bool
	profile         string
	port            string
	noSplash        bool
	noMotion        bool
	noNotify        bool
	reconfigure     bool
	continueSession bool
	resumeID        string
}

func parseLaunchFlags(args []string) (launchOptions, error) {
	options := launchOptions{port: envOr("HARNESS_PORT", "7337")}
	flags := flag.NewFlagSet("harness-tui", flag.ContinueOnError)
	flags.BoolVar(&options.showVersion, "version", false, "print version")
	flags.StringVar(&options.profile, "profile", "", "profile YAML path")
	flags.StringVar(&options.port, "port", options.port, "harness server port")
	flags.BoolVar(&options.noSplash, "no-splash", false, "disable boot splash")
	flags.BoolVar(&options.noMotion, "no-motion", false, "disable motion")
	flags.BoolVar(&options.noNotify, "no-notify", false, "disable terminal notifications")
	flags.BoolVar(&options.reconfigure, "reconfigure", false, "re-run first-run setup, backing up the existing profile")
	flags.BoolVar(&options.continueSession, "continue", false, "resume the newest session on connect")
	flags.StringVar(&options.resumeID, "resume", "", "resume a session by id on connect")
	if err := flags.Parse(args); err != nil {
		return launchOptions{}, err
	}
	return options, nil
}

func main() {
	options, err := parseLaunchFlags(os.Args[1:])
	if err != nil {
		os.Exit(2)
	}

	if options.showVersion {
		fmt.Printf("harness-tui %s\n", version)
		return
	}

	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, fmt.Errorf("failed to determine home directory: %w", err))
		os.Exit(1)
	}
	configPath := filepath.Join(home, ".harness", "config.json")
	if err := setup.EnsureInitialized(configPath, options.reconfigure); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	profilePath, err := resolveProfilePath(options.profile, configPath, home)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	serverResult, err := server.EnsureServer(options.port, profilePath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer serverResult.Cleanup()
	stdoutInfo, _ := os.Stdout.Stat()
	interactive := stdoutInfo != nil && stdoutInfo.Mode()&os.ModeCharDevice != 0 && os.Getenv("TERM") != "dumb"
	profileName := profileNameFromPath(profilePath)
	ui.BootSplash(os.Stdout, profileName, options.noSplash || !interactive)

	userID := envOr("HARNESS_USER", currentUser())
	client := ws.New(options.port, userID, profileName)
	model := ui.NewModel(client, "connecting", userID, prefs.Load(""))
	model.Configure(ui.Options{
		NoMotion:        options.noMotion || os.Getenv("NO_COLOR") != "",
		NoNotify:        options.noNotify,
		NotifyTTY:       interactive,
		ContinueSession: options.continueSession,
		ResumeID:        options.resumeID,
	})
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

// resolveProfilePath mirrors src/server/index.ts's configured default-path
// logic. Explicit --profile paths remain relative to the launch directory;
// otherwise init's selected default profile is re-read from config.json.
func resolveProfilePath(profileArg, configPath, home string) (string, error) {
	if profileArg == "" {
		return setup.ResolveDefaultProfile(configPath, home)
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
