export interface BudgetConfig { max_cost_usd: number; max_tools: number; max_wall_s: number }

export class BudgetExceeded extends Error {
  constructor(public readonly reason: 'cost' | 'tools' | 'wall') { super(`budget exceeded: ${reason}`) }
}

export class RunBudget {
  private tools = 0
  private readonly started = Date.now()
  constructor(readonly config: BudgetConfig) {}
  checkModel(cost: number): void {
    if (Date.now() - this.started >= this.config.max_wall_s * 1000) throw new BudgetExceeded('wall')
    if (cost >= this.config.max_cost_usd) throw new BudgetExceeded('cost')
  }
  checkTool(): void {
    if (Date.now() - this.started >= this.config.max_wall_s * 1000) throw new BudgetExceeded('wall')
    if (this.tools >= this.config.max_tools) throw new BudgetExceeded('tools')
    this.tools++
  }
}
