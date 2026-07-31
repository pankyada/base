package main

import (
	"flag"
	"fmt"
	"os"
	"os/user"

	tea "github.com/charmbracelet/bubbletea"

	"harness-tui/internal/prefs"
	"harness-tui/internal/server"
	"harness-tui/internal/ui"
	"harness-tui/internal/ws"
)

var version = "0.1.5"

func main() {
	showVersion := flag.Bool("version", false, "print version")
	profile := flag.String("profile", "", "profile YAML path")
	port := flag.String("port", envOr("HARNESS_PORT", "7337"), "harness server port")
	noSplash := flag.Bool("no-splash", false, "disable boot splash")
	noMotion := flag.Bool("no-motion", false, "disable motion")
	noNotify := flag.Bool("no-notify", false, "disable terminal notifications")
	flag.Parse()

	if *showVersion {
		fmt.Printf("harness-tui %s\n", version)
		return
	}

	serverResult, err := server.EnsureServer(*port, *profile)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer serverResult.Cleanup()
	stdoutInfo, _ := os.Stdout.Stat()
	interactive := stdoutInfo != nil && stdoutInfo.Mode()&os.ModeCharDevice != 0 && os.Getenv("TERM") != "dumb"
	ui.BootSplash(os.Stdout, *profile, *noSplash || !interactive)

	userID := envOr("HARNESS_USER", currentUser())
	client := ws.New(*port, userID)
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
