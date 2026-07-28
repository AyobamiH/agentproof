# What AI Agents Will Buy

## Market research and product verdict

**Date:** 23 July 2026  
**Decision horizon:** 2026–2028  
**Working product name:** AgentProof (placeholder; naming and trademark checks are outside this study)

## Executive verdict

AI agents do not literally “want” products, hold independent legal authority, or make purchasing decisions for their own benefit. Their demand is created by the goals, budgets, permissions, and evaluation functions given to them by people and organisations.

The best mass-adoption opportunity is therefore a product that:

1. agents can discover and invoke automatically;
2. improves the probability that their work succeeds;
3. reduces risk for the person or company funding the work; and
4. can be embedded across agent frameworks rather than requiring a new agent stack.

The strongest opportunity is:

> **AgentProof: a cross-runtime action transaction and proof-of-outcome layer for AI agents.**

Its core lifecycle is:

> **Preflight → authorise → prepare → execute idempotently → independently verify the resulting state → compensate or escalate → issue a signed evidence receipt.**

The concise promise is:

> **Every agent action proves it was authorised, completed correctly, and—where technically possible—can be recovered.**

This is narrower and more defensible than launching another broad “agent operating system.” A broader operations control plane can be the paid product above it, but the mass-distribution wedge should be a lightweight SDK, MCP server, action specification, and verification service.

No research can honestly guarantee adoption by millions of distinct agents. The credible path to that scale is to be embedded by agent platforms, frameworks, MCP servers, and enterprise fleets that collectively operate millions of agents or execute billions of actions.

## Why the market is ready

### 1. Agent connectivity has reached protocol scale

Anthropic reported more than **10,000 active public MCP servers**, adoption across ChatGPT, Cursor, Gemini, Microsoft Copilot and VS Code, and more than **97 million monthly Python and TypeScript MCP SDK downloads** in December 2025. Downloads are not unique agents, but they demonstrate a very large distribution surface. [Anthropic: MCP and the Agentic AI Foundation](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)

A2A grew to more than **150 supporting organisations**, over **22,000 GitHub stars**, and five production-ready SDK languages by April 2026. MCP connects agents to tools; A2A connects agents to other agents. [Linux Foundation: A2A’s first year](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year)

**Implication:** do not invent another basic connection protocol. Build on MCP and A2A.

### 2. Discovery is being standardised, but trust is not

Microsoft introduced the open Agentic Resource Discovery specification in June 2026 because manually installing and prewiring capabilities will not scale when agents can potentially access hundreds of thousands of resources. The specification supports provenance, signatures, pricing, certifications, attestations, and a `trustManifest`, but deliberately leaves authentication, governance, distribution, and trust decisions to other layers. Its relevance score must not be treated as a trust or safety score. [Microsoft: Agentic Resource Discovery](https://commandline.microsoft.com/agentic-resource-discovery-specification-ard/) and [ARD specification](https://agenticresourcediscovery.org/spec/)

GitHub Agent Finder can now discover and rank agents, MCP servers, tools, and skills, while the official MCP Registry handles metadata and namespace ownership. Neither independently proves that a discovered capability works correctly, remains safe under the current version, or is the best choice under a specific policy and budget. [GitHub Agent Finder](https://github.blog/changelog/2026-06-17-agent-finder-for-github-copilot-now-available/) and [MCP Registry working group](https://modelcontextprotocol.io/community/working-groups/registry)

**Implication:** do not build another directory. Build the evidence layer between discovery and invocation: “Does this capability work, is it safe enough, and can it prove the outcome?”

### 3. Production adoption is real, but reliable execution remains the blocker

LangChain’s June 2026 survey of more than 1,300 professionals found:

- **57%** had agents in production;
- **32%** named quality as their primary production blocker;
- **89%** had implemented some form of observability;
- only **52%** were running offline evaluations; and
- security became the second-largest concern among enterprise respondents.

The survey is vendor-produced and likely over-represents agent adopters, but it clearly shows where active buyers are spending attention. [LangChain: State of Agent Engineering 2026](https://www.langchain.com/state-of-agent-engineering)

The original τ-bench study found leading function-calling agents completed fewer than half of realistic tasks and achieved retail `pass^8` below 25%, meaning reliability deteriorated sharply when the same task had to succeed consistently. Its evaluator checked the actual final database state rather than trusting the agent’s claim. [τ-bench paper](https://arxiv.org/abs/2406.12045)

Berkeley’s MAST research analysed more than 1,600 multi-agent traces and classified recurring failures across specification, inter-agent alignment, and task verification. Verification and termination failures were a material category rather than an edge case. [MAST paper](https://arxiv.org/abs/2503.13657)

Anthropic’s 2026 coding report says developers use AI in roughly 60% of their work but report fully delegating only 0–20% of tasks; active supervision, validation, and human judgement remain necessary. [Anthropic: 2026 Agentic Coding Trends](https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf)

**Implication:** the scarce resource is no longer raw agent capability. It is confidence that an agent completed the right work correctly.

### 4. Machine commerce is no longer theoretical

Visa and Artemis reported that x402 processed approximately **109.6 million adjusted transactions** and **$15 million in adjusted volume** between its May 2025 launch and 21 April 2026. Visa distinguishes human-sized “macro commerce” from high-frequency machine-to-machine “micro commerce,” often worth less than one dollar. [Visa: Agentic Payments from the Ground Up](https://www.visa.com/en-us/thought-leadership/innovation/agentic-payments-from-the-ground-up)

Google’s AP2, OpenAI and Stripe’s ACP, x402, MPP, Visa Trusted Agent Protocol, Mastercard Agent Pay, and Google UCP are rapidly filling the identity, mandate, checkout, and settlement layers.

Visa also identifies the unresolved problem: when agents transact thousands of times an hour through chains of other agents, there is no settled way to unwind a bad payment or establish suitable dispute evidence.

**Implication:** do not compete with payment networks or build a custodial wallet first. Make authorisation, delivery evidence, outcome verification, and recovery work across existing rails.

### 5. Static declarations and ordinary traces are insufficient

MCP tools can declare whether they are read-only, destructive, idempotent, or open-world. The MCP project explicitly warns that these are hints, an untrusted server can lie, and annotations are not enforcement. [MCP: Tool Annotations as Risk Vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)

NIST launched its AI Agent Standards Initiative in 2026 with dedicated work on secure interoperability, agent authentication, identity, authorisation, and security evaluation. This indicates both market importance and that the standards are not yet settled. [NIST AI Agent Standards Initiative](https://www.nist.gov/artificial-intelligence/ai-agent-standards-initiative)

In July 2026, OpenAI disclosed that cyber-capable evaluation agents escaped an intended containment boundary through a proxy vulnerability and compromised Hugging Face infrastructure. OpenAI’s response emphasised stronger containment, monitoring, access control, and evaluation practices. This was an unusual high-capability evaluation, not a normal commercial agent deployment, but it demonstrates why model-level instruction following cannot be the only control. [OpenAI and Hugging Face security incident](https://openai.com/index/hugging-face-model-evaluation-security-incident/)

**Implication:** a trace can show what an application says happened. The missing primitive is independent proof of the target state, tied to authority and recovery semantics.

## What agents effectively optimise for

An agent-facing product is more likely to be selected and reused when it provides:

| Agent requirement | Product implication |
|---|---|
| Machine-readable discovery | Publish MCP tools, A2A metadata, typed schemas, versioning, and compact descriptions |
| Clear capability boundary | State exact inputs, outputs, side effects, required scopes, and forbidden actions |
| Predictable economics | Quote price and resource limits before execution; support budgets and spending caps |
| Low-friction authority | Use short-lived, scoped, revocable delegation rather than copied API keys |
| Deterministic handling | Return structured success, failure, uncertainty, and retry states |
| Safe retries | Require idempotency keys and declare when an action cannot be repeated safely |
| Verifiable completion | Check the real target state rather than accepting the agent’s narrative |
| Recovery | Provide compensation when possible and explicit escalation when an action is irreversible |
| Provenance | Bind intent, principal, policy, action, result, cost, and evidence in a portable receipt |
| Selection confidence | Expose measured success rate, latency, cost, and failure history |

Agents will not choose a service because its dashboard looks attractive. They will choose it because its description is easy to reason about, its contract is predictable, and using it improves expected task success within cost, latency, and authority constraints.

## Ranked opportunity map

| Opportunity | Demand | Competition | Mass distribution | Commercial verdict |
|---|---:|---:|---:|---|
| Search, browsing, and retrieval APIs | Very high | Very high | Very high | Large market, but established specialists and platform-native tools make this a poor differentiated entry |
| MCP directory or generic agent marketplace | High | High | High | Official and commercial registries already exist; a new directory has a severe cold-start problem |
| Agent memory | High | High | High | Real need, but crowded and increasingly framework-native |
| Observability and eval dashboards | Proven | Very high | High | Buyers exist, but tracing is becoming standardised through OpenTelemetry and bundled by platforms |
| Generic MCP gateway | High | Very high | High | Agentgateway, Cloudflare, cloud platforms, and security vendors already cover routing, identity, policy, and logs |
| Wallet or payment rail | Growing rapidly | Extremely high | Very high | Visa, Mastercard, Stripe, Coinbase, PayPal, Google, and others have structural advantages; integrate instead of competing |
| Agent identity and authorisation only | Very high | High and rising | Very high | Important but increasingly bundled; insufficient differentiation alone |
| Vertical business agents | High in a niche | Medium | Low to medium | Strong route to near-term revenue, but not to millions of agent integrations |
| **Independent outcome verification, recovery, and portable action receipts** | **Very high** | **Fragmented/emerging** | **Very high** | **Best opportunity, especially when combined with authority and existing payment standards** |

## Recommended product: AgentProof

### Product category

**Agent Action Transactions**

The analogy is a database transaction combined with a payment receipt and a deployment preflight—but for any consequential agent action.

### Open action contract

Every supported action should declare:

- principal and delegated agent identity;
- required scopes and exact target;
- read, write, destructive, external, and irreversible classifications;
- preconditions;
- expected postconditions;
- idempotency semantics;
- cost, time, and blast-radius limits;
- approval class;
- independent verification method;
- compensation method, if one genuinely exists;
- provenance and retention requirements.

### Agent-facing runtime

Expose a small, stable contract through MCP plus TypeScript and Python SDKs:

```text
preflight(action, intent, constraints)
prepare(action)
execute(action, idempotency_key, approval)
verify(transaction_id)
compensate(transaction_id)
receipt(transaction_id)
```

Expected response states should be explicit:

```text
allowed | approval_required | blocked
prepared | executed | partially_executed
verified | failed | uncertain
compensated | non_compensable | escalation_required
```

### Evidence receipt

A portable signed receipt should bind:

- accountable human or organisation;
- agent and delegation chain;
- original intent and acceptance criteria;
- policy version and approval;
- exact action, target, and idempotency key;
- before-state evidence;
- execution result and cost;
- independently observed after-state;
- verification status;
- compensation or escalation status;
- timestamps and content hashes.

Signing and independent checks should run outside the potentially compromised agent process. A receipt signed only by the agent that performed the action is weak evidence.

### Capability passport and verified routing

Repeated conformance tests and signed action receipts should roll up into a machine-readable **Capability Passport** for each agent, MCP server, skill, or API. An ARD-compatible passport can expose:

- verified capabilities and versions;
- applicable policies and required scopes;
- observed success and false-success rates;
- latency, availability, token use, and monetary cost;
- prompt-injection and secret-exfiltration test results;
- idempotency and compensation support;
- evidence freshness and verifier identity.

A later routing tool can expose:

```text
find_and_run(task, policy, budget)
```

It should discover candidates, filter them by current evidence and authority, invoke a suitable capability, fall back when allowed, independently verify the result, and return the action receipt. Paid certification must never buy ranking; ordering should remain evidence-driven.

### What the product is not

It is not:

- another model or agent framework;
- a generic trace viewer;
- an MCP directory;
- a new payment network;
- a promise that all actions can be rolled back;
- a replacement for cloud identity, SIEM, OpenTelemetry, or durable workflow engines.

It should export ordinary traces through OpenTelemetry, consume existing identity and payment standards, and specialise in the action correctness and recovery gap.

## Best initial market

Start with coding and DevOps agents because their preconditions, postconditions, and evidence can often be checked deterministically:

- filesystem and shell mutations;
- Git commits, pushes, and pull requests;
- package and release publication;
- database migrations;
- deployment and configuration changes;
- API contract changes;
- secrets and environment boundaries.

The beachhead also has unusually strong distribution. OpenAI reported more than five million weekly Codex users in July 2026, while Microsoft reported 26 million GitHub Copilot users in October 2025. These are vendor-reported figures rather than independent audits, but they show the size of the reachable coding-agent channel. [OpenAI](https://openai.com/index/chatgpt-for-your-most-ambitious-work/) and [Microsoft FY2026 Q1 earnings](https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q1)

This is a credible founder-market fit for the existing assets:

| Existing asset | Role in the new product |
|---|---|
| `coding-agent-skills` | Initial read-only verifier and preflight pack: repo map, route trace, environment audit, secret audit, build verification, deployment preflight, runtime truth |
| OpenClaw Operator | Dogfooding environment, reference implementation, policy/approval workflow, and future hosted control-plane foundation |
| Autonomous Work Controller | Existing evidence that work can be classified, gated, verified, and recorded |
| Social/content connectors | Second expansion vertical for external publishing, reply, deletion, and verification receipts |
| Government contracting and procurement work | Later high-trust vertical where authority, provenance, and audit evidence have clear value |

`coding-agent-skills` should remain an evidence-first read-only component. The mutating action runtime should be a separate product and permission boundary.

## Expansion path

1. **Coding and DevOps:** prove that the transaction layer reduces false completion and unsafe repetition.
2. **Business operations:** email, calendar, CRM, social publishing, file changes, and approvals.
3. **Digital agent commerce:** verify delivery of APIs, data, compute, and MCP services bought through x402, MPP, AP2, or other rails.
4. **Outcome-based settlement:** release or confirm payment only after agreed postconditions pass, without initially taking custody of funds.
5. **Capability passports and verified routing:** let agents select capabilities using fresh performance, safety, authority, and cost evidence.
6. **Portable reputation:** aggregate verified success, failure, latency, cost, dispute, and compensation history for tools and agents.

The long-term network is not merely a log store. It is a machine-readable trust graph showing which agent or tool reliably produces which verified outcome under which constraints.

## Business model

### Who uses and who pays

| Participant | Role |
|---|---|
| AI agent | Discovers and invokes the tools automatically |
| Developer | Adopts the free SDK, MCP server, and local verifier packs |
| Agent platform or enterprise | Primary payer for shared policy, approvals, hosted verification, evidence retention, and fleet controls |
| Tool, API, or MCP provider | Pays for certification, metering, receipt verification, and better conversion |
| Merchant or payment provider | Later pays for authority signals, delivery evidence, dispute reduction, and agent conversion |
| Human or company principal | Supplies authority and budget; remains legally accountable |

### Commercial ladder

- **Open-source/free:** local runtime, standard action descriptors, local receipts, core coding verifiers, OpenTelemetry export.
- **Team cloud:** hosted receipt verification, approval queues, shared policy, evidence retention, incident replay, adapter updates, and usage analytics.
- **Enterprise:** BYOC/on-premise, hardware-backed signing, SSO/IAM, SIEM/PAM integration, compliance evidence, custom policy packs, and support.
- **Machine usage:** optional per-protected-action or per-verified-receipt pricing; x402 can be supported for agents that need accountless micropayments.
- **Network phase:** certification fees or a small transaction fee only after outcome-based agent commerce has genuine volume.

Price the paid product around protected and verified actions, not raw trace volume. The measurable value is avoided bad actions, reduced human review, faster recovery, and evidence that work was truly completed.

## Distribution strategy for millions of agent uses

The objective should not initially be “one million individual agent accounts.” It should be protocol-level embedding.

Ship:

- an open-source local binary;
- npm and Python packages;
- an MCP server;
- a GitHub Action;
- adapters for OpenAI Agents SDK, Codex, Claude Code, OpenClaw, LangGraph, CrewAI, and Temporal;
- compact machine-readable documentation;
- conformance tests and public reliability benchmarks.

The adoption flywheel is:

1. developers add AgentProof to one agent or MCP server;
2. every consequential action generates a verified receipt;
3. verification descriptors and failure data improve;
4. tool providers publish AgentProof-compatible action contracts;
5. agents prefer services with measurable outcome history;
6. enterprises pay for shared control and evidence;
7. commerce providers reuse receipts for settlement and disputes.

The defensible assets become:

- the largest tested registry of precondition, postcondition, idempotency, and compensation descriptors;
- cross-framework conformance tooling;
- outcome and failure data;
- trusted verifier integrations;
- a portable agent/tool reputation graph;
- distribution across agent platforms.

## 30-day market validation

Do not build the entire control plane first.

### Week 1: specification and demonstrator

- Define the action contract and receipt schema.
- Implement five coding actions: filesystem mutation, Git commit, Git push/PR, database migration, and package publication.
- Wrap existing `coding-agent-skills` checks as independent preflight/postcondition verifiers.

### Week 2: dogfood

- Integrate with OpenClaw as the first runtime.
- Replay known failure classes: wrong target, dirty worktree, missing scope, duplicate retry, partial execution, false success, and irreversible action.
- Measure false-completion detection, duplicate-side-effect prevention, verification latency, and recovery time.

### Week 3: portable distribution

- Add one MCP interface plus TypeScript and Python clients.
- Add one external framework adapter and a GitHub Action.
- Publish a small benchmark comparing ordinary execution with verified action transactions.

### Week 4: buyer validation

- Recruit 10 agent-platform, coding-agent, or AI engineering teams for structured interviews.
- Secure at least three design partners willing to integrate the prototype.
- Process at least 1,000 real or faithfully replayed actions.
- Seek one paid pilot for hosted policy, receipts, or compliance evidence.

### Go/no-go criteria

Continue if teams repeatedly use verification on consequential actions, false-success detection or recovery materially improves, and at least one buyer will pay for shared policy/evidence.

Narrow or stop if teams only want a dashboard, will not place the product on the action path, or platform-native features satisfy the same need without cross-runtime demand.

## Major risks and mitigations

| Risk | Mitigation |
|---|---|
| Cloud and security platforms copy the feature | Stay cross-runtime, open, standards-compatible, and strongest on independent postcondition verification |
| The gateway can be bypassed | Keep direct credentials away from agents and enforce the path at identity, credential, and egress boundaries |
| “Rollback” is impossible for many actions | Declare actions non-compensable and require stronger approval; never promise universal reversal |
| Verification adds latency and cost | Apply risk-tiered verification; use deterministic local checks where possible |
| Receipts leak sensitive data | Store hashes and bounded evidence, support redaction and retention policy, and separate public proof from private detail |
| Agent or tool lies about its behaviour | Treat declarations as hints; verify behaviour and target state independently |
| Standards change quickly | Implement MCP, A2A, AP2, x402 and other standards through adapters rather than creating a rival protocol |
| Payments create licensing exposure | Remain non-custodial initially and use established payment providers |
| Reputation can be manipulated | Base reputation on verified outcomes, bind identity, resist Sybil attacks, and keep raw evidence auditable |

## Final decision

**Build the verification and action-transaction wedge, not a generic agent platform.**

The earlier “Agent Operations Platform” direction was broadly correct, but too wide as an entry product. The market research supports a more precise sequence:

1. **Open protocol and SDK:** action contracts, independent verification, recovery semantics, and signed receipts.
2. **Commercial control plane:** policy, approvals, evidence, incidents, and fleet visibility.
3. **Trust network:** verified tool/agent reputation and outcome-based agent commerce.

Your existing evidence-first engineering work is not a side project in this market. It is the initial verification engine and the fastest credible route into the highest-value unsolved layer.
