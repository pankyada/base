export type AudioCodec = 'opus' | 'pcm16'

export interface SpeechToText {
  readonly name: string
  transcribe(stream: AsyncIterable<Uint8Array>, opts: { sample_rate: number; codec: AudioCodec; language?: string; signal?: AbortSignal }): AsyncIterable<{ text: string; final: boolean }>
}

export interface TextToSpeech {
  readonly name: string
  synthesize(text: AsyncIterable<string>, opts: { voice?: string; sample_rate: number; signal?: AbortSignal }): AsyncIterable<Uint8Array>
}

export interface VoiceProvider {
  readonly name: string
  stt?: SpeechToText
  tts?: TextToSpeech
}
