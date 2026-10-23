# StudyMate

### When a study plan breaks, build the next move.

StudyMate helps students organize study tasks, plan exam preparation, understand workload risks, and recover from missed study sessions.

Built for the **Amazon Developer Hackathon 2026 — Alexa+ Track**, StudyMate exposes study operations through a self-hosted Model Context Protocol (MCP) server.

>  **Current implementation:** StudyMate uses deterministic application logic for planning, recovery, and deadline calculations. An LLM or Gemini-powered assistant is not currently integrated.


StudyMate focuses on three practical questions:

- **What needs to be done?** Organize tasks, exams, and estimated effort.
- **What can realistically fit?** Compare workload with available study time.
- **What happens when a plan breaks?** Propose a recovery plan around unfinished work.



## System Architecture

The architecture separates the user interface, application orchestration, study logic, MCP integration, and persistence. This keeps the study operations reusable without coupling them to one interface.

```mermaid
flowchart TB
    subgraph USER["01 · USER EXPERIENCE"]
        U["Student"]
        UI["StudyMate Web Workspace<br/>Tasks · Plans · Exams · Recovery"]
        U <--> UI
    end

    subgraph APP["02 · APPLICATION LAYER"]
        API["Express Application<br/>HTTP Routes · Request Handling"]
        VALID["Input Validation<br/>Structured Data"]
        API <--> VALID
    end

    subgraph CORE["03 · STUDY OPERATIONS ENGINE"]
        direction TB
        TASK["Task & Exam Management"]
        PLAN["Study Plan Proposals"]
        RISK["Deadline Risk Calculations"]
        REC["Session Recovery"]
        APPROVE["Proposal Review<br/>Student Approval"]
        
        TASK --> PLAN
        PLAN --> RISK
        RISK --> APPROVE
        APPROVE -->|Approved plan| TASK
        APPROVE -->|Recovery needed| REC
        REC --> PLAN
    end

    subgraph MCP["04 · MCP INTEGRATION"]
        CLIENT["MCP Client / Simulator"]
        SERVER["MCP Server<br/>Streamable HTTP"]
        TOOLS["Registered Tools<br/>list_tasks · add_task<br/>complete_task<br/>propose_study_plan<br/>list_exams"]
        CLIENT <-->|MCP Requests & Responses| SERVER
        SERVER <--> TOOLS
    end

    subgraph DATA["05 · PERSISTENCE"]
        STORE[("Local JSON Storage<br/>data.json")]
    end

    UI <--> API
    VALID <--> CORE
    TOOLS <--> CORE
    CORE <--> STORE

    classDef user fill:#172554,stroke:#60A5FA,color:#FFFFFF,stroke-width:2px
    classDef app fill:#164E63,stroke:#22D3EE,color:#FFFFFF,stroke-width:2px
    classDef core fill:#312E81,stroke:#A5B4FC,color:#FFFFFF,stroke-width:2px
    classDef mcp fill:#064E3B,stroke:#34D399,color:#FFFFFF,stroke-width:2px
    classDef data fill:#713F12,stroke:#FBBF24,color:#FFFFFF,stroke-width:2px

    class U,UI user
    class API,VALID app
    class TASK,PLAN,RISK,REC,APPROVE core
    class CLIENT,SERVER,TOOLS mcp
    class STORE data
```


## Key Features

| Feature | Purpose |
|---|---|
| Study Planning | Proposes plans based on task estimates and available time |
| Deadline Risk Radar | Compares workload against available time |
| Session Recovery | Replans around unfinished work |
| Task & Exam Tracking | Organizes preparation |
| Persistent State | Stores application data locally |
| Student Approval | Keeps proposed changes under user control |

## Alexa+ Track: MCP Integration

**Endpoint:** `POST /mcp`

| MCP Tool | Purpose |
|---|---|
| `list_tasks` | Retrieve tasks |
| `add_task` | Add a task |
| `complete_task` | Complete a task |
| `propose_study_plan` | Propose a study plan |
| `list_exams` | Retrieve exams |

MCP lets compatible clients discover and invoke structured application tools. The project currently provides a self-hosted MCP server and web demonstration; it is not a deployed Alexa+ device integration or an Amazon-certified Agent Skill.


### MCP Communication

```mermaid
sequenceDiagram
    autonumber
    participant C as MCP Client / Simulator
    participant S as StudyMate MCP Server
    participant V as Validation
    participant E as Study Operations Engine
    participant D as Local Storage

    C->>S: Initialize MCP session
    S-->>C: Protocol capabilities
    C->>S: Discover available tools
    S-->>C: Tool definitions and schemas
    C->>S: Call a supported tool
    S->>V: Validate tool arguments
    V->>E: Execute valid operation
    E->>D: Read or update application state
    D-->>E: Stored data or result
    E-->>S: Operation result
    S-->>C: MCP tool response
```

The sequence shows the intended interaction pattern. Actual responses and available capabilities depend on the implemented server.

## Tech Stack

Node.js · Express.js · MCP SDK · Zod · dotenv · HTML/CSS/JavaScript · JSON storage

## Run Locally

**Requirements:** Node.js 20+ and npm.

```bash
git clone https://github.com/shikharxcodes/amzan_hack.git
cd amzan_hack
npm install
npm start
```

Open `http://localhost:3000` if using the default port.

Run tests:

```bash
npm test
```

## Judging Alignment

| Criterion | Project evidence |
|---|---|
| Technical Implementation | MCP tools and protocol interactions |
| Design | Organized study workspace |
| Potential Impact | Study planning and missed-session recovery |
| Quality of Idea | A student-focused workflow exposed through MCP |

These are intended areas of alignment, not guaranteed judging scores.

## Limitations & Next Steps

- No AI/LLM integration currently.
- Local JSON storage; designed for single-user use.
- No production authentication or hosted deployment.
- Future work: optional AI study assistance, multi-user storage, and additional integrations.

## Developer Tool Feedback

The submission should include honest feedback on the tools, APIs, and SDKs actually used, including the MCP SDK, Node.js, Express.js, and validation/configuration libraries.

## Judging Criteria Alignment

| Criterion | StudyMate's Strength |
|---|---|
| **Technical Implementation** | MCP server, tool discovery, structured tool calls |
| **Design** | Organized, student-friendly study workspace |
| **Potential Impact** | Practical study planning and session recovery |
| **Quality of Idea** | Combines workload analysis, planning, and recovery |

**Engineering highlights:** Modular architecture · Explainable calculations · User-approved plans · Persistent state


## License

[MIT License](LICENSE) · Copyright © 2026 Shikhar Maurya.


