import { useEffect, useId, useMemo, useState, type ReactElement } from "react";
import {
  ArrowLeftRight,
  Boxes,
  ChartNoAxesGantt,
  Code2,
  Download,
  Maximize2,
  Network,
  PieChart,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

/** Map a Mermaid source's leading keyword to a friendly diagram-type label. */
function diagramType(source: string): string {
  const first =
    source
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("%%")) ?? "";
  const kw = first.toLowerCase();
  if (kw.startsWith("flowchart") || kw.startsWith("graph")) return "Flowchart";
  if (kw.startsWith("statediagram")) return "State";
  if (kw.startsWith("sequencediagram")) return "Sequence";
  if (kw.startsWith("classdiagram")) return "Class";
  if (kw.startsWith("erdiagram")) return "ER";
  if (kw.startsWith("mindmap")) return "Mindmap";
  if (kw.startsWith("pie")) return "Pie";
  if (kw.startsWith("gantt")) return "Gantt";
  if (kw.startsWith("journey")) return "Journey";
  return "Diagram";
}

/** Per-type pill icon — Lucide approximations of the showcase's Tabler icons. */
function diagramIcon(type: string): LucideIcon {
  switch (type) {
    case "Sequence":
      return ArrowLeftRight;
    case "Mindmap":
    case "ER":
      return Network;
    case "Pie":
      return PieChart;
    case "Class":
      return Boxes;
    case "Gantt":
      return ChartNoAxesGantt;
    default:
      return Workflow; // Flowchart, State, Journey, generic
  }
}

type RenderState =
  | { status: "loading"; previousSvg?: string }
  | { status: "rendered"; svg: string }
  | { status: "pending"; message: string; previousSvg?: string }
  | { status: "error"; message: string; previousSvg?: string };

type MermaidModule = typeof import("mermaid");

const MAX_MERMAID_TEXT_SIZE = 50_000;
const MAX_MERMAID_EDGES = 500;
const STREAMING_RENDER_DEBOUNCE_MS = 200;

let renderChain: Promise<void> = Promise.resolve();

function enqueueRender<T>(work: () => Promise<T>): Promise<T> {
  const run = renderChain.then(work, work);
  renderChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function hashSource(source: string): string {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function toRenderId(prefix: string, source: string): string {
  return `openpcb-mermaid-${prefix.replace(/[^a-zA-Z0-9_-]/g, "")}-${hashSource(source)}`;
}

function currentThemeMode(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function useRootThemeMode(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">(() => currentThemeMode());

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const update = () => setMode(currentThemeMode());
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return mode;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function previousSvgFromState(state: RenderState): string | undefined {
  if (state.status === "rendered") return state.svg;
  return state.previousSvg;
}

// Shared 5-color slice palette (matches BOM severity + --diagram-pie-* tokens).
const PIE_PALETTE = ["#7C3AED", "#34D399", "#FBBF24", "#F87171", "#94A3B8"];
const FONT_STACK =
  "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// Mermaid's theming engine only understands hex colors (not names, and rgba()
// is unreliable in its derivation math). Use 8-digit hex for translucency.
type ThemeVars = Record<string, string | boolean | number>;

/** Repeat the 5-color palette across mermaid's pie1..pie12 slots. */
function pieVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 1; i <= 12; i++) out[`pie${i}`] = PIE_PALETTE[(i - 1) % 5]!;
  return out;
}

const PIE_TEXT_DARK = {
  pieStrokeColor: "#0A0E14",
  pieOuterStrokeColor: "#0A0E14",
  pieTitleTextColor: "#F3F4F6",
  pieSectionTextColor: "#F3F4F6",
  pieLegendTextColor: "#D1D5DB",
  pieOpacity: "1",
};

/**
 * OpenPCB-themed Mermaid variables, per DESIGN_IMPROVEMENTS "Mermaid theme
 * config". MUST be paired with `theme:"base"` (the only customizable theme).
 * `fontFamily` is set top-level in `initialize` — NOT here — because a known
 * mermaid bug (#3680) makes themeVariables no-op when fontFamily is among them.
 * `darkMode` is a real boolean so the engine derives shades correctly.
 */
function themeVariablesFor(mode: "light" | "dark"): ThemeVars {
  if (mode === "dark") {
    return {
      darkMode: true,
      background: "#0A0E14",
      primaryColor: "#13191F",
      mainBkg: "#13191F",
      secondaryColor: "#10141B",
      tertiaryColor: "#10141B",
      primaryTextColor: "#F3F4F6",
      secondaryTextColor: "#F3F4F6",
      tertiaryTextColor: "#D1D5DB",
      textColor: "#D1D5DB",
      primaryBorderColor: "#A78BFA",
      secondaryBorderColor: "#5B4B8A",
      tertiaryBorderColor: "#5B4B8A",
      nodeBorder: "#A78BFA",
      nodeTextColor: "#F3F4F6",
      lineColor: "#9CA3AF",
      defaultLinkColor: "#9CA3AF",
      // Subgraph clusters + edge labels must sit on the dark canvas.
      clusterBkg: "#10141B",
      clusterBorder: "#5B4B8A",
      titleColor: "#A78BFA",
      edgeLabelBackground: "#0A0E14",
      actorBkg: "#13191F",
      actorBorder: "#A78BFA",
      actorTextColor: "#F3F4F6",
      actorLineColor: "#9CA3AF",
      signalColor: "#D1D5DB",
      signalTextColor: "#D1D5DB",
      labelBoxBkgColor: "#13191F",
      labelBoxBorderColor: "#A78BFA",
      labelTextColor: "#D1D5DB",
      noteBkgColor: "#10141B",
      noteTextColor: "#D1D5DB",
      noteBorderColor: "#A78BFA",
      fontSize: "13px",
      ...pieVars(),
      ...PIE_TEXT_DARK,
    };
  }
  return {
    darkMode: false,
    background: "#ffffff",
    primaryColor: "#f5f3ff",
    mainBkg: "#f5f3ff",
    secondaryColor: "#eef2ff",
    tertiaryColor: "#f1f5f9",
    primaryTextColor: "#1e1b2e",
    textColor: "#334155",
    primaryBorderColor: "#7C3AED",
    nodeBorder: "#7C3AED",
    nodeTextColor: "#1e1b2e",
    lineColor: "#64748b",
    defaultLinkColor: "#64748b",
    clusterBkg: "#f1f5f9",
    clusterBorder: "#cbd5e1",
    titleColor: "#6d28d9",
    edgeLabelBackground: "#ffffff",
    actorBkg: "#f5f3ff",
    actorBorder: "#7C3AED",
    noteBkgColor: "#eef2ff",
    noteTextColor: "#334155",
    fontSize: "13px",
    ...pieVars(),
    pieStrokeColor: "#ffffff",
    pieOuterStrokeColor: "#ffffff",
    pieTitleTextColor: "#1e1b2e",
    pieSectionTextColor: "#ffffff",
    pieLegendTextColor: "#334155",
    pieOpacity: "1",
  };
}

async function renderMermaid(
  mermaidModule: MermaidModule,
  id: string,
  source: string,
  mode: "light" | "dark",
): Promise<string> {
  const mermaid = mermaidModule.default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    suppressErrorRendering: true,
    maxTextSize: MAX_MERMAID_TEXT_SIZE,
    maxEdges: MAX_MERMAID_EDGES,
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "suppressErrorRendering",
      "maxEdges",
      "htmlLabels",
      "themeVariables",
    ],
    deterministicIds: true,
    deterministicIDSeed: id,
    // fontFamily MUST be top-level, not in themeVariables (mermaid#3680:
    // themeVariables silently no-op when fontFamily is among them).
    fontFamily: FONT_STACK,
    theme: "base",
    themeVariables: themeVariablesFor(mode),
  });

  const parsed = await mermaid.parse(source, { suppressErrors: true });
  if (!parsed) throw new Error("Invalid Mermaid diagram syntax");
  const { svg } = await mermaid.render(id, source);
  return svg;
}

function downloadSvg(svg: string, type: string): void {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${type.toLowerCase()}-diagram.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Card-framed Mermaid render: title bar with diagram-type pill + controls
 * (view source / download SVG / fullscreen). `source` enables the controls.
 */
function MermaidSvgFigure({
  svg,
  caption,
  source,
  dark,
}: {
  svg: string;
  caption?: string;
  source?: string;
  /** Force the card chrome to dark — the chat surface is dark even when the
   *  document theme class is "light", so `dark:` variants can't be relied on. */
  dark: boolean;
}): ReactElement {
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const type = source ? diagramType(source) : "Diagram";
  const TypeIcon = diagramIcon(type);
  const controlCls = dark
    ? "rounded p-1 hover:bg-slate-800"
    : "rounded p-1 hover:bg-slate-200 hover:text-slate-600";

  return (
    <figure
      className={`my-3 max-w-full overflow-hidden rounded-lg border ${dark ? "border-slate-800 bg-slate-950/60" : "border-slate-200 bg-white"}`}
    >
      <div
        className={`flex items-center gap-2 border-b px-3 py-1.5 ${dark ? "border-slate-800 bg-slate-900/60" : "border-slate-200 bg-slate-50"}`}
      >
        <TypeIcon
          className={`h-3.5 w-3.5 shrink-0 ${dark ? "text-violet-400" : "text-violet-500"}`}
        />
        <span
          className={`rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${dark ? "text-violet-300" : "text-violet-700"}`}
        >
          {type}
        </span>
        {caption ? (
          <figcaption
            className={`truncate text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}
          >
            {caption}
          </figcaption>
        ) : null}
        {source ? (
          <div className="ml-auto flex items-center gap-0.5 text-slate-400">
            <button
              type="button"
              aria-label="View source"
              onClick={() => setShowSource((v) => !v)}
              className={controlCls}
            >
              <Code2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Download SVG"
              onClick={() => downloadSvg(svg, type)}
              className={controlCls}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Fullscreen"
              onClick={() => setFullscreen(true)}
              className={controlCls}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>
      <div
        className={`openpcb-mermaid-diagram min-w-fit overflow-x-auto p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full ${dark ? "bg-[#0A0E14]" : "bg-white"}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {showSource && source ? (
        <pre
          className={`max-h-64 overflow-auto border-t p-3 font-mono text-[11px] ${dark ? "border-slate-800 bg-slate-900/60 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-700"}`}
        >
          {source}
        </pre>
      ) : null}
      {fullscreen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
          onClick={() => setFullscreen(false)}
        >
          <div
            className={`relative max-h-full max-w-full overflow-auto rounded-lg p-6 ${dark ? "bg-[#0A0E14]" : "bg-white"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close fullscreen"
              onClick={() => setFullscreen(false)}
              className={`absolute right-2 top-2 rounded p-1 text-slate-400 ${dark ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}
            >
              <X className="h-4 w-4" />
            </button>
            <div
              className="[&_svg]:h-auto [&_svg]:max-w-[80vw]"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      ) : null}
    </figure>
  );
}

function MermaidPendingState({ message }: { message?: string }): ReactElement {
  return (
    <div
      className="my-3 rounded-lg border border-violet-500/30 bg-violet-950/20 p-3 text-xs text-violet-100"
      aria-busy="true"
    >
      <div className="font-medium">Writing diagram…</div>
      <div className="mt-1 text-violet-200/80">
        {message ?? "Rendering will start when the Mermaid syntax is complete."}
      </div>
    </div>
  );
}

export function MermaidDiagram({
  source,
  streaming = false,
  theme,
}: {
  source: string;
  streaming?: boolean;
  /** Force a render theme. Surfaces with fixed chrome (the always-dark chat)
   *  pass "dark" so the diagram doesn't follow the document theme class. */
  theme?: "light" | "dark";
}): ReactElement {
  const reactId = useId();
  const autoMode = useRootThemeMode();
  const mode = theme ?? autoMode;
  const dark = mode === "dark";
  const trimmedSource = source.trim();
  const renderId = useMemo(
    () => toRenderId(reactId, trimmedSource),
    [reactId, trimmedSource],
  );
  const [state, setState] = useState<RenderState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    setState((previous) => ({
      status: "loading",
      previousSvg: previousSvgFromState(previous),
    }));

    if (trimmedSource.length === 0) {
      setState((previous) => ({
        status: streaming ? "pending" : "error",
        message: "Empty Mermaid diagram",
        previousSvg: previousSvgFromState(previous),
      }));
      return () => {
        cancelled = true;
      };
    }

    timeout = setTimeout(
      () => {
        void enqueueRender(async () => {
          const mermaid = await import("mermaid");
          return renderMermaid(mermaid, renderId, trimmedSource, mode);
        })
          .then((svg) => {
            if (!cancelled) setState({ status: "rendered", svg });
          })
          .catch((error: unknown) => {
            const message = errorMessage(error);
            if (!cancelled) {
              setState((previous) => ({
                status: streaming ? "pending" : "error",
                message,
                previousSvg: previousSvgFromState(previous),
              }));
            }
          });
      },
      streaming ? STREAMING_RENDER_DEBOUNCE_MS : 0,
    );

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [mode, renderId, streaming, trimmedSource]);

  if (state.status === "rendered") {
    return (
      <MermaidSvgFigure svg={state.svg} source={trimmedSource} dark={dark} />
    );
  }

  if (state.status === "loading" && state.previousSvg) {
    return (
      <MermaidSvgFigure
        svg={state.previousSvg}
        caption="Updating diagram…"
        dark={dark}
      />
    );
  }

  if (state.status === "pending") {
    if (state.previousSvg) {
      return (
        <MermaidSvgFigure
          svg={state.previousSvg}
          caption="Updating diagram…"
          dark={dark}
        />
      );
    }
    return (
      <MermaidPendingState message="Waiting for complete Mermaid syntax before rendering." />
    );
  }

  if (state.status === "error") {
    if (state.previousSvg) {
      return (
        <div className="my-3 space-y-2">
          <MermaidSvgFigure
            svg={state.previousSvg}
            caption="Latest diagram update failed; showing the previous valid render."
            dark={dark}
          />
          <details className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
            <summary className="cursor-pointer font-medium">
              Show Mermaid error
            </summary>
            <p className="mt-2 text-amber-700 dark:text-amber-200">
              {state.message}
            </p>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 font-mono text-[11px] text-slate-800 dark:bg-slate-950/70 dark:text-slate-200">
              {trimmedSource}
            </pre>
          </details>
        </div>
      );
    }
    return (
      <figure className="my-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
        <figcaption className="font-medium">
          Mermaid diagram could not be rendered.
        </figcaption>
        <p className="mt-1 text-amber-700 dark:text-amber-200">
          {state.message}
        </p>
        <details className="mt-2">
          <summary className="cursor-pointer font-medium">Show source</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 font-mono text-[11px] text-slate-800 dark:bg-slate-950/70 dark:text-slate-200">
            {trimmedSource}
          </pre>
        </details>
      </figure>
    );
  }

  return <MermaidPendingState message="Rendering Mermaid diagram…" />;
}
