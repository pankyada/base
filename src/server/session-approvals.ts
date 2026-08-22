export type ApprovalDecision = 'allow' | 'prompt' | 'deny'

export interface AutoApprovalGrant {
  name: string
  scope: 'session'
}

/** Session-only grants never override an ACL deny. */
export class SessionApprovalGrants {
  private readonly names = new Set<string>()

  remember(name: string, decision: ApprovalDecision): void {
    if (decision !== 'deny') this.names.add(name)
  }

  check(name: string, decision: ApprovalDecision): AutoApprovalGrant | undefined {
    if (decision === 'deny' || !this.names.has(name)) return undefined
    return { name, scope: 'session' }
  }

  clear(): void {
    this.names.clear()
  }
}
