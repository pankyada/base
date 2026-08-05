export class ParkSignal extends Error {
  readonly pendingId: string
  sessionId?: string

  constructor(pendingId: string) {
    super(`run parked for pending input ${pendingId}`)
    this.name = 'ParkSignal'
    this.pendingId = pendingId
  }
}

export function isParkSignal(error: unknown): error is ParkSignal {
  return error instanceof ParkSignal || (error instanceof Error && error.name === 'ParkSignal' && typeof (error as any).pendingId === 'string')
}
