import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Button, Field, Input, Select } from "@shared/frontend/ui";
import type {
  ParamField,
  ParamSchema,
  ParamValue,
  ParamValues,
} from "../../../../shared/rendering/parametric";
import type { FootprintRenderSource } from "../../../../shared/rendering/types";
import { toUserError } from "../utils";
import {
  templateRequestKey,
  validateTemplateParams,
  type TemplateSelection,
} from "./footprint-validation";

interface TemplateInfo {
  id: string;
  label: string;
  description: string;
  schema: ParamSchema;
  defaults: Record<string, ParamValue>;
}

export interface MaterializedTemplate {
  templateId: string;
  params: Record<string, unknown>;
  source: FootprintRenderSource;
  metadata: {
    name: string;
    mountType: "smd" | "through_hole";
    /** The template route returns a bare string; callers map it. */
    packageCode: string;
    tags: string[];
  };
}

type FormValues = Record<string, string | boolean>;

function toFormValues(defaults: Record<string, ParamValue>): FormValues {
  const out: FormValues = {};
  for (const [key, value] of Object.entries(defaults)) {
    out[key] = typeof value === "boolean" ? value : String(value);
  }
  return out;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function ParamInput({
  field,
  value,
  error,
  onChange,
}: {
  field: ParamField;
  value: string | boolean | undefined;
  error: string | undefined;
  onChange: (next: string | boolean) => void;
}): ReactElement {
  const id = `tpl-param-${field.key}`;
  const unit = "unit" in field && field.unit ? ` (${field.unit})` : "";
  const label = `${field.label}${unit}`;
  if (field.kind === "bool") {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-xs text-text">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
    );
  }
  if (field.kind === "enum") {
    return (
      <Field label={label} htmlFor={id} error={error}>
        <Select
          id={id}
          options={field.options.map((o) => ({ id: o.value, label: o.label }))}
          value={typeof value === "string" ? value : field.default}
          onChange={(next) => onChange(next)}
        />
      </Field>
    );
  }
  return (
    <Field
      label={label}
      htmlFor={id}
      error={error}
      hint={`${field.min} – ${field.max}`}
    >
      <Input
        id={id}
        inputMode="decimal"
        value={typeof value === "string" ? value : String(field.default)}
        onChange={(event) => onChange(event.target.value)}
        invalid={error !== undefined}
      />
    </Field>
  );
}

function formValue(value: ParamValue | undefined): string | boolean | undefined {
  return typeof value === "number" ? String(value) : value;
}

/**
 * Parametric-template form: GET /templates, POST /templates/:id/materialize.
 * The selection is owned by the caller so it survives remounts. Any edit
 * invalidates the previous result, and a response is emitted only while its
 * request key still equals the displayed form's key (T-319 race).
 */
export function TemplateTab({
  backendURL,
  moduleId,
  selection,
  onSelectionChange,
  onMaterialized,
  onInvalidated,
}: {
  backendURL: string | null | undefined;
  moduleId: string;
  selection: TemplateSelection;
  onSelectionChange: (next: TemplateSelection) => void;
  onMaterialized: (result: MaterializedTemplate) => void;
  /** Any form change: the previous result no longer matches what is displayed. */
  onInvalidated: () => void;
}): ReactElement {
  const base = backendURL ? `${backendURL}/api/modules/${moduleId}` : null;
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const templateId = selection.templateId;
  const values = selection.values;

  // Read by the load effect without re-running it on every keystroke.
  const latest = useRef({ selection, onSelectionChange, onInvalidated });
  useLayoutEffect(() => {
    latest.current = { selection, onSelectionChange, onInvalidated };
  });
  const currentKeyRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!base) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${base}/templates`, {
          signal: controller.signal,
        });
        const payload = (await readJson(response)) as {
          ok?: boolean;
          data?: { templates?: TemplateInfo[] };
        } | null;
        if (!response.ok || !payload?.ok || !payload.data?.templates) {
          throw new Error(
            toUserError(payload, `Templates failed (HTTP ${response.status})`),
          );
        }
        const loaded = payload.data.templates;
        setTemplates(loaded);
        const { selection: shown, onSelectionChange: select, onInvalidated: invalidate } =
          latest.current;
        // Keep a remembered selection; only an absent or unknown id resets.
        const first = loaded[0];
        if (first && !loaded.some((t) => t.id === shown.templateId)) {
          invalidate();
          select({ templateId: first.id, values: toFormValues(first.defaults) });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(
          error instanceof Error ? error.message : "Failed to load templates",
        );
      }
    })();
    return () => controller.abort();
  }, [base]);

  const template = useMemo(
    () => templates?.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );
  const validation = useMemo(
    () => (template ? validateTemplateParams(template.schema, values) : null),
    [template, values],
  );
  const errors = validation && !validation.ok ? validation.errors : {};
  const currentKey =
    template && validation?.ok
      ? templateRequestKey(template.id, validation.values)
      : null;
  useLayoutEffect(() => {
    currentKeyRef.current = currentKey;
  }, [currentKey]);

  const change = useCallback(
    (next: TemplateSelection) => {
      // Drop whatever is in flight before the new form is even rendered.
      currentKeyRef.current = null;
      controllerRef.current?.abort();
      controllerRef.current = null;
      setBusy(false);
      setSubmitError(null);
      onInvalidated();
      onSelectionChange(next);
    },
    [onInvalidated, onSelectionChange],
  );

  const handleGenerate = useCallback(async () => {
    if (!base || !template || !validation?.ok) return;
    const requestKey = templateRequestKey(template.id, validation.values);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    currentKeyRef.current = requestKey;
    const stale = () =>
      controller.signal.aborted || currentKeyRef.current !== requestKey;
    setBusy(true);
    setSubmitError(null);
    try {
      const response = await fetch(
        `${base}/templates/${template.id}/materialize`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ params: validation.values }),
          signal: controller.signal,
        },
      );
      const payload = (await readJson(response)) as {
        ok?: boolean;
        data?: MaterializedTemplate;
      } | null;
      if (stale()) return;
      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(
          toUserError(payload, `Generate failed (HTTP ${response.status})`),
        );
      }
      onMaterialized(payload.data);
    } catch (error) {
      if (stale()) return;
      setSubmitError(
        error instanceof Error ? error.message : "Failed to generate footprint",
      );
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  }, [base, onMaterialized, template, validation]);

  if (!base) {
    return <p className="text-xs text-status-danger">Backend URL unavailable</p>;
  }
  if (loadError) return <p className="text-xs text-status-danger">{loadError}</p>;
  if (!templates) return <p className="text-xs text-text-tertiary">Loading templates…</p>;
  if (templates.length === 0 || !template) {
    return <p className="text-xs text-text-tertiary">No templates available.</p>;
  }

  return (
    <div className="space-y-3">
      <Field label="Template" htmlFor="tpl-select" hint={template.description}>
        <Select
          id="tpl-select"
          options={templates.map((t) => ({ id: t.id, label: t.label }))}
          value={template.id}
          onChange={(id) => {
            const next = templates.find((t) => t.id === id);
            change({
              templateId: id,
              values: next ? toFormValues(next.defaults) : {},
            });
          }}
        />
      </Field>
      {template.schema.fields.map((field) => (
        <ParamInput
          key={`${template.id}:${field.key}`}
          field={field}
          value={formValue(values[field.key])}
          error={errors[field.key]}
          onChange={(next) => {
            const nextValues: ParamValues = { ...values, [field.key]: next };
            change({ templateId: template.id, values: nextValues });
          }}
        />
      ))}
      {submitError ? (
        <p role="alert" className="text-xs text-status-danger">
          {submitError}
        </p>
      ) : null}
      <Button
        type="button"
        variant="primary"
        disabled={busy || !validation?.ok}
        onClick={() => void handleGenerate()}
        className="cursor-pointer"
      >
        {busy ? "Generating…" : "Generate footprint"}
      </Button>
    </div>
  );
}
