import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { Banner } from "./banner";
import { Button } from "./button";
import { Chip } from "./chip";
import { DockTabs, dockTabPanelProps } from "./dock-tabs";
import { EmptyState } from "./empty-state";
import { ErrorBoundary, ErrorFallback } from "./error-boundary";
import { Field } from "./field";
import { Input } from "./input";
import { Kbd } from "./kbd";
import { NumberInput } from "./number-input";
import { PanelSectionHeader } from "./panel-section-header";
import { RadioGroup } from "./radio-group";
import { SegmentedControl } from "./segmented-control";
import { Select } from "./select";
import { LoadingState, Spinner } from "./spinner";
import { StatusSegment } from "./status-bar";
import { Switch } from "./switch";
import { TableRow } from "./data-table";
import { ToolbarButton } from "./toolbar";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => {};

describe("focus ring on kit controls (T-007)", () => {
  it.each([
    ["Button primary", <Button variant="primary">Go</Button>],
    ["Button ghost", <Button variant="ghost">Go</Button>],
    ["ToolbarButton", <ToolbarButton label="Route" hotkey="R" />],
    ["Chip", <Chip>Starred</Chip>],
    ["StatusSegment", <StatusSegment onClick={noop}>DRC</StatusSegment>],
    ["PanelSectionHeader toggle", <PanelSectionHeader title="Layers" onToggle={noop} collapsed={false} />],
  ])("%s renders the solid focus-visible outline", (_name, node) => {
    const markup = html(node);
    expect(markup).toContain("focus-visible:outline-solid");
    expect(markup).toContain("focus-visible:outline-focus-ring");
  });

  it("keeps the e2e accessible name of ToolbarButton", () => {
    expect(html(<ToolbarButton label="Route" hotkey="R" />)).toContain('aria-label="Route (R)"');
  });
});

describe("roving tab stops (T-018)", () => {
  const tabs = [
    { id: "props", label: "Properties" },
    { id: "erc", label: "ERC", disabled: true },
    { id: "drc", label: "DRC", badge: 3 },
  ] as const;

  it("DockTabs exposes one tab stop and pairs tabs with panels", () => {
    const markup = html(
      <DockTabs aria-label="Side panel" tabs={tabs} active="drc" onChange={noop} idPrefix="dock" />,
    );
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toMatch(/id="dock-tab-drc" aria-controls="dock-panel-drc" aria-selected="true" tabindex="0"/);
    expect(markup).toContain('role="tablist" aria-label="Side panel"');
    expect(dockTabPanelProps("dock", "drc")).toEqual({
      id: "dock-panel-drc",
      role: "tabpanel",
      "aria-labelledby": "dock-tab-drc",
    });
  });

  it("SegmentedControl keeps buttons + aria-pressed with a single tab stop", () => {
    const markup = html(
      <SegmentedControl
        aria-label="View"
        options={[
          { id: "list", label: "List" },
          { id: "grid", label: "Grid" },
        ]}
        value="grid"
        onChange={noop}
      />,
    );
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-pressed="true" tabindex="0"[^>]*>Grid/);
    expect(markup).toContain('aria-pressed="false" tabindex="-1"');
    // isShortcutBlocked keys "arrows belong to this widget" off the marker.
    expect(markup).toMatch(/role="group"[^>]*data-roving-focus=""/);
  });
});

describe("form controls", () => {
  it("Switch is a role=switch button with aria-checked", () => {
    const markup = html(<Switch checked onCheckedChange={noop} aria-label="Snap to grid" />);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-label="Snap to grid"');
  });

  it("RadioGroup renders native radios in a named radiogroup", () => {
    const markup = html(
      <RadioGroup
        name="units"
        aria-label="Units"
        options={[
          { id: "mm", label: "mm" },
          { id: "mil", label: "mil" },
        ]}
        value="mm"
        onChange={noop}
      />,
    );
    expect(markup).toContain('role="radiogroup" aria-label="Units"');
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    expect(markup).toMatch(/<input[^>]*checked=""[^>]*value="mm"/);
    expect(markup).not.toMatch(/<input[^>]*checked=""[^>]*value="mil"/);
  });

  it("Select renders a native select with a placeholder for an unknown value", () => {
    const markup = html(
      <Select
        aria-label="Lighting scene"
        options={[{ id: "studio", label: "Studio" }]}
        value=""
        placeholder="Choose…"
        onChange={noop}
      />,
    );
    expect(markup).toContain("<select");
    expect(markup).toContain('aria-label="Lighting scene"');
    expect(markup).toContain(">Choose…</option>");
  });

  it("Input marks invalid state and NumberInput is a spinbutton", () => {
    expect(html(<Input invalid aria-label="Name" />)).toContain('aria-invalid="true"');
    const markup = html(
      <NumberInput aria-label="Width" value={0} unit="mm" min={0} onCommit={noop} />,
    );
    expect(markup).toContain('role="spinbutton"');
    expect(markup).toContain('value="0"');
    expect(markup).toContain('inputMode="decimal"');
    expect(markup).toContain(">mm</span>");
  });

  it("Field links the error to its control", () => {
    const markup = html(
      <Field label="Width" htmlFor="w" error="Must be positive">
        <Input id="w" />
      </Field>,
    );
    expect(markup).toContain('aria-describedby="w-error"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('id="w-error"');
  });

  it("TableRow interactive is a focusable selectable row", () => {
    const markup = html(<TableRow cols="1fr" interactive selected onClick={noop} />);
    expect(markup).toContain('role="row"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-selected="true"');
    expect(html(<TableRow cols="1fr" />)).not.toContain("tabindex");
  });
});

describe("status + feedback primitives", () => {
  it("Banner danger is an alert; info is not", () => {
    expect(html(<Banner tone="danger">Export refused</Banner>)).toContain('role="alert"');
    expect(html(<Banner tone="info">Heads up</Banner>)).not.toContain('role="alert"');
  });

  it("Banner and Badge use status tokens, never raw palette", () => {
    const markup = html(
      <>
        <Banner tone="warning" title="Caution">Body</Banner>
        <Badge tone="success">Up to date</Badge>
      </>,
    );
    expect(markup).toContain("border-status-warning-border");
    expect(markup).toContain("bg-status-success-soft");
    expect(markup).not.toMatch(/(amber|emerald|red|slate)-\d/);
  });

  it("Spinner and LoadingState announce status", () => {
    expect(html(<Spinner label="Converting" />)).toContain('role="status"');
    expect(html(<Spinner label="Converting" />)).toContain("Converting");
    expect(html(<LoadingState well />)).toContain("text-well-text");
  });

  it("EmptyState keeps a heading when asked", () => {
    const markup = html(<EmptyState titleAs="h2" title="No design open" />);
    expect(markup).toContain("<h2");
    expect(markup).toContain("No design open");
  });

  it("Kbd renders one cap per step", () => {
    expect(html(<Kbd keys={["G", "G"]} />).match(/<kbd/g)).toHaveLength(2);
  });

  it("ErrorBoundary renders children and the fallback offers recovery", () => {
    expect(html(<ErrorBoundary scope="test"><span>ok</span></ErrorBoundary>)).toContain("ok");
    const fallback = html(<ErrorFallback error={new Error("x")} reset={noop} />);
    expect(fallback).toContain('role="alert"');
    for (const label of ["Try again", "Copy details", "Reload"]) expect(fallback).toContain(label);
  });
});
