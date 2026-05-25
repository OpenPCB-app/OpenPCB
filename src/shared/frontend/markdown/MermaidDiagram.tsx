import { useEffect, useId, useMemo, useState, type ReactElement } from "react";

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
    ],
    deterministicIds: true,
    deterministicIDSeed: id,
    theme: mode === "dark" ? "dark" : "default",
  });

  const parsed = await mermaid.parse(source, { suppressErrors: true });
  if (!parsed) throw new Error("Invalid Mermaid diagram syntax");
  const { svg } = await mermaid.render(id, source);
  return svg;
}

function MermaidSvgFigure({
  svg,
  caption,
}: {
  svg: string;
  caption?: string;
}): ReactElement {
  return (
    <figure className="my-3 max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/60">
      {caption ? (
        <figcaption className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          {caption}
        </figcaption>
      ) : null}
      <div
        className="openpcb-mermaid-diagram min-w-fit [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
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
}: {
  source: string;
  streaming?: boolean;
}): ReactElement {
  const reactId = useId();
  const mode = useRootThemeMode();
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
    return <MermaidSvgFigure svg={state.svg} />;
  }

  if (state.status === "loading" && state.previousSvg) {
    return <MermaidSvgFigure svg={state.previousSvg} caption="Updating diagram…" />;
  }

  if (state.status === "pending") {
    if (state.previousSvg) {
      return <MermaidSvgFigure svg={state.previousSvg} caption="Updating diagram…" />;
    }
    return <MermaidPendingState message="Waiting for complete Mermaid syntax before rendering." />;
  }

  if (state.status === "error") {
    if (state.previousSvg) {
      return (
        <div className="my-3 space-y-2">
          <MermaidSvgFigure svg={state.previousSvg} caption="Latest diagram update failed; showing the previous valid render." />
          <details className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
            <summary className="cursor-pointer font-medium">Show Mermaid error</summary>
            <p className="mt-2 text-amber-700 dark:text-amber-200">{state.message}</p>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 font-mono text-[11px] text-slate-800 dark:bg-slate-950/70 dark:text-slate-200">
              {trimmedSource}
            </pre>
          </details>
        </div>
      );
    }
    return (
      <figure className="my-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
        <figcaption className="font-medium">Mermaid diagram could not be rendered.</figcaption>
        <p className="mt-1 text-amber-700 dark:text-amber-200">{state.message}</p>
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
