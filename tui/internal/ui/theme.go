package ui

import "github.com/charmbracelet/lipgloss"

// Palette mirrors the C object in src/tui/theme.ts.
var (
	ColBg       = lipgloss.Color("#0b0c0e")
	ColBgDeep   = lipgloss.Color("#08090a")
	ColPanel    = lipgloss.Color("#111317")
	ColBorder   = lipgloss.Color("#262b33")
	ColBorderHi = lipgloss.Color("#3a414e")
	ColText     = lipgloss.Color("#e7e9ee")
	ColDim      = lipgloss.Color("#99a0ad")
	ColFaint    = lipgloss.Color("#595f6b")
	ColAccent   = lipgloss.Color("#f1a44d")
	ColOK       = lipgloss.Color("#74c79a")
	ColDel      = lipgloss.Color("#e87f8d")
	ColInfo     = lipgloss.Color("#6cb6d9")
	ColPurple   = lipgloss.Color("#b394e0")
)

// Common reusable styles.
var (
	StText    = lipgloss.NewStyle().Foreground(ColText)
	StDim     = lipgloss.NewStyle().Foreground(ColDim)
	StFaint   = lipgloss.NewStyle().Foreground(ColFaint)
	StAccent  = lipgloss.NewStyle().Foreground(ColAccent)
	StAccentB = lipgloss.NewStyle().Foreground(ColAccent).Bold(true)
	StOK      = lipgloss.NewStyle().Foreground(ColOK)
	StErr     = lipgloss.NewStyle().Foreground(ColDel)
	StInfo    = lipgloss.NewStyle().Foreground(ColInfo)
)
