import type { ReactElement } from "react";
import type { LibraryPinMapEntry } from "../../../../sdks/library";

interface PinsTableProps {
  pinMap: LibraryPinMapEntry[] | null;
  /** symbol-pin number → electrical type, sourced from the shared symbol preview. */
  electricalTypeByPin: Map<string, string>;
  /** Chip label, e.g. "0603 pin map". */
  packageLabel: string;
}

/** Full-width pin map for the selected footprint option. */
export function PinsTable({
  pinMap,
  electricalTypeByPin,
  packageLabel,
}: PinsTableProps): ReactElement {
  const hasPins = pinMap !== null && pinMap.length > 0;

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Pins
        </span>
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          {packageLabel} pin map
        </span>
      </header>

      {hasPins ? (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["#", "Name", "Pin", "Type"].map((heading, index) => (
                <th
                  key={heading}
                  className={`border-b border-slate-200 px-4 py-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:text-slate-500 ${
                    index === 0
                      ? "w-20 text-left"
                      : index === 3
                        ? "text-right"
                        : "text-left"
                  }`}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pinMap!.map((entry) => (
              <tr key={`${entry.padNumber}:${entry.pinNumber}`}>
                <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-800/60">
                  <span className="font-mono text-xs font-semibold text-cyan-600 dark:text-cyan-300">
                    {entry.padNumber}
                  </span>
                </td>
                <td className="border-b border-slate-100 px-4 py-3 text-sm text-slate-800 dark:border-slate-800/60 dark:text-slate-200">
                  {entry.pinName ?? "—"}
                </td>
                <td className="border-b border-slate-100 px-4 py-3 text-sm text-slate-500 dark:border-slate-800/60 dark:text-slate-400">
                  {entry.pinNumber}
                </td>
                <td className="border-b border-slate-100 px-4 py-3 text-right dark:border-slate-800/60">
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                    {electricalTypeByPin.get(entry.pinNumber) ?? "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          No pin map for this footprint.
        </div>
      )}
    </section>
  );
}
