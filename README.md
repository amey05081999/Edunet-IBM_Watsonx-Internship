IBM University Engagement
Project Submission
“Exploring the Power of Agentic AI with IBM Granite and IBM Bob”

Project Layout
smart-home-energy-advisor/
├── src/
│   ├── index.ts                 ← MCP server entry point — registers all tools & prompt
│   ├── data/
│   │   ├── meterStore.ts        ← In-memory data store (meters, readings, appliances)
│   │   └── tariffs.ts           ← Tariff definitions & rate lookup
│   └── analysis/
│       └── energyAnalysis.ts    ← Pure analysis engine (no I/O side-effects)
├── dashboard.html               ← Standalone browser UI (chart dashboard)
├── index.mjs                    ← Pre-built ESM entry point
├── package.json
└── tsconfig.json
