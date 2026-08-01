---
layout: home

hero:
  name: Harness
  text: A WebSocket-based agent harness
  tagline: Wire LLMs to tools, skills, memory, and MCP servers — all from a profile YAML.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/pankyada/base

features:
  - icon: 📋
    title: Profile-driven
    details: Everything — model, tools, memory, hooks — defined in a single YAML file. No code changes to add a new agent type.
  - icon: 🔌
    title: MCP-native
    details: Connect any MCP server (stdio, HTTP, SSE, WebSocket) with per-tool ACL and automatic schema discovery.
  - icon: 🤝
    title: Multi-agent
    details: Agents compose via the agents block. Orchestrate workers with typed I/O contracts and parallel fan-out.
  - icon: 🔒
    title: Instance modes
    details: developer / analyst / assistant / production — each sets default tool ACLs and validates the deployment trust model.
  - icon: ⚡
    title: Triggered + durable
    details: Cron and webhook triggers wake agents on a schedule or external event. Runs checkpoint to disk and resume after crashes.
  - icon: 🧠
    title: Self-improving
    details: Post-session reflection writes key learnings to memory. Skill mining extracts reusable patterns every N sessions.
  - icon: 📐
    title: Context projection
    details: Durable session ledgers project into a budgeted context with restorable tool output, explicit pins, digest promotion, and calibrated token estimates.
---
