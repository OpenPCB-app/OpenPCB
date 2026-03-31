# PCB Design Software: A Comprehensive Baseline Reference

**A new PCB design suite has a rare window of opportunity.** Eagle's sunsetting in June 2026 displaces hundreds of thousands of users, no web-based tool yet handles professional-grade high-speed design, and a $30–100/month "mid-market" gap sits wide open between free tools and $10K+ enterprise licenses. This report documents every major PCB design tool's architecture, features, workflows, and weaknesses across nine dimensions — providing the definitive baseline for building a competitive new suite targeting both web and desktop platforms.

The PCB design software market is valued at **$4–5.5 billion** (2025) and growing at 5–15% CAGR, with cloud deployment as the fastest-growing segment at **15.4% CAGR**. The competitive landscape spans from fully open-source (KiCad, Horizon EDA) through web-native (Flux.ai, EasyEDA) to enterprise stalwarts (Altium Designer, Cadence Allegro). Each tool makes fundamentally different architectural trade-offs — and none has solved the complete problem.

---

## 1. KiCad — the open-source standard-bearer

### General architecture and stack

KiCad 10.0.0, released March 20, 2026, represents the culmination of over three decades of development since Jean-Pierre Charras created the tool at IUT de Grenoble in 1992. Written in **C++ with wxWidgets**, KiCad renders through an **OpenGL-based Graphics Abstraction Layer** (with Cairo 2D fallback) and stores all data in **human-readable S-expression files** — a deliberate design choice that makes every file grep-able, diff-able, and Git-friendly. Internal precision is **1 nanometer** using signed 32-bit integers, yielding a maximum board dimension of ~2.14 meters.

KiCad runs on **Windows (x86_64 and ARM64), macOS, Linux, and FreeBSD**. It is licensed **GPL-3.0+** (libraries under CC-BY-SA 4.0), with no restrictions on board size, layer count, or commercial use. The project joined the Linux Foundation in 2019 and receives sponsorship from CERN, Digi-Key, Raspberry Pi Foundation, HQ Electronics, and Arduino. An estimated **250,000+ users** have downloaded it, with significant growth from Asia.

### Schematic capture

The schematic editor provides an infinite canvas with configurable grid (default 50 mil), manual point-to-point wiring with auto-junction placement, and three label scopes: local (sheet), hierarchical (sheet-to-sheet), and global (design-wide). KiCad supports flat, simple hierarchical, and complex hierarchical schematics where sheets can be instantiated multiple times for reuse. The ERC checks unconnected pins, pin-type conflicts via a configurable conflict matrix, missing power flags, duplicate net names, and driver conflicts. KiCad 10 added hop-over display for non-connected wire crossings and pin table CSV import/export for creating complex parts.

### PCB layout and routing

The board editor supports up to **32 copper layers plus 32 technical layers**. KiCad's **push-and-shove interactive router** — originally contributed by CERN — offers Walkaround, Push & Shove, and Highlight Collisions modes. **Differential pair routing and length tuning** (meander/accordion patterns) are built-in, with KiCad 10 delivering a complete tuning rewrite supporting **time-domain constraints** (picoseconds/femtoseconds, not just length). Via types include through-hole, blind, buried, and micro-vias. The built-in 3D viewer supports STEP and VRML models with raytracing, and KiCad 10 added 3D PDF export. There is **no built-in autorouter** — external FreeRouting (Java, open-source) is the standard workaround via Specctra DSN export.

Design rules use a custom S-expression rule language with conditions and constraints, and KiCad 10 introduced a graphical DRC rule editor. Copper zones support polygon pours with configurable clearance, thermal relief, priority levels, and hatched fills.

### Library and component management

KiCad ships with tens of thousands of symbols and footprints (KiCad 10 added 952 symbols, 1,216 footprints, 386 3D models), organized across four GitLab repositories. Over **78% of footprints are auto-generated** from parametric data definitions. Libraries follow the KiCad Library Conventions (KLC) with automated validation. The Plugin and Content Manager (PCM) serves as a built-in package manager. Third-party libraries come from SnapEDA, Ultra Librarian, Digi-Key, and SparkFun. HTTP Libraries (KiCad 9+) enable sourcing symbol data from external ERP systems.

### Manufacturing outputs

KiCad generates **Gerber RS-274X and X2**, Excellon drill files, BOM (via Python/XSLT scripts), and pick-and-place CSVs. Since KiCad 8, it supports **native IPC-2581 export** (versions B and C). Since KiCad 9, it supports **native ODB++ export** — making it the first open-source EDA tool with this capability. KiCad 9's Jobsets feature automates multi-output generation. Panelization requires third-party plugins: **KiKit** (~2,678 weekly PyPI downloads) is the standard.

### Collaboration and extensibility

KiCad has **no real-time collaboration**. Its text-based file formats are highly Git-friendly, and community tools like CADLAB.io provide visual diffs. The new IPC API (KiCad 9+) uses **Protocol Buffers over nng (nanomsg)** for language-agnostic inter-process communication with running KiCad instances. Python scripting via SWIG bindings is being deprecated (removal planned KiCad 11) in favor of the `kicad-python` PyPI package. The CLI (`kicad-cli`) supports batch operations for CI/CD workflows.

### Key strengths and gaps

KiCad excels at being **completely free, cross-platform, Git-friendly, and increasingly professional-grade**. Its primary gaps are the absence of real-time collaboration, no built-in autorouter or autoplacer, limited supply chain integration, and no native simulation beyond basic ngspice.

---

## 2. Altium Designer — the professional benchmark

### General architecture and stack

Altium Designer 25 is a **Windows-only** desktop application built on approximately **15 million lines of Delphi/Object Pascal** code with some C++ and C# modules. It uses **DirectX 11** for hardware-accelerated rendering and a **VCL (Visual Component Library)** GUI framework. The DXP platform architecture hosts editors as modular server DLLs. File formats (.SchDoc, .PcbDoc) are **proprietary binary** (OLE Compound Document structure), which is a significant limitation for text-based version control.

Altium's history stretches from Protel Systems (1985, Tasmania) through multiple product generations. In August 2024, **Renesas Electronics completed its $5.9 billion acquisition of Altium**. The 2025 product restructuring introduced three tiers: Altium Discover (free exploration), **Altium Develop ($995/year workspace + $995/year per author seat)**, and Altium Agile (enterprise). Traditional perpetual licenses run **$7,000–$11,000 per seat** plus annual maintenance.

### The Altium 365 cloud platform

Built on **AWS** with multi-availability zone storage across 4 regions, Altium 365 provides browser-based design review, **built-in Git-based version control**, real-time commenting, BOM management, ECAD-MCAD collaboration (CoDesigner for SolidWorks, Creo, Inventor, Fusion 360), and manufacturing collaboration. Security includes AES 256-bit encryption at rest, TLS 1.2 in transit, and zero-trust architecture. A GovCloud region serves US government compliance needs.

### Schematic, PCB, and high-speed design

Altium supports both flat and hierarchical schematics with multi-channel design (single schematic replicated across channels with automatic annotation). The PCB editor offers **32 signal layers + 16 internal plane layers = 48 copper layers**, unlimited mechanical layers, and an extremely comprehensive rule-based constraint system with scoped queries.

Interactive routing includes Push, Walkaround, HugNPush, and Stop modes with **glossing** (automatic corner optimization). **ActiveRoute** provides guided interactive routing along user-defined corridors. The Situs topological autorouter handles automated routing. High-speed design is served by **xSignals** (signal paths spanning series components), pin-package delay accounting via IBIS 6 data, impedance-driven width control per layer, and back-drilling support. Sigrity-based signal integrity analysis is available for reflection and crosstalk.

The **3D viewer** uses DirectX 11 for real-time visualization with STEP import/export, and MCAD CoDesigner enables bidirectional collaboration with mechanical CAD tools. **Draftsman** generates automated fabrication and assembly drawings linked to the source design.

### Component management and supply chain

The integrated **Manufacturer Part Search** panel, powered by Octopart, provides data on **95+ million parts** from 400+ distributors including datasheets, parametric data, lifecycle status, and compliance information. Library types range from basic file-based (.SchLib/.PcbLib) through integrated (.IntLib), database (.DbLib), to cloud-managed Workspace Libraries with full lifecycle management, revision tracking, and approval workflows. **ActiveBOM** provides live supply chain data with multi-supplier comparison.

### Manufacturing and collaboration outputs

Altium generates Gerber RS-274X/X2/X3, ODB++, IPC-2581A/B, NC Drill, comprehensive BOM via ActiveBOM, pick-and-place, and 3D PDF. Panelization uses Embedded Board Arrays with support for mixed board types, V-scoring, and tab-routing. The **CAMtastic** CAM editor provides manufacturing preview. Altium 365 enables concurrent multi-user editing, browser-based review for non-licensed stakeholders, and version comparison with graphical diff tools.

### Key strengths and gaps

Altium's unified design environment, industry-leading UI, and mature cloud collaboration set the professional standard. Its weaknesses are **Windows-only** operation, high cost, binary file formats unfriendly to Git, and occasionally slow bug resolution.

---

## 3. Cadence OrCAD and Allegro — enterprise high-speed leaders

### Product structure and positioning

OrCAD and Allegro share the **same underlying engine and .brd database** — OrCAD is a feature-limited Allegro with a seamless upgrade path. OrCAD X starts at **~$1,280/year** (Standard) while full Allegro reaches **$30K–$50K+** perpetual with all options. Cadence holds ~30% of the **~$4.1 billion** global EDA market. Both run primarily on Windows, with Linux support for back-end physical design tools.

The current version is **OrCAD X / SPB 25.1** with "X" branding. OrCAD Capture remains one of the world's most widely used schematic capture tools. Allegro dominates at large enterprises including NVIDIA, Cisco, Ericsson, Fujitsu, and Samsung for networking, computing, telecom, aerospace, and automotive.

### Constraint-driven design and high-speed routing

Allegro's **Constraint Manager** is the most comprehensive constraint system in the industry, organized into Electrical, Physical, Spacing, and Same Net Spacing domains with hierarchical inheritance. Constraint sets (ECSets) support formulas, relational rules, reflection, timing, and crosstalk constraints — capabilities unmatched elsewhere.

The interactive router features **shape-based push-and-shove**, **Timing Vision** (color-coded real-time length/timing visualization), multi-line routing, scribble routing, fiber weave avoidance, and contour-arc routing. The **Allegro PCB Router** (evolved from Specctra) uses three-stage routing: initial connection, ripup-and-retry, and push-and-shove optimization with no limit on layers or pins. **Allegro X AI** introduces generative AI-assisted placement and routing.

**Sigrity Aurora** provides in-design SI/PI analysis directly in the PCB editor — impedance mapping, coupling analysis, IR drop, eye diagrams, and SPICE-based simulation with patented hybrid EM field solvers. The full Sigrity X platform adds SystemSI, XtractIM, PowerSI, Celsius thermal analysis, and Clarity 3D EM solver.

### Manufacturing and team design

Allegro generates Gerber RS-274X/X2, ODB++, and was a **driving force behind IPC-2581 development**. It includes **250+ integrated DFM checks** via DesignTrue technology. **Concurrent Layout** (formerly Symphony Team Design) enables real-time multi-designer collaboration on the same PCB database with object locking. OrCAD X OnCloud provides browser-based viewing and collaboration.

### Technical architecture

The core is written in **C/C++** with **OpenGL/DirectX rendering**. The **SKILL scripting language** (a Lisp dialect) provides deep PCB editor automation. OrCAD Capture uses **Tcl** scripting. The Ultra Librarian acquisition provides **18M+ verified component models** integrated natively.

### Key strengths and gaps

Allegro is unmatched for high-speed, high-complexity designs with the deepest constraint management and SI/PI integration available. Its weaknesses are a **steep learning curve**, high cost, dated UI aesthetics, fragmented application model, and primarily Windows focus.

---

## 4. Autodesk Eagle / Fusion Electronics — a platform in transition

### End-of-life context

Eagle was created by CadSoft (Germany, 1988), acquired by Autodesk in 2016, and is **being discontinued June 7, 2026** — less than 3 months from today. The successor is **Fusion Electronics**, the electronics workspace within Autodesk Fusion. Eagle Premium users retain access until the cutoff with active Fusion subscriptions. The **Fusion subscription costs $680/year** and includes full mechanical CAD, CAM, and electronics design. A free tier limits users to 2 sheets, 2 signal layers, and 80 cm² board area.

### Architecture and legacy

Historically, Eagle was a **C++ application using Qt** — one of the first professional ECAD tools on Linux (since 2000). Eagle's file formats (.sch, .brd, .lbr) became **XML-based in 2011**, making them human-readable and scriptable. The **ULP (User Language Program)** scripting system, a C-like language, gave Eagle significant extensibility with thousands of community scripts. Fusion Electronics dropped **Linux support**, mandates **cloud storage**, and has a **16-layer maximum** — all significant pain points that have driven users to KiCad.

### Current capabilities in Fusion Electronics

Fusion Electronics adds **push-and-shove routing** (absent in classic Eagle), native 3D PCB visualization within Fusion's mechanical CAD context, live ERC/DRC, ODB++ export, SPICE simulation (ngspice v41), a Signal Integrity Extension (Ansys partnership), and KiCad file import (added September 2024). The ECAD-MCAD integration — designing PCBs within 3D mechanical assemblies — is genuinely innovative and unique among PCB tools at this price point.

### Key strengths and gaps

Eagle/Fusion Electronics excels at ECAD-MCAD integration, ease of learning, XML-based open file formats, and the rich ULP ecosystem. Critical weaknesses include no Linux support, mandatory cloud storage, subscription lock-in (designs inaccessible if subscription lapses), limited layer count (16), mediocre autorouter, and an incomplete Fusion Python API for electronics. The community migration away from Eagle represents a significant opportunity for competing tools.

---

## 5. Flux.ai — the AI-native web pioneer

### Platform and AI capabilities

Flux.ai is a **100% browser-based** PCB design tool with **300,000+ users** including Fortune 500 companies. It runs on a custom **3D WebGL rendering engine** and stores all data in the cloud. Pricing starts at **$20/month** (Starter) with a Pro tier at **$142/month per editor**.

Flux's defining feature is its **AI Copilot** — the industry's first AI-powered hardware design assistant, built on custom LLMs fine-tuned for electronic design plus Reinforcement Learning for auto-routing. The October 2025 launch introduced **agentic AI** that can design circuit boards end-to-end from text prompts, using an orchestrator that evaluates prompts and delegates to specialized agents. The AI can generate schematics from natural language, auto-route using RL (producing "human-like" results), research components, parse datasheets, and perform design reviews.

### Design capabilities and collaboration

The tool supports up to **8 layers**, differential pair routing, curved trace routing for RF/antenna design, and pre-configured manufacturer templates from PCBWay, JLCPCB, Osh Park, and others. Real-time **Google Docs-style collaborative editing** is a core feature, with automatic version control and in-project commenting. An **800,000+ component library** provides live pricing and stock data from major distributors.

### Key strengths and gaps

Flux.ai's AI capabilities and collaboration model represent the future direction of PCB design. However, its **8-layer maximum** disqualifies it for complex designs, it has **no layout import** capability (schematic only), no ODB++/IPC-2581 export, no offline mode, and subscription-only pricing with no permanent free tier. The browser interface can lag under heavy loads. It remains best suited for moderately complex designs with intermediate-experienced users.

---

## 6. EasyEDA / JLCPCB EDA — the manufacturing-integrated ecosystem

### Platform and user scale

EasyEDA serves **4.48 million engineers globally** — the largest user base of any PCB tool. It exists in two editions: **EasyEDA Standard** (SVG rendering, web + partial desktop) and **EasyEDA Pro** (WebGL rendering, web + fully offline desktop). Both are **completely free** — JLCPCB provides the software to drive PCB manufacturing orders. EasyEDA, JLCPCB, and LCSC are all part of JLC Group (Shenzhen, founded 2010).

### LCSC component integration

The killer feature is deep integration with the **LCSC component library** — **700,000 to 1,000,000+ components** with real-time inventory, pricing, and stock levels. Parts are categorized as **Basic** (no setup fee for JLCPCB assembly) or **Extended** ($3 per unique part type), which is critical for cost optimization. The design-to-manufacturing pipeline is seamless: Gerber export → "Save to Cart" → JLCPCB ordering page with auto-populated specs, then BOM + pick-and-place upload for SMT assembly.

### Design features

EasyEDA Pro supports **34 copper layers**, WebGL-accelerated performance handling **30,000+ devices**, differential pair routing with length matching, hierarchical design with reuse blocks, and a built-in autorouter. Manufacturing outputs include Gerber RS-274X, Excellon drill, ODB++ (Pro), STEP 3D export, and interactive BOM. The tool imports from Altium, KiCad, Eagle, and LTspice.

### Key strengths and gaps

EasyEDA's combination of zero cost, massive component library with live pricing, and frictionless JLCPCB ordering creates an unmatched design-to-manufacturing pipeline for cost-conscious users. Weaknesses include vendor lock-in to the JLCPCB/LCSC ecosystem, no real-time collaborative editing, SPICE simulation only in Standard edition (not Pro), mixed autorouter quality, and occasional localization issues.

---

## 7. Horizon EDA — library architecture reimagined

### Design philosophy and architecture

Horizon EDA, started in 2016 by a single developer (carrotIndustries), was born from frustrations with KiCad's library structure. Written in **modern C++ with GTK3 (Gtkmm3)** and **OpenGL 3** rendering, it stores all files as **JSON** and uses **SQLite** for internal queries and **ZeroMQ** for inter-process communication. It runs on Linux (primary), Windows, and experimentally on macOS. Licensed GPLv3.

### The pool-based library system

Horizon's **5-level library hierarchy** is its crown jewel:

- **Padstack** → pad geometry with parametric scripts
- **Package** → physical footprint
- **Symbol** → purely visual schematic representation
- **Unit** → electrical pin definitions with alternate names
- **Entity** → references Units via Gates (netlist representation)
- **Part** → maps Entity to Package, includes MPN, manufacturer, datasheet

This architecture separates visual representation from electrical function from orderable part — solving the "parts management problem" more elegantly than any other tool. Libraries are organized as Git-managed **pools** with SQLite indexing and parametric tables for browsing.

### Current status

Version 2.7 "Mirage" (June 2025) supports blind/buried vias, rigid-flex design (v2.6), and uses KiCad's push-and-shove router. It has no autorouter, no SPICE simulation, no real-time collaboration, and a very small community. It remains essentially a one-person project, which represents both its greatest strength (architectural coherence) and weakness (bus factor of 1).

---

## 8. Other notable tools worth tracking

**DipTrace** offers the best price-to-feature ratio in commercial PCB software — perpetual licenses from $75 (Starter) to $995 (Full/unlimited), with shape-based autorouting, differential pairs, ODB++, and IPC-2581C output. **Siemens PADS/Xpedition** provides the enterprise tier with concurrent multi-user design, HyperLynx SI/PI, Valor DFM, and AI-infused placement (Xpedition 2510). **Proteus** uniquely offers **microcontroller co-simulation** — running firmware on virtual PIC, AVR, ARM, and MSP430 MCUs alongside the analog/digital circuit before physical prototyping. **LibrePCB** (GPLv3) focuses on simplicity and discoverability, featuring a CLI for CI/CD pipelines and integrated PCB ordering via Aisler. **CircuitMaker** is Altium's free community tool built on the full Altium engine. **Fritzing** remains the standard for breadboard-view documentation in the Arduino/maker ecosystem. **Quilter AI** and **DeepPCB** represent the cutting edge of AI-only PCB layout generation.

---

## Cross-tool comparison across critical dimensions

| Capability | KiCad 10 | Altium 25 | Allegro X | Fusion Electronics | Flux.ai | EasyEDA Pro | Horizon 2.7 |
|---|---|---|---|---|---|---|---|
| **Price** | Free | $995+/yr | $1,280–50K+/yr | $680/yr | $20–158/mo | Free | Free |
| **Platform** | Win/Mac/Linux | Windows only | Windows (Linux partial) | Win/Mac | Browser | Browser + Desktop | Linux/Windows |
| **Max copper layers** | 32 | 48 | Unlimited | 16 | 8 | 34 | Multi-layer |
| **Push-and-shove** | ✓ | ✓ | ✓ | ✓ | ✗ | Limited | ✓ (KiCad's) |
| **Autorouter** | External only | Situs + ActiveRoute | Allegro PCB Router | Built-in (basic) | AI/RL-powered | Built-in | ✗ |
| **Differential pairs** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Length tuning** | ✓ (time-domain) | ✓ | ✓ (Timing Vision) | ✓ | ✗ | ✓ | ✗ |
| **3D viewer** | OpenGL + raytracing | DirectX 11 native | OpenGL 3DX Canvas | Full 3D MCAD | WebGL | WebGL | OpenGL |
| **Gerber X2** | ✓ | ✓ | ✓ | ✓ | RS-274X only | RS-274X | RS-274X |
| **ODB++** | ✓ (since v9) | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| **IPC-2581** | ✓ (since v8) | ✓ | ✓ (led consortium) | ✗ | ✗ | ✗ | ✗ |
| **Real-time collab** | ✗ | ✓ (Altium 365) | ✓ (Concurrent Layout) | Cloud-based | ✓ (Google Docs-style) | Async only | ✗ |
| **Supply chain data** | ✗ | ✓ (95M+ parts) | ✓ (Ultra Librarian) | Limited | ✓ (live) | ✓ (LCSC, 700K+) | ✗ |
| **SI/PI analysis** | ✗ | ✓ (basic + Sigrity) | ✓ (Sigrity full suite) | ✓ (Ansys extension) | ✗ | ✗ | ✗ |
| **ECAD-MCAD** | STEP export | Bidirectional (IDX) | Bidirectional (IDX) | Native (Fusion) | ✗ | STEP export | STEP export |
| **File format** | S-expr (text) | Binary (proprietary) | Binary (proprietary) | XML (Eagle-derived) | Proprietary cloud | JSON (Std) / Proprietary (Pro) | JSON |
| **Scripting** | Python (IPC API) | DelphiScript/JS/VBS | SKILL (Lisp) | ULP (C-like) | Code tab | API available | Padstack scripts only |
| **Git-friendly** | Excellent | Poor (binary) | Poor (binary) | Good (XML) | N/A (cloud) | Moderate | Excellent (JSON) |

---

## Industry file formats and standards landscape

### The format fragmentation problem

PCB manufacturing requires an ensemble of files — Gerber layers, drill files, BOM, pick-and-place, fab notes — typically **20+ separate files** for a complex board. This fragmentation is a persistent source of miscommunication between designers and fabricators. Three approaches compete to solve this:

**Gerber RS-274X** remains the universal standard accepted by virtually every fabricator on earth. Gerber X2 (2014) adds layer metadata and attributes while maintaining backward compatibility. However, Gerber is fundamentally an "image format" — graphically accurate but lacking intelligent design data like netlist connectivity or component information.

**ODB++**, developed by Valor (now Siemens), consolidates all fabrication data into a single hierarchical archive including stackup, BOM, placement, connectivity, and dimensions. It has broader current adoption than IPC-2581 but is **proprietary**, creating vendor dependency.

**IPC-2581** is the truly open, vendor-neutral XML standard backed by IPC (the industry trade association). IPC-2581C (2020) added bidirectional DFX data exchange and differential pair support. Cadence led a 40+ company consortium to develop it. Adoption is growing rapidly, especially in aerospace, defense, and automotive.

### Key IPC standards for PCB software

**IPC-2221** is the umbrella PCB design standard defining materials, conductor spacing, thermal management, and three product classes (consumer, dedicated service, high-reliability). **IPC-7351** defines surface mount land patterns at three density levels — using IPC-7351 compliant pads increases SMT first-pass yield by **30%+**. A new tool should integrate IPC class enforcement, IPC-7351 footprint generation, and automatic spacing calculation from voltage ratings.

---

## Emerging trends reshaping the market

### AI-assisted design is real but nascent

Multiple players have deployed AI routing: **Zuken AIPR** reports up to 30% reduction in schematic capture time; **Cadence Allegro X AI** uses generative AI for placement and routing; **DeepPCB** (InstaDeep) uses Reinforcement Learning for DRC-clean 2-layer layouts; **Quilter** generates multiple layout candidates using physics-aware AI; and **Flux.ai** offers the most accessible AI copilot. Industry-wide, AI can reduce trace lengths ~20%, board area ~10%, and layer count ~15% in favorable cases. However, **AI still requires human oversight** — DesignCon 2025 experts emphasized it complements rather than replaces judgment, and complex high-speed routing remains beyond current AI capabilities.

### Cloud-native and collaboration paradigms

Cloud deployment is the fastest-growing segment at **15.4% CAGR**, but on-premises still dominates at **58.7% market share** due to IP security concerns. Flux.ai and Altium 365 represent two models: pure browser-based versus hybrid desktop+cloud. Real-time collaborative PCB editing is still in early stages — ECAD file complexity makes true merge/diff operations far harder than software source code. AllSpice.io acknowledges that the "ideal world" of merging independent PCB revisions "is, unfortunately, far away."

### Supply chain integration became non-negotiable

The 2021–2023 chip shortage made real-time component availability a design-phase requirement. Altium (Octopart, 95M+ parts), EasyEDA (LCSC, 700K+ parts with live stock), Flux.ai (live pricing), and Cadence (Ultra Librarian, 18M+ models) all now integrate supply chain data. A new tool must provide real-time pricing, stock levels, lifecycle status, compliance data, and AI-powered alternate part suggestion as baseline features.

### Version control for hardware remains unsolved

While KiCad's S-expression format and Horizon EDA's JSON format enable meaningful Git diffs, **true merge operations for ECAD files remain impossible**. AllSpice.io and CADLAB.io provide visual diff and PR-based review workflows for hardware, but the fundamental challenge persists. A new tool with a carefully designed, diff-friendly data model and built-in visual merge tooling could create significant competitive advantage.

---

## Market gaps a new tool should target

### The mid-market opportunity is enormous

The starkest gap in the PCB tool landscape sits between free/limited tools (KiCad, EasyEDA — capable but lacking collaboration, supply chain, and polished UX) and **$7,000+ enterprise tools** (Altium, Allegro — complete but expensive and Windows-bound). A tool priced at **$30–100/month** with professional features, web+desktop delivery, real-time collaboration, and integrated supply chain data would serve a massive underserved market of small-to-medium engineering teams.

### Eight specific opportunities for differentiation

1. **Eagle migration path**: With EAGLE sunsetting June 2026, hundreds of thousands of users need a new home. Native Eagle XML import is essential. Many resist both KiCad's learning curve and Altium's pricing.

2. **Manufacturing-aware design from the start**: No tool provides real-time DFM validation during routing against a specific fabricator's actual capabilities. Currently, DFM issues surface weeks after design completion. Deep integration with fabricator capability databases could eliminate this costly delay.

3. **Unified component model**: Users consistently report that managing the association between schematic symbol, footprint, 3D model, datasheet, SPICE model, and vendor information is "a major pain." Horizon EDA's 5-level hierarchy shows the right architecture but lacks ecosystem scale. A new tool should adopt a similar clean data model with cloud-backed, crowd-sourced component data.

4. **Git-native architecture with visual merge**: Design a text-based, semantically structured file format from day one that supports meaningful diffs and visual merge conflict resolution — something no tool currently achieves.

5. **Hybrid web+desktop delivery**: Pure browser (Flux) hits performance limits on complex boards; pure desktop (Altium) limits collaboration. A hybrid architecture using **WebGPU** for browser rendering and native GPU for desktop heavy lifting, with seamless project sync, would be optimal.

6. **AI copilot as a standard feature**: AI-powered component selection, reference design generation, autorouting, and DFM checking should be integrated from launch — not bolted on later.

7. **Standards compliance automation**: Built-in IPC class enforcement, automatic conductor spacing from voltage ratings, RoHS/REACH tracking, UL clearance calculation, and IPC-7351 footprint generation would save enormous design time and reduce errors.

8. **Cross-platform from day one**: Windows, macOS, and Linux desktop support plus browser access. No major tool covers all four delivery modes. Eagle's loss of Linux support and Altium's Windows-only stance leave clear openings.

### Recommended technical architecture decisions

| Decision | Recommendation | Rationale |
|---|---|---|
| **File format** | Text-based S-expression or structured JSON, open spec | Git-friendly, diff-able, no vendor lock-in — proven by KiCad and Horizon |
| **Rendering** | WebGPU (browser) + native Vulkan/Metal (desktop) | Hardware-accelerated on all platforms; WebGPU is the successor to WebGL |
| **Internal precision** | Nanometer (64-bit integer) | Future-proofs for advanced packaging; 32-bit limits KiCad to ~2.14m |
| **Language** | Rust core + TypeScript/React UI (web) + native bindings (desktop) | Memory safety, performance, modern ecosystem; Rust already entering EDA (LibrePCB) |
| **Plugin system** | Python + TypeScript APIs with Protocol Buffers IPC | Language-agnostic, proven pattern (KiCad IPC API) |
| **Data model** | Horizon-style 5-level component hierarchy | Cleanest separation of concerns for symbol/footprint/part management |
| **Collaboration** | CRDT-based real-time sync with Git backend | CRDTs enable offline-first with eventual consistency; Git provides version history |
| **Manufacturing output** | Gerber X2 + IPC-2581C + ODB++ from day one | Covers all fabricator requirements; IPC-2581C is the open standard future |

---

## Conclusion: where the opportunity lies

The PCB design tool market is undergoing its most significant disruption in a decade. **Three converging forces** create a rare opening: Eagle's June 2026 end-of-life displaces a massive user base, AI capabilities are becoming table stakes rather than differentiators, and no existing tool delivers professional-grade design in a true hybrid web+desktop architecture with real-time collaboration.

The critical insight from this analysis is that **no single tool excels across all dimensions**. KiCad leads in openness and Git-friendliness but lacks collaboration and supply chain integration. Altium leads in UX and cloud collaboration but is Windows-only and expensive. Allegro leads in high-speed constraint management but has a steep learning curve and dated UI. Flux.ai leads in AI and browser-native collaboration but caps at 8 layers. EasyEDA leads in manufacturing integration but is locked to the JLCPCB ecosystem.

A new tool that combines **KiCad's openness and text-based formats**, **Altium's unified UX and cloud collaboration**, **Allegro's constraint-driven high-speed capabilities**, **Flux's AI copilot and browser delivery**, and **EasyEDA's manufacturing integration** — priced in the $30–100/month mid-market gap — would address the most consistent pain points across all user segments. The architectural foundation should be hybrid web+desktop, Git-native file format, 64-bit precision, and API-first extensibility. Building this correctly from a clean-sheet design, without the technical debt that constrains every incumbent, is the core competitive advantage a new entrant can exploit.