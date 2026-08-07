# Voice

Streaming audio in and out, as a pair of pluggable interfaces. Core defines
what speech-to-text and text-to-speech look like and never implements
either — no audio codec, no vendor SDK, no dependency added to core for a
feature most profiles never turn on.

## Configuration

```yaml
system_prompt: ./assistant.md
system_prompt_voice: ./assistant-voice.md   # optional shorter prompt for voice turns
voice:
  stt: { provider: local-stt, config: {} }
  tts: { provider: local-tts, config: { voice: calm } }
  fallback: { stt: openai-stt, tts: openai-tts }
  endpointing: { silence_ms: 700, max_utterance_s: 60 }
  barge_in: true
```

A provider is a plugin module dropped under `.agents/voice/` and referenced
by name — the same four-level discovery convention as
[skills](./skills) and custom tools. `system_prompt_voice`, when set, is
selected automatically for a connecting channel that declares audio
capability, so a voice turn can use a shorter, speech-appropriate prompt
without a second profile.

## Protocol

A client that supports audio sends `hello.audio_supported: true` on
connect, then drives a turn with:

```
audio_start                 → begin a streaming utterance
<binary audio_chunk frames> → raw audio, codec/sample-rate negotiated in audio_start
audio_end                   → utterance complete
```

The server responds with `transcript_partial` events as speech-to-text
produces them, then streams the model's response through text-to-speech —
chunked at **sentence boundaries** so audio starts playing before the model
has finished the whole turn, rather than waiting for a complete response
before synthesis begins — as binary `audio_out_chunk` frames.

## Endpointing and barge-in

`endpointing.silence_ms` decides how long a pause means "the user is done
talking"; `max_utterance_s` is a hard cap so a stuck microphone can't hang a
turn forever.

`barge_in: true` means a client can interrupt mid-response. Barge-in cancels
synthesis, playback, **and the in-flight model turn together** — not just
the audio — and appends an interrupted-marked partial to the session ledger
instead of silently losing or duplicating the turn. That partial is exactly
what [context projection](./context) and [memory](./memory) see afterward,
so an interrupted answer doesn't confuse the next turn.

## See also

- [Profiles](./profiles) — the `voice:` field in full
- [Automation](./automation#channels) — a voice-capable channel is just
  another channel adapter from the harness's point of view
