export interface BudgetConfig { max_cost_usd: number; max_tools: number; max_wall_s: number }

export interface BudgetSnapshot {
  cost_usd: number
  tools: number
  wall_s: number
}

export class BudgetConfigError extends Error {
  constructor(message = 'malformed autonomy budget; run refuses to start') {
    super(message)
    this.name = 'BudgetConfigError'
  }
}

export class BudgetExceeded extends Error {
  constructor(
    public readonly reason: 'cost' | 'tools' | 'wall',
    public readonly spent: BudgetSnapshot,
    public readonly limit: number,
    public readonly in_flight: string,
  ) {
    super(`budget exceeded: ${reason} (spent ${formatSpent(spent)}, limit ${limit}, in flight ${in_flight})`)
    this.name = 'BudgetExceeded'
  }
}

export class RunBudget {
  private tools = 0
  private readonly started: number

  constructor(
    readonly config: BudgetConfig,
    private readonly now: () => number = () => Date.now(),
  ) {
    validateBudgetConfig(config)
    this.started = now()
  }

  checkModel(cost: number, model = 'model call'): void {
    this.checkWall(model, cost)
    if (!Number.isFinite(cost) || cost >= this.config.max_cost_usd) {
      throw new BudgetExceeded('cost', this.snapshot(cost), this.config.max_cost_usd, model)
    }
  }

  checkTool(tool = 'tool call', cost = 0): void {
    this.checkWall(tool, cost)
    if (this.tools >= this.config.max_tools) {
      throw new BudgetExceeded('tools', this.snapshot(cost), this.config.max_tools, tool)
    }
    this.tools++
  }

  snapshot(cost = 0): BudgetSnapshot {
    return { cost_usd: Number.isFinite(cost) ? cost : 0, tools: this.tools, wall_s: (this.now() - this.started) / 1000 }
  }

  /** Child execution shares this ledger; it can spend only the parent's remainder. */
  inherit(): RunBudget { return this }

  private checkWall(inFlight: string, cost: number): void {
    const wall = (this.now() - this.started) / 1000
    if (wall >= this.config.max_wall_s) {
      throw new BudgetExceeded('wall', { cost_usd: Number.isFinite(cost) ? cost : 0, tools: this.tools, wall_s: wall }, this.config.max_wall_s, inFlight)
    }
  }
}

export function validateBudgetConfig(value: unknown): asserts value is BudgetConfig {
  if (!value || typeof value !== 'object') throw new BudgetConfigError()
  const config = value as Record<string, unknown>
  if (!Number.isFinite(config.max_cost_usd) || (config.max_cost_usd as number) < 0) throw new BudgetConfigError('invalid budget max_cost_usd; run refuses to start')
  if (!Number.isInteger(config.max_tools) || (config.max_tools as number) < 0) throw new BudgetConfigError('invalid budget max_tools; run refuses to start')
  if (!Number.isFinite(config.max_wall_s) || (config.max_wall_s as number) < 0) throw new BudgetConfigError('invalid budget max_wall_s; run refuses to start')
}

function formatSpent(spent: BudgetSnapshot): string {
  return `${spent.cost_usd.toFixed(4)} USD / ${spent.tools} tools / ${spent.wall_s.toFixed(1)}s`
}
