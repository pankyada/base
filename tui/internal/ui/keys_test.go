package ui

import (
	"reflect"
	"testing"

	"github.com/charmbracelet/bubbles/key"
)

func TestKeyMapBindingsHaveHelp(t *testing.T) {
	m := NewKeyMap()
	v := reflect.ValueOf(m)
	typ := v.Type()
	for i := 0; i < v.NumField(); i++ {
		binding := v.Field(i).Interface().(key.Binding)
		if binding.Help().Key == "" || binding.Help().Desc == "" {
			t.Fatalf("%s has incomplete help: %#v", typ.Field(i).Name, binding.Help())
		}
		if len(binding.Keys()) == 0 {
			t.Fatalf("%s has no key", typ.Field(i).Name)
		}
	}
}

func TestKeyMapHasNoEnabledCollisions(t *testing.T) {
	m := NewKeyMap()
	assertNoKeyCollisions(t, m)
	m.SetCompletionOpen(true)
	assertNoKeyCollisions(t, m)
}

func assertNoKeyCollisions(t *testing.T, m KeyMap) {
	t.Helper()
	v := reflect.ValueOf(m)
	seen := map[string]string{}
	for i := 0; i < v.NumField(); i++ {
		name := v.Type().Field(i).Name
		binding := v.Field(i).Interface().(key.Binding)
		if !binding.Enabled() {
			continue
		}
		for _, pressed := range binding.Keys() {
			if previous, ok := seen[pressed]; ok {
				t.Fatalf("key %q collides between %s and %s", pressed, previous, name)
			}
			seen[pressed] = name
		}
	}
}

func TestKeyMapTabPrecedence(t *testing.T) {
	m := NewKeyMap()
	if !m.Overlay.Enabled() || m.AcceptCompletion.Enabled() {
		t.Fatal("default Tab owner should be overlay")
	}
	m.SetCompletionOpen(true)
	if m.Overlay.Enabled() || !m.AcceptCompletion.Enabled() {
		t.Fatal("open completion should own Tab")
	}
}
