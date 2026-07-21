package protocol

import (
	"encoding/json"
	"testing"
)

func TestDecodeToken(t *testing.T) {
	m, err := DecodeServer([]byte(`{"type":"token","content":"hi"}`))
	if err != nil {
		t.Fatal(err)
	}
	if m.Type != "token" || m.Content != "hi" {
		t.Fatalf("got %+v", m)
	}
}

func TestDecodeToolStart(t *testing.T) {
	m, err := DecodeServer([]byte(`{"type":"tool_start","name":"read","input":{"path":"a.go"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if m.Name != "read" || m.Input["path"] != "a.go" {
		t.Fatalf("got %+v", m)
	}
}

func TestDecodeStats(t *testing.T) {
	m, _ := DecodeServer([]byte(`{"type":"stats","tokens_in":10,"tokens_out":5,"cost_usd":0.01}`))
	if m.TokensIn != 10 || m.TokensOut != 5 {
		t.Fatalf("got %+v", m)
	}
}

func TestDecodeTodos(t *testing.T) {
	m, _ := DecodeServer([]byte(`{"type":"todos","todos":[{"id":"1","content":"x","status":"pending","priority":"high"}]}`))
	if len(m.Todos) != 1 || m.Todos[0].Content != "x" {
		t.Fatalf("got %+v", m)
	}
}

func TestEncodeClientHello(t *testing.T) {
	b, err := json.Marshal(Hello("alice"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"type":"hello","user_id":"alice"}` {
		t.Fatalf("got %s", b)
	}
}

func TestEncodeMessage(t *testing.T) {
	b, _ := json.Marshal(Message("do it"))
	if string(b) != `{"type":"message","content":"do it"}` {
		t.Fatalf("got %s", b)
	}
}
