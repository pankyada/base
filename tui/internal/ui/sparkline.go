package ui

import "strings"

type Sparkline struct{ samples []float64 }

func (s *Sparkline) Add(value float64) {
	s.samples = append(s.samples, value)
	if len(s.samples) > 20 {
		s.samples = s.samples[len(s.samples)-20:]
	}
}

func (s Sparkline) View() string {
	if len(s.samples) == 0 {
		return StFaint.Render("▁")
	}
	max := 0.0
	for _, sample := range s.samples {
		if sample > max {
			max = sample
		}
	}
	levels := []rune("▁▂▃▄▅▆▇█")
	var out strings.Builder
	for _, sample := range s.samples {
		index := 0
		if max > 0 {
			index = int(sample / max * float64(len(levels)-1))
		}
		out.WriteRune(levels[index])
	}
	return out.String()
}
