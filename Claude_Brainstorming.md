Great context. This is the core architectural question: **what's a module, what's core, and where do the boundaries go?**

Let me think through this carefully and propose a clean structure.

First, let me visualize the current problem — your designer code is scattered across multiple top-level folders with no module boundary:Now here's my proposal. The key insight: **Designer and Component Library are two separate modules with a clear dependency direction.**Here's the rationale for **two separate modules** rather than one:

**Why separate Designer and Component Library:**
- They have **different lifecycles** — you can update the library without touching the editor
- They have **different data ownership** — library owns parts/symbols/footprints, designer owns projects/nets/traces
- The **dependency is one-way**: designer *consumes* parts from component-library, never the reverse
- **AI tools are domain-specific**: "search for a 100nF capacitor" (library) vs "route trace from U1.pin3 to R4.pin1" (designer)
- **Freemium boundary maps cleanly**: cloud component library = paid feature, local editor = free

**Why Symbol/Footprint editors belong to Component Library, not Designer:**
- They create/edit *library parts*, not *design instances*
- A symbol editor doesn't need schematic context (nets, wires, sheets)
- They share the library data model, not the project data model

Now let me show the detailed folder structure:Now let me address the two foundational patterns that make this work — the **ECS data model** and the **Command pattern**:And here's the **Command flow** — this is what makes deep AI integration possible:Now let me show **how the two modules interact** — the cross-module boundary:Now let me create the full architecture document you can reference:Here's the full architecture proposal. Let me highlight the **three most impactful decisions**:

**1. Two modules, not one** — `designer` and `component-library` are separate modules with a one-way dependency. Symbol/Footprint editors belong to the library module because they create *library parts*, not design instances.

**2. ECS data model** — Instead of flat relational tables, entities are bags of typed components (Position, SymbolRef, FootprintRef, Value, NetConnection). This makes undo/redo trivial (snapshot changed components), AI queries natural ("all caps > 100nF on F.Cu"), and KiCad import/export clean.

**3. Command pattern as the backbone** — Every mutation (user click OR AI tool call) produces a Command with `execute()` and `undo()`. This is what makes deep AI integration possible — the AI uses the exact same mutation path as the user, so undo works for AI actions too.

The document also covers the migration path (5 phases), freemium boundary, module manifest evolution, and open questions for the next round of discussion.

What would you like to dig into first — the ECS data model details, the command pattern implementation, or the module boundary specifics?


---


Let me rethink the architecture with these changes and build the updated specification.Here's the updated high-level architecture with Electron replacing Tauri:Now the core new concept — **modules communicating via SDKs**. Each module exposes a typed SDK interface that other modules import. No direct implementation access:Each module follows the same internal structure — here's the universal module anatomy:Now let me create the complete updated specification:Here's a summary of the **key changes from v1 to v2**:

**1. Tauri → Electron** — The three-layer (React → Bun → Rust) collapses to two processes. Electron main is thin (window management + spawns Bun). No more Rust bridge crates, Stronghold, or stdin/stdout IPC. The React ↔ Bun HTTP/WS communication stays unchanged.

**2. Unified module folder structure** — Instead of code scattered across `src-react/` and `src-ts/`, each module is self-contained under `modules/<name>/` with its own `sdk/`, `react/`, and `backend/` folders. A module owns everything about its domain.

**3. SDK-based inter-module communication** — The biggest architectural change. Modules export typed interfaces (SDKs) that other modules depend on. No internal imports across module boundaries. The DI container wires implementations at startup. This gives you clean dependency inversion and makes it possible to test modules in isolation.

**4. AIService as a proper module** — AI providers, chat, queue, tool registry all live in one module with its own SDK. Other modules call AI through `AIServiceSDK` instead of reaching into infrastructure internals.

**5. Rust/C++ is a future slot** — Each module has a `native/` folder placeholder. When you need a high-performance autorouter or DRC engine, it plugs in via FFI/NAPI without restructuring.

The five **open questions** at the end of the document are worth discussing next — especially the SDK transport question (direct function calls vs HTTP between modules) since that impacts how tightly coupled the backend process is.