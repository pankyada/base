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

func TestEncodeRevampClientMessages(t *testing.T) {
	cases := []struct {
		name string
		msg  ClientMessage
		want string
	}{
		{"models_list", ModelsList(), `{"type":"models_list"}`},
		{"set_model", SetModel("gpt-5.4-mini"), `{"type":"set_model","model":"gpt-5.4-mini"}`},
		{"approval", SetApprovalMode("danger"), `{"type":"set_approval_mode","mode":"danger"}`},
		{"skills_list", SkillsList(), `{"type":"skills_list"}`},
		{"skill_get", SkillGet("linting", "proposed"), `{"type":"skill_get","name":"linting","source":"proposed"}`},
		{"skill_save", SkillSave("linting", "---\nname: linting\ndescription: x\n---"), `{"type":"skill_save","name":"linting","content":"---\nname: linting\ndescription: x\n---"}`},
		{"skill_promote", SkillPromote("linting"), `{"type":"skill_promote","name":"linting"}`},
		{"skill_discard", SkillDiscard("linting"), `{"type":"skill_discard","name":"linting"}`},
		{"skills_mine", SkillsMine(), `{"type":"skills_mine"}`},
		{"compact", Compact(), `{"type":"compact"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := json.Marshal(tc.msg)
			if err != nil || string(got) != tc.want {
				t.Fatalf("encoded=%s err=%v want=%s", got, err, tc.want)
			}
		})
	}
}

func TestDecodeRevampServerMessages(t *testing.T) {
	cases := []struct {
		raw  string
		want func(ServerMessage) bool
	}{
		{`{"type":"tool_prompt","id":"t1","name":"Bash","risk":"danger","reason":"destructive"}`, func(m ServerMessage) bool { return m.Risk == "danger" && m.Reason == "destructive" }},
		{`{"type":"stats","context_window":128000,"context_tokens":64000}`, func(m ServerMessage) bool { return m.ContextWindow == 128000 && m.ContextTokens == 64000 }},
		{`{"type":"models","current":"gpt-5.4-mini","models":[{"id":"gpt-5.4-mini","available":true}]}`, func(m ServerMessage) bool { return m.Current == "gpt-5.4-mini" && len(m.Models) == 1 }},
		{`{"type":"skills","proposed":[{"name":"x","source":"proposed"}],"installed":[]}`, func(m ServerMessage) bool { return len(m.Proposed) == 1 && m.Proposed[0].Source == "proposed" }},
		{`{"type":"notice","level":"warn","message":"check","detail":"details"}`, func(m ServerMessage) bool { return m.Level == "warn" && m.Detail == "details" }},
	}
	for _, tc := range cases {
		m, err := DecodeServer([]byte(tc.raw))
		if err != nil || !tc.want(m) {
			t.Fatalf("decoded=%+v err=%v", m, err)
		}
	}
}
