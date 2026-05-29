import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Pill } from "@shared/frontend/ui/pill";
import { Button } from "@shared/frontend/ui/button";
import { useBootstrap } from "../../providers/BootstrapProvider";
import { useNavigationStore } from "../../stores/navigation-store";

const REPO_URL = "https://github.com/andrejvysny/OpenPCB";
const TAGLINE =
  "Modular, open desktop PCB design suite — schematic capture, PCB layout, and a unified component library in one app.";

const OS_LABELS: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

function OpenPcbMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      className="h-full w-full"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        x1="8"
        y1="8"
        x2="16"
        y2="16"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="16" cy="8" r="1.5" fill="currentColor" />
      <circle cx="8" cy="16" r="1.5" fill="currentColor" />
      <circle cx="16" cy="16" r="1.5" fill="currentColor" />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/40">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-mono text-xs text-slate-700 dark:text-slate-300">
        {value}
      </dd>
    </div>
  );
}

function ExternalRow({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline dark:text-slate-300 dark:hover:text-slate-100"
    >
      <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
      {children}
    </a>
  );
}

export function AboutPanel() {
  const { moduleRegistry } = useBootstrap();
  const setSettingsTab = useNavigationStore((state) => state.setSettingsTab);
  const [versions, setVersions] = useState<AppVersions | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getAppVersions) return;
    api
      .getAppVersions()
      .then(setVersions)
      .catch(() => setVersions(null));
  }, []);

  const version = versions?.app ?? null;
  const channel = version?.includes("beta")
    ? "beta"
    : version?.includes("alpha")
      ? "alpha"
      : null;

  const modules = moduleRegistry?.modules ?? [];
  const envRows = versions
    ? [
        { label: "Electron", value: versions.electron },
        { label: "Chromium", value: versions.chromium },
        { label: "Node.js", value: versions.node },
        {
          label: "Platform",
          value: `${OS_LABELS[versions.platform] ?? versions.platform} (${versions.arch})`,
        },
        { label: "OS build", value: versions.osRelease },
      ]
    : [];

  const openReleases = () => {
    if (window.updater) {
      void window.updater.openReleases();
    } else {
      window.open(`${REPO_URL}/releases`, "_blank", "noopener");
    }
  };

  return (
    <div className="space-y-8 pb-24">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 flex-shrink-0 text-slate-900 dark:text-slate-100">
          <OpenPcbMark />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              OpenPCB
            </h2>
            {channel ? <Pill tone="accent">{channel}</Pill> : null}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {TAGLINE}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-500">
            {version ? `Version ${version}` : "Development build (browser)"}
          </p>
        </div>
      </div>

      {envRows.length > 0 ? (
        <Section title="Environment">
          <dl className="space-y-2">
            {envRows.map((row) => (
              <InfoRow key={row.label} label={row.label} value={row.value} />
            ))}
          </dl>
        </Section>
      ) : null}

      <Section title="Modules">
        {modules.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Module list unavailable.
          </p>
        ) : (
          <ul className="space-y-2">
            {modules.map((module) => (
              <li
                key={module.id}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  {module.label}
                  {module.status !== "loaded" ? (
                    <Pill
                      tone={module.status === "failed" ? "danger" : "warning"}
                    >
                      {module.status}
                    </Pill>
                  ) : null}
                </span>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  v{module.version}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Release notes">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          See what changed in each release on GitHub.
        </p>
        <Button
          variant="secondary"
          size="sm"
          icon={<ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />}
          onClick={openReleases}
          className="cursor-pointer"
        >
          View release notes
        </Button>
      </Section>

      <Section title="About & legal">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Licensed under{" "}
          <a
            href={`${REPO_URL}/blob/master/LICENSE`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-slate-900 dark:hover:text-slate-100"
          >
            AGPL-3.0-or-later
          </a>
          . Commercial licensing available at{" "}
          <a
            href="mailto:licensing@openpcb.app"
            className="underline underline-offset-2 hover:text-slate-900 dark:hover:text-slate-100"
          >
            licensing@openpcb.app
          </a>
          .
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <ExternalRow href={REPO_URL}>Repository</ExternalRow>
          <ExternalRow href={`${REPO_URL}/issues/new?labels=bug`}>
            Report a bug
          </ExternalRow>
          <ExternalRow href={`${REPO_URL}/issues/new?labels=enhancement`}>
            Request a feature
          </ExternalRow>
          <ExternalRow href={`${REPO_URL}/blob/master/SECURITY.md`}>
            Security policy
          </ExternalRow>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-500">
          © OpenPCB · Manage data sharing in{" "}
          <button
            type="button"
            onClick={() => setSettingsTab("privacy")}
            className="cursor-pointer underline underline-offset-2 hover:text-slate-700 dark:hover:text-slate-300"
          >
            Privacy settings
          </button>
          .
        </p>
      </Section>
    </div>
  );
}
