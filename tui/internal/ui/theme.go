package ui

import (
	"fmt"
	"math"
	"strconv"

	"github.com/charmbracelet/lipgloss"
)

type Theme struct {
	Name, Bg, Panel, Border, BorderHi, Purple, Text, Dim, Faint, Accent, OK, Error, Info, Teal, Rose string
}

var Themes = map[string]Theme{
	"ember": {Name: "ember", Bg: "#0b0c0e", Panel: "#111317", Border: "#262b33", BorderHi: "#3a414e", Purple: "#b394e0", Text: "#e7e9ee", Dim: "#99a0ad", Faint: "#595f6b", Accent: "#f1a44d", OK: "#74c79a", Error: "#e87f8d", Info: "#6cb6d9", Teal: "#5fb8a8", Rose: "#e0a1c4"},
	"mono":  {Name: "mono", Bg: "#080808", Panel: "#151515", Border: "#363636", BorderHi: "#585858", Purple: "#c0c0c0", Text: "#eeeeee", Dim: "#aaaaaa", Faint: "#666666", Accent: "#dddddd", OK: "#bbbbbb", Error: "#ffffff", Info: "#cccccc", Teal: "#999999", Rose: "#d4d4d4"},
	"neon":  {Name: "neon", Bg: "#090817", Panel: "#15112a", Border: "#30265a", BorderHi: "#574698", Purple: "#d08cff", Text: "#f3f2ff", Dim: "#aaa6d9", Faint: "#625b91", Accent: "#ffb86c", OK: "#65ffca", Error: "#ff6b9d", Info: "#65d9ff", Teal: "#5ef2c9", Rose: "#ff9ecf"},
}

var currentTheme = Themes["ember"]

func ApplyTheme(name string) string {
	theme, ok := Themes[name]
	if !ok {
		theme = Themes["ember"]
	}
	currentTheme = theme
	ColText = lipgloss.Color(theme.Text)
	ColBg = lipgloss.Color(theme.Bg)
	ColPanel = lipgloss.Color(theme.Panel)
	ColBorder = lipgloss.Color(theme.Border)
	ColBorderHi = lipgloss.Color(theme.BorderHi)
	ColPurple = lipgloss.Color(theme.Purple)
	ColDim = lipgloss.Color(theme.Dim)
	ColFaint = lipgloss.Color(theme.Faint)
	ColAccent = lipgloss.Color(theme.Accent)
	ColAccentDim = lipgloss.Color(blendHex(theme.Accent, theme.Bg, 0.45))
	ColOK = lipgloss.Color(theme.OK)
	ColDel = lipgloss.Color(theme.Error)
	ColInfo = lipgloss.Color(theme.Info)
	ColTeal = lipgloss.Color(theme.Teal)
	ColRose = lipgloss.Color(theme.Rose)
	StText = lipgloss.NewStyle().Foreground(ColText)
	StDim = lipgloss.NewStyle().Foreground(ColDim)
	StFaint = lipgloss.NewStyle().Foreground(ColFaint)
	StAccent = lipgloss.NewStyle().Foreground(ColAccent)
	StAccentB = lipgloss.NewStyle().Foreground(ColAccent).Bold(true)
	StOK = lipgloss.NewStyle().Foreground(ColOK)
	StErr = lipgloss.NewStyle().Foreground(ColDel)
	StInfo = lipgloss.NewStyle().Foreground(ColInfo)
	StTeal = lipgloss.NewStyle().Foreground(ColTeal)
	StRose = lipgloss.NewStyle().Foreground(ColRose)
	StPurple = lipgloss.NewStyle().Foreground(ColPurple)
	return theme.Name
}

// blendHex linearly interpolates two "#RRGGBB" colors; t=0 returns a, t=1
// returns b. Used to derive a dimmed shade of a theme's accent color for the
// running-status pulse, without hand-picking a matching hex per theme.
func blendHex(a, b string, t float64) string {
	ar, ag, ab, aOK := parseHex(a)
	br, bg, bb, bOK := parseHex(b)
	if !aOK || !bOK {
		return a
	}
	mix := func(x, y int) int { return x + int(float64(y-x)*t) }
	return fmt.Sprintf("#%02x%02x%02x", mix(ar, br), mix(ag, bg), mix(ab, bb))
}

// breathe eases between two colors on a smooth sine cycle — 0 and 1 are the
// resting ends, the midpoint of `period` frames is the peak — used anywhere a
// static indicator should read as "alive" rather than static or hard-blinking.
func breathe(from, to string, frame, period int) lipgloss.Color {
	phase := float64(frame%period) / float64(period)
	t := (1 - math.Cos(phase*2*math.Pi)) / 2
	return lipgloss.Color(blendHex(from, to, t))
}

func parseHex(hex string) (r, g, b int, ok bool) {
	if len(hex) != 7 || hex[0] != '#' {
		return 0, 0, 0, false
	}
	rv, err1 := strconv.ParseInt(hex[1:3], 16, 0)
	gv, err2 := strconv.ParseInt(hex[3:5], 16, 0)
	bv, err3 := strconv.ParseInt(hex[5:7], 16, 0)
	if err1 != nil || err2 != nil || err3 != nil {
		return 0, 0, 0, false
	}
	return int(rv), int(gv), int(bv), true
}

func nextTheme(current string) string {
	switch current {
	case "ember":
		return "mono"
	case "mono":
		return "neon"
	default:
		return "ember"
	}
}

// Palette mirrors the C object in src/tui/theme.ts.
var (
	ColBg        = lipgloss.Color("#0b0c0e")
	ColBgDeep    = lipgloss.Color("#08090a")
	ColPanel     = lipgloss.Color("#111317")
	ColBorder    = lipgloss.Color("#262b33")
	ColBorderHi  = lipgloss.Color("#3a414e")
	ColText      = lipgloss.Color("#e7e9ee")
	ColDim       = lipgloss.Color("#99a0ad")
	ColFaint     = lipgloss.Color("#595f6b")
	ColAccent    = lipgloss.Color("#f1a44d")
	ColAccentDim = lipgloss.Color(blendHex("#f1a44d", "#0b0c0e", 0.45))
	ColOK        = lipgloss.Color("#74c79a")
	ColDel       = lipgloss.Color("#e87f8d")
	ColInfo      = lipgloss.Color("#6cb6d9")
	ColPurple    = lipgloss.Color("#b394e0")
	ColTeal      = lipgloss.Color("#5fb8a8")
	ColRose      = lipgloss.Color("#e0a1c4")
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
	StTeal    = lipgloss.NewStyle().Foreground(ColTeal)
	StRose    = lipgloss.NewStyle().Foreground(ColRose)
	StPurple  = lipgloss.NewStyle().Foreground(ColPurple)
)
