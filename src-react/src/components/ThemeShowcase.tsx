import * as React from "react";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-lg border border-border bg-surface p-6 shadow-lg";
const sectionHeading = "mb-4 font-heading text-3xl font-semibold leading-snug tracking-tight";
const labelClass = "text-xs font-medium tracking-wide text-text-muted";

const colorSwatches = [
  {
    label: "Accent Color (adapts to theme)",
    className: "bg-accent border border-transparent",
  },
  {
    label: "Accent Hover (nested token)",
    className: "bg-accent-hover border border-transparent",
  },
  {
    label: "Surface Muted",
    className: "bg-surface-muted border border-border",
  },
  {
    label: "Brand Gradient (icon ring inspiration)",
    className: "bg-gradient-brand-accent border border-transparent",
  },
] satisfies Array<{ label: string; className: string }>;

const shadowSamples = [
  { label: "Shadow SM", className: "shadow-sm" },
  { label: "Shadow MD", className: "shadow-md" },
  { label: "Shadow LG", className: "shadow-lg" },
  { label: "Shadow XL", className: "shadow-xl" },
];

const radii = ["none", "sm", "md", "lg", "xl", "full"] as const;

export function ThemeShowcase(): React.ReactElement {
  return (
    <div className="flex flex-col gap-xl">
      <section className={sectionClass}>
        <h2 className={sectionHeading}>Semantic Colors</h2>
        <div className="flex flex-col gap-3">
          {colorSwatches.map(({ label, className }) => (
            <div key={label} className="flex items-center gap-4">
              <div className={cn("h-16 w-16 rounded-md", className)} />
              <p className="font-body text-base text-text-primary">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionHeading}>Text Styles</h2>
        <div className="flex flex-col gap-4">
          <div>
            <p className={labelClass}>heading.h1</p>
            <h1 className="font-heading text-5xl font-bold leading-tight tracking-tight text-text-primary">
              The quick brown fox
            </h1>
          </div>
          <div>
            <p className={labelClass}>heading.h2</p>
            <h2 className="font-heading text-4xl font-bold leading-tight tracking-tight text-text-primary">
              The quick brown fox
            </h2>
          </div>
          <div>
            <p className={labelClass}>heading.h3</p>
            <h3 className="font-heading text-3xl font-semibold leading-snug tracking-tight text-text-primary">
              The quick brown fox
            </h3>
          </div>
          <div>
            <p className={labelClass}>body</p>
            <p className="font-body text-base leading-normal text-text-primary">
              The quick brown fox jumps over the lazy dog. This demonstrates the default body text style.
            </p>
          </div>
          <div>
            <p className={labelClass}>bodyLarge</p>
            <p className="font-body text-lg leading-relaxed text-text-primary">
              The quick brown fox jumps over the lazy dog. Larger body text.
            </p>
          </div>
          <div>
            <p className={labelClass}>bodySmall</p>
            <p className="font-body text-sm leading-normal text-text-primary">
              The quick brown fox jumps over the lazy dog. Small caption text.
            </p>
          </div>
          <div>
            <p className={labelClass}>code</p>
            <code className="rounded-md bg-surface-muted px-2 py-1 font-mono text-sm text-text-primary">
              const greeting = "Hello, World!";
            </code>
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionHeading}>Spacing &amp; Shadows</h2>
        <div className="flex flex-wrap gap-8">
          {shadowSamples.map(({ label, className }) => (
            <div key={label}>
              <p className={cn(labelClass, "mb-2")}>{label}</p>
              <div className={cn("h-32 w-32 rounded-md bg-slate-200", className)} />
            </div>
          ))}
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionHeading}>Border Radius</h2>
        <div className="flex flex-wrap gap-8">
          {radii.map((radius) => (
            <div key={radius}>
              <p className={cn(labelClass, "mb-2")}>{radius.toUpperCase()}</p>
              <div className={cn("h-24 w-24 bg-accent", `rounded-${radius}`)} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface-muted p-6">
        <h2 className="mb-2 font-heading text-2xl font-semibold leading-snug tracking-tight text-text-primary">
          💡 Dark Mode Support
        </h2>
        <p className="font-body text-base text-text-muted">
          All semantic tokens (background, surface, text colors, etc.) automatically adapt to dark mode. To enable dark
          mode, add the <code className="rounded-md bg-surface px-1 py-0.5 font-mono text-sm">dark</code> class to your
          root HTML element or use the theme toggle included in this project.
        </p>
      </section>
    </div>
  );
}
