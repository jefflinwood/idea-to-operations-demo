Cloudflare Artifacts Demo — Outcome-Oriented Software Collaboration

Status: Implementation Spec
Date: October 9, 2026
Target: Cloudflare “Build the Next GitHub” competition
Working thesis: The next GitHub may not start with code. It may start with an outcome.

⸻

1. Purpose

Build a polished, product-quality demonstration of a new model for human/agent software collaboration on top of the existing Zebric + Cloudflare Artifacts agent swarm.

The existing project has already proven the underlying mechanics:

* Multiple agents can independently claim work.
* Agents can make concurrent software changes.
* Changes are represented and integrated using Cloudflare Artifacts.
* Cloudflare Workflows coordinate durable execution.
* Changes are merged against current main.
* Verification runs before changes land.
* Failed or ambiguous work can create a human Decision.
* Workflows wait durably for that Decision.
* Humans can resolve Decisions through the Zebric application.
* Workflows resume afterward.
* Zebric Live Mode pushes server-side changes to the browser without refresh.
* The application runs on Cloudflare Workers.

Freeze this implementation.

Do not redesign the swarm, merge pipeline, Artifact architecture, workflow engine, or Zebric primitives as part of this phase unless a blocking integration defect is discovered.

This project builds the product experience above that machinery.

⸻

2. Product Thesis

GitHub assumes that the central object of software collaboration is a repository.

Its collaboration model is roughly:

Repository → Issue → Branch → Commit → Pull Request → Review → Merge → Release

Agent-created software changes the abstraction.

A product engineer should increasingly be responsible for an outcome, while agents perform much of the implementation work underneath it.

The proposed model is:

Idea → Spec → Outcome → Work → Changes → Verification → Running Software → Responsibility

The repository still exists.

Git still exists.

Artifacts still exist.

Changes still exist.

But these are implementation machinery rather than necessarily being the primary human interface.

The primary human object is an Outcome.

⸻

3. Contest Story

Cloudflare asked participants to “Build the Next GitHub.”

Our answer is not GitHub with AI agents added to it.

Our answer is:

What if the next GitHub isn’t organized around repositories at all?

The demo begins with a Fortune 500 product engineer who owns a business problem.

Previously this person might have been a product owner or technical lead coordinating a development team over multiple sprints.

Now implementation timelines are radically compressed.

The engineer:

1. Starts with an idea.
2. Shapes it into a specification.
3. commits to building it.
4. Watches an agent organization execute it concurrently.
5. Intervenes when human judgment is required.
6. Watches work resume automatically.
7. receives working software.
8. Takes responsibility for the resulting capability.

The agents are important, but managing agents is not the user’s job.

The user’s job is managing the outcome.

⸻

4. Relationship to Idea-to-Operations

This project borrows the Idea-to-Operations responsibility model but does not need to implement the entire Idea-to-Operations product.

The levels represent radius of responsibility, not lifecycle stages.

Level 0 — Proposed

The software does not yet carry operational responsibility.

It may consist of:

* an idea;
* a problem statement;
* research;
* a specification;
* prototypes;
* experiments;
* implementation work.

Nobody depends on it operationally.

Core question:

Could this become useful software?

⸻

Level 1 — Builder

The creator uses the application and accepts responsibility for it.

Core statement:

I depend on this.

This is personal/internal software with a blast radius primarily limited to its builder.

⸻

Level 2 — Team

The builder’s team adopts the application.

Core statement:

We depend on this.

Promotion to Level 2 increases expectations around:

* ownership;
* permissions;
* reliability;
* documentation;
* testing;
* continuity;
* operational responsibility.

⸻

Level 3 — Organization

A division, business unit, or broader organization adopts the application.

Core statement:

The organization depends on this.

This creates stronger expectations around governance, operational ownership, auditability, security, resilience, and change management.

⸻

Important Boundary

Do not model Level 0 → Level 1 → Level 2 → Level 3 as software-development phases.

An application at any responsibility level can continue receiving:

* ideas;
* specifications;
* decisions;
* tasks;
* changes;
* releases;
* incidents;
* improvements.

Responsibility level and software lifecycle are separate dimensions.

⸻

5. Demo Scenario

Use one understandable Fortune 500 internal-software scenario throughout the demo.

Working scenario:

Vendor Access Expiration

Problem:

Temporary vendor accounts are not consistently removed when engagements end. Security wants vendor access to expire automatically unless an internal sponsor renews it.

The exact domain can change if the existing demo application makes another scenario substantially easier, but the replacement must:

* be immediately understandable;
* plausibly exist inside a Fortune 500 company;
* require multiple implementation tasks;
* contain at least one meaningful ambiguity;
* allow concurrent agent work;
* result in visible working software.

Avoid developer-tooling scenarios for the primary Outcome. The collaboration system itself is already technical enough.

⸻

6. Primary UX Principle

The user manages the outcome, not the swarm.

The application must not feel like:

* an agent control panel;
* a collection of terminals;
* a task manager;
* a Jira clone;
* a GitHub clone;
* an LLM chat wrapper.

The primary screen represents:

Vendor Access Expiration

not:

Agent Swarm #183

Agent activity should be visible because it creates excitement and transparency, but it is subordinate to the Outcome.

⸻

7. Primary Application Shell

Build a polished application shell suitable for a product demonstration.

Suggested global navigation:

* Outcomes
* Activity
* Decisions
* Artifacts

Avoid excessive navigation.

The application should feel focused rather than like a complete enterprise suite.

The default landing page should be Outcomes.

⸻

8. Outcomes Home

Create a visually strong Outcomes view.

This should immediately communicate that the user is responsible for a small portfolio of software capabilities.

Example:

Active Outcomes

Vendor Access Expiration
BUILDING
Level 0
68% delivery confidence
6 agents active
1 decision waiting

Quarterly Access Review
OPERATING
Level 1
Healthy

Partner Intake
SHAPING
Level 0
Spec incomplete

For the demo, only Vendor Access Expiration needs full functionality.

Other outcomes can be seeded examples if useful for making the product feel inhabited.

Do not create fake live agent activity for seeded Outcomes.

⸻

9. Outcome Detail — Hero Experience

This is the most important screen in the product.

The page should immediately answer:

1. What are we trying to accomplish?
2. Where are we?
3. What is happening right now?
4. Does the human need to do anything?
5. What has the system produced?

Suggested hierarchy:

Header

Vendor Access Expiration

Short outcome statement.

Status:

BUILDING

Responsibility:

LEVEL 0 · PROPOSED

Owner.

Elapsed time.

Overall progress/confidence.

⸻

Lifecycle

Show a lifecycle separate from responsibility level.

Suggested stages:

Shape → Build → Verify → Launch → Operate

These are presentation stages, not Idea-to-Operations levels.

The exact internal state model can remain whatever the existing application requires.

Do not introduce a new workflow engine merely to support this visualization.

⸻

10. Shape Experience

The demo should begin with an idea rather than an existing task board.

Initial idea:

Temporary vendor accounts aren’t consistently removed when engagements end. Security wants access to expire automatically unless an internal sponsor renews it.

The Shape view turns this into a concise product specification.

Display:

Problem

Clear rewritten problem statement.

Proposed Experience

Concise description of the intended application behavior.

Acceptance Criteria

Several concrete criteria.

Assumptions

Explicit assumptions.

Open Questions

Questions that genuinely affect implementation.

Evidence / Context

Supporting material or constraints.

Implementation Readiness

A visually strong readiness indicator.

Example:

82% Ready

The goal is not to build an elaborate AI product manager.

The goal is to establish that intent is the starting object.

⸻

11. Commit to Build

Provide a strong primary action:

Build Outcome

or:

Start Build

Avoid:

* Generate App
* Run Agents
* Start Swarm

The human is committing to an outcome, not operating robots.

When triggered, existing underlying mechanisms should create/activate the implementation work required by the frozen swarm.

This transition should feel significant.

The UI should visibly move from calm specification work into active execution.

⸻

12. Build Experience

Once work begins, the Outcome page becomes alive.

Show:

Delivery Progress

Examples:

* 12 completed
* 3 active
* 2 waiting
* 1 decision

Live Activity

Use Zebric Live Mode.

Events should appear without refresh.

Examples:

Atlas claimed “Add expiration date to Vendor Access”

Nova started “Sponsor renewal workflow”

Atlas submitted Change #184

Verifier checking Change #184

Change #184 landed

Nova updated its work against current main

Human decision requested

Avoid overwhelming users with raw logs.

Activity should be understandable at a glance.

⸻

13. Agent Visualization

Agents should be visible but secondary.

Show active agents using tasteful compact representations.

Each can display:

* name;
* current task;
* status;
* elapsed time;
* latest meaningful action.

Example:

Atlas
Implementing expiration policy
4m 12s

Nova
Building renewal workflow
2m 48s

Verifier
Checking Change #184
38s

Avoid anthropomorphic gimmicks.

Avoid a terminal-wall aesthetic on the primary Outcome screen.

⸻

14. Swarm Drill-Down

Provide a deliberate way to reveal the underlying machinery.

Possible action:

6 agents active →

Opening it should reveal a visually impressive execution view containing:

* agents;
* tasks;
* dependency relationships where useful;
* changes;
* verification;
* Artifact branches/workspaces;
* integration state;
* workflow state.

This is where the existing swarm implementation can remain visible.

The emotional effect should be:

There is an enormous amount happening underneath this simple Outcome.

Do not make this the default interface.

⸻

15. Cloudflare Artifacts Must Be Visible

Cloudflare Artifacts cannot merely be invisible infrastructure in a competition submission about Artifacts.

The UI should expose their role without forcing users to understand implementation details.

Create an Artifacts / Changes view associated with the Outcome.

It should show that agents work independently and their work is integrated.

Example:

Change #184 — Expiration policy

Created by Atlas

Artifact workspace
atlas/expiration-policy

Based on
main @ a82c91

Status
LANDED

Verification
✓ TypeScript
✓ Tests
✓ Blueprint validation

⸻

16. Collaboration, Not Merely Parallelism

The demo must communicate that agents are collaborating on shared software rather than merely executing unrelated jobs simultaneously.

Where supported by the frozen implementation, expose situations such as:

1. Agent A begins work from current main.
2. Agent B lands a related change.
3. Agent A’s change is evaluated against the updated main.
4. The system either:
    * successfully integrates it;
    * causes Agent A to revise it;
    * or requests a human Decision.

The UI should make this understandable.

Example event:

Main changed while Nova was working.

Change #184 was incorporated into Nova’s context.

or, if revision is required:

Nova is revising its change against the latest version.

Do not fabricate capabilities that the existing implementation does not actually provide.

If current behavior is merge/retry rather than active context injection, describe the real mechanism accurately.

⸻

17. Human Decision Experience

This should be one of the strongest moments in the demo.

When agents encounter meaningful ambiguity, the Outcome should prominently request human judgment.

Example:

Your Decision

How should expired vendor accounts be handled?

The IAM API can disable accounts immediately but cannot schedule deletion.

Recommended

Disable the account at expiration and delete it after 30 days.

Options:

Disable + retain 30 days

Disable only

Review details

Display enough reasoning for the human to decide quickly.

Do not present raw agent transcripts as the decision interface.

⸻

18. Decision Resolution

When the human chooses an option:

1. Persist the Decision using the existing Zebric mechanism.
2. Resume the waiting Cloudflare Workflow.
3. Update the UI through Live Mode.
4. Show the affected work returning to active state.

The user should visibly experience:

Human judgment → system resumes

without:

* refreshing;
* manually restarting agents;
* opening a terminal;
* navigating to another application.

This is a centerpiece of the demo.

⸻

19. Verification

Verification should be visible as first-class collaboration activity.

Show relevant checks such as:

* TypeScript compilation;
* tests;
* blueprint validation;
* integration checks;
* deployment checks.

Avoid dumping CI logs into the main experience.

Summarize them.

Example:

Change #186

✓ Compiles
✓ 18 tests
✓ Blueprint valid
✓ Integrated against latest main

Ready to land

⸻

20. Completion

When all required work is complete, transition the Outcome to a celebratory but professional completion state.

Example:

Ready for Launch

Vendor Access Expiration

Built in 17 minutes

14 tasks completed
7 changes landed
3 agents contributed
2 human decisions
26 verification checks

Primary action:

Launch

Avoid confetti unless extremely subtle.

The emotional response should come from the speed and completeness of the process.

⸻

21. Level 0 → Level 1

After launch, introduce the Idea-to-Operations responsibility model.

The application is now running, but responsibility remains explicit.

Show:

LEVEL 0 · PROPOSED

transitioning to:

Take Responsibility

This application is ready for you to use.

By adopting it, you become responsible for:

* its purpose;
* its data;
* its changes;
* its continued operation.

Primary action:

Adopt as Level 1

After adoption:

LEVEL 1 · BUILDER

You depend on this.

This transition should be concise.

Do not turn the contest demo into a governance tutorial.

⸻

22. Glimpse of Level 2

After Level 1 adoption, show the next possible transition without requiring it during the primary demo.

Example:

Ready for your team?

Promote to Level 2

Before your team depends on this application:

✓ Authentication configured
✓ Critical workflows verified
✓ Owner identified
⚠ Secondary owner required
⚠ Two assumptions remain unresolved

This is a preview of the broader Idea-to-Operations vision.

Do not implement a large Level 2 governance system for the contest.

A credible readiness view is sufficient.

⸻

23. Artifact Model

The word Artifact should have a broader product meaning while remaining technically honest.

An Outcome accumulates evidence of its creation and operation.

Possible artifacts include:

* original idea;
* specification;
* decisions;
* implementation plan;
* agent changes;
* code;
* tests;
* verification results;
* screenshots;
* builds;
* deployments.

Cloudflare Artifacts power the implementation/change portion of this model.

Do not imply that every conceptual product artifact is necessarily stored using the Cloudflare Artifacts API if that is not true.

⸻

24. Visual Design Direction

This must look substantially better than an internal framework demo.

Target:

high-end 2026 developer/product software

Characteristics:

* restrained;
* spacious;
* extremely legible;
* dense only where density communicates activity;
* subtle motion;
* excellent typography;
* meaningful hierarchy;
* polished empty/loading/live states.

Avoid:

* generic Bootstrap admin dashboard;
* giant gradient hero sections;
* excessive cards;
* excessive borders;
* neon AI aesthetics;
* glowing robot imagery;
* terminal-first interfaces;
* fake chat interfaces;
* gratuitous glassmorphism.

The software itself should feel calm while the activity underneath it feels powerful.

⸻

25. Motion

Motion should communicate state transitions.

Use subtle animation for:

* new Live Mode activity;
* progress changes;
* agents becoming active/idle;
* change verification;
* Decision appearance;
* workflow resumption;
* lifecycle stage changes.

The most important transition is:

Decision resolved → waiting workflow wakes → agent activity resumes

This should be visually obvious.

Do not create distracting continuous animations.

⸻

26. Real Data Only During Execution

Do not fake the core demonstration.

The following must reflect actual system state:

* agent status;
* claimed tasks;
* changes;
* verification;
* Decisions;
* workflow state;
* completion;
* Live Mode updates.

Seeded portfolio Outcomes may exist for visual context, but clearly separate them from the live demo Outcome.

The competition demonstration must survive reasonable inspection.

⸻

27. Existing Architecture Is Frozen

Treat the existing Cloudflare project through its current completed phases as Phase A: Collaboration Engine.

It provides:

Runtime

Cloudflare Workers.

Concurrent work

Existing agent swarm.

Change isolation

Cloudflare Artifacts.

Coordination

Cloudflare Workflows.

Domain/application model

Zebric.

Human intervention

Zebric Decisions.

Real-time UX

Zebric Live Mode.

Verification/integration

Existing merge + TypeScript verification pipeline.

Do not replace these components.

⸻

28. New Implementation Phases

Phase 13 — Product Shell

Build:

* application shell;
* Outcomes navigation;
* Outcome list;
* Outcome detail;
* seeded portfolio context;
* responsive layout.

No changes to swarm behavior.

Exit criteria: A user can navigate the product and understand that Outcomes are the primary object.

⸻

Phase 14 — Outcome Model Projection

Create the presentation/model layer required to project existing swarm/task/change state into an Outcome.

Prefer projections/adapters over changing underlying execution entities.

Expose:

* outcome status;
* progress;
* lifecycle presentation state;
* responsibility level;
* active agent count;
* task summary;
* decision count;
* changes;
* elapsed time.

Exit criteria: Existing execution can be understood entirely through an Outcome.

⸻

Phase 15 — Level 0 Shape

Implement:

* idea;
* problem statement;
* proposed experience;
* acceptance criteria;
* assumptions;
* open questions;
* readiness;
* Build Outcome action.

Keep generation deterministic/pre-seeded where necessary for demo reliability.

Do not build a general-purpose autonomous product-management agent unless it already exists.

Exit criteria: The demo can credibly begin with intent rather than tasks.

⸻

Phase 16 — Live Build Experience

Build the primary active Outcome experience.

Connect existing Live Mode events to:

* activity feed;
* agent status;
* progress;
* changes;
* verification;
* waiting states.

Exit criteria: Watching the Outcome during execution is visually compelling without opening the swarm view.

⸻

Phase 17 — Artifacts / Changes Experience

Build a polished view of concurrent implementation work.

Expose:

* change;
* agent;
* Artifact workspace;
* base revision;
* integration state;
* verification;
* landed/revision/waiting state.

Exit criteria: A Cloudflare judge can clearly understand how Artifacts enable concurrent software changes.

⸻

Phase 18 — Swarm Drill-Down

Adapt the existing swarm/task-board experience into a secondary execution view.

Preserve useful existing functionality.

Improve visual hierarchy as necessary.

Do not rebuild it simply for consistency.

Exit criteria: The user can move from Outcome → underlying execution machinery.

⸻

Phase 19 — Human Decision Moment

Polish the Decision experience.

Implement:

* prominent Decision presentation;
* recommendation;
* alternatives;
* concise context;
* resolution;
* Live Mode state transition;
* visible Workflow resumption.

Exit criteria: Human intervention and durable resumption form a reliable demo sequence.

⸻

Phase 20 — Completion / Launch

Implement:

* Ready for Launch state;
* execution summary;
* elapsed time;
* task/change/agent/decision counts;
* Launch action;
* running capability link/view where applicable.

Exit criteria: The demo has an emotionally satisfying end rather than merely an empty task board.

⸻

Phase 21 — Responsibility

Implement minimal:

* Level 0;
* Level 1 adoption;
* Level 2 readiness preview.

Do not implement full organizational governance.

Exit criteria: The demo establishes that responsibility expands after software creation without distracting from the competition story.

⸻

Phase 22 — Demo Hardening

Perform:

* deterministic demo reset;
* seeded starting state;
* predictable ambiguity/Decision;
* failure recovery;
* timing review;
* loading-state review;
* responsive review;
* browser review;
* Live Mode reliability testing;
* deployment verification.

Provide a single documented procedure for resetting the demonstration.

Exit criteria: The complete demonstration can be run repeatedly without manual database surgery or hidden terminal intervention.

⸻

Phase 23 — Contest Story / Recording Mode

Add only lightweight functionality required for recording.

Potential additions:

* clean demo URL;
* optional presentation/demo mode;
* reduced irrelevant navigation;
* predictable seeded scenario;
* stable timing;
* polished final state.

Do not add fake behavior for recording.

Exit criteria: A complete contest video can be recorded from the product itself.

⸻

29. Explicit Non-Goals

Do not build:

* a GitHub replacement;
* source-code hosting;
* a new Git implementation;
* a new agent framework;
* a new task scheduler;
* a new workflow engine;
* a new merge engine;
* a new Artifact abstraction;
* a full Idea-to-Operations SaaS;
* full Level 2 governance;
* Level 3 organizational governance;
* billing;
* marketplace functionality;
* general-purpose project management;
* general-purpose chat;
* autonomous stakeholder research;
* elaborate organizational hierarchy;
* arbitrary workflow design.

The contest deadline is more important than speculative completeness.

⸻

30. Architectural Rule

When the desired UX requires information that exists in the underlying system but is awkwardly represented:

build a projection.

Do not immediately modify the execution architecture.

Example:

If the UI needs:

6 agents active · 12 complete · 3 active · 1 waiting

derive that from existing task/execution state.

Do not create a second task state machine solely for the dashboard.

⸻

31. Zebric Dogfooding Rule

Use existing Zebric capabilities wherever they reasonably fit:

* entities;
* commands;
* policies;
* workflows;
* Decisions;
* events;
* Live Mode;
* Workers runtime.

If the product exposes a genuine missing Zebric primitive, record it separately.

Do not derail the contest project to generalize the primitive unless the demo cannot proceed without it.

⸻

32. Commands Over CRUD

Maintain the existing Zebric design boundary.

Important state transitions should use domain commands rather than arbitrary generated CRUD.

Examples:

* StartBuild
* ResolveDecision
* LaunchOutcome
* AdoptOutcome
* RequestTeamPromotion

Names can follow the existing blueprint conventions.

Agents and humans should operate through the same governed domain model.

⸻

33. Demo Timing Target

Design for approximately 5–7 minutes.

Suggested pacing:

0:00–0:45 — Intent

Introduce the Fortune 500 product engineer and Vendor Access Expiration.

Show Level 0 Shape.

0:45–1:15 — Commit

Review the concise spec.

Start Build.

1:15–3:30 — Collaboration

Agents begin working.

Show concurrent work, Cloudflare Artifacts, changes and verification.

Briefly drill into the swarm.

Return to Outcome.

3:30–4:30 — Human Judgment

Decision appears.

Human resolves it.

Workflow resumes live.

4:30–5:30 — Completion

Remaining work lands.

Outcome becomes Ready for Launch.

Launch.

5:30–6:30 — Responsibility

Adopt as Level 1.

Briefly show Level 2 readiness.

Closing

Return to the central thesis:

The next GitHub may not start with a repository. It may start with an outcome.

⸻

34. Success Criteria

The project succeeds if a viewer can answer all of these questions after watching the demo:

Within 30 seconds

What is the user trying to accomplish?

Vendor Access Expiration.

Not “run an agent swarm.”

Within 60 seconds

What is different from GitHub?

The system organizes human/agent collaboration around an outcome rather than primarily around repository mechanics.

During execution

Are multiple agents actually working concurrently?

Clearly yes.

During execution

Why are Cloudflare Artifacts important?

They allow agents to work on isolated concurrent changes that can be verified and integrated into shared software.

During execution

What happens when agents cannot safely decide something?

They create a governed human Decision and durable execution waits.

After the Decision

Does the system actually resume?

Yes, visibly and without refresh.

At completion

What did the human manage?

The outcome.

At the end

What happens when generated software becomes important?

Responsibility expands from Level 0 toward Builder, Team and eventually Organization.

⸻

35. Final Product Principle

Every major UX decision should be tested against this statement:

You aren’t managing the swarm. You’re managing the outcome.

If a screen primarily asks the product engineer to think about:

* prompts;
* models;
* agent orchestration;
* terminal sessions;
* branches;
* queues;

move that information down a level unless it is necessary for intervention.

If a screen helps the engineer understand:

* intent;
* progress;
* evidence;
* risk;
* decisions;
* results;
* responsibility;

it belongs in the primary experience.

The underlying agent swarm remains the technical engine and the Cloudflare Artifacts competition proof.

The new product demonstrates what becomes possible after the swarm works.

⸻

36. North Star

This project does not need to prove that Idea-to-Operations is definitively “the next GitHub.”

It needs to demonstrate a credible alternative future:

When agents can create software concurrently at machine speed, the scarce human activity shifts from writing and coordinating every change to defining outcomes, exercising judgment, and accepting responsibility for the resulting software.

Build that future convincingly enough that the viewer wants to know what comes next.