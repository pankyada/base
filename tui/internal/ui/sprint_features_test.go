package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestGaugeClampsRatios(t *testing.T) {
	for _, tc := range []struct {
		used, window int
		want         string
	}{{0, 100, "0%"}, {50, 100, "50%"}, {99, 100, "99%"}, {150, 100, "150%"}} {
		if got := stripANSI(contextGauge(tc.used, tc.window, 10)); !strings.Contains(got, tc.want) {
			t.Errorf("gauge %q missing %q", got, tc.want)
		}
	}
}

func TestSparklineSamples(t *testing.T) {
	var spark Sparkline
	if lipgloss.Width(spark.View()) == 0 {
		t.Fatal("empty sparkline")
	}
	for i := 0; i < 25; i++ {
		spark.Add(float64(i))
	}
	if got := lipgloss.Width(spark.View()); got != 20 {
		t.Fatalf("width=%d", got)
	}
}

func TestThemesSwitchAndSpinnerWidths(t *testing.T) {
	if ApplyTheme("mono") != "mono" || ApplyTheme("neon") != "neon" || ApplyTheme("ember") != "ember" {
		t.Fatal("theme switch failed")
	}
	for _, set := range spinnerPersonalities {
		for _, frame := range set {
			if lipgloss.Width(frame) != 1 {
				t.Errorf("spinner %q not one cell", frame)
			}
		}
	}
	if OSC9("done") != "\x1b]9;done\x07" {
		t.Fatal("OSC-9 format changed")
	}
}
