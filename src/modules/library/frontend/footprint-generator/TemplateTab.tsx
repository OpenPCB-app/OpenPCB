import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Button, Field, Input, Select } from "@shared/frontend/ui";
import type {
  ParamField,
  ParamSchema,
  ParamValue,
} from "../../../../shared/rendering/parametric";
import type { FootprintRenderSource } from "../../../../shared/rendering/types";
import { toUserError } from "../utils";
import { validateTemplateParams } from "./footprint-validation";

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

/** Parametric-template form: GET /templates, POST /templates/:id/materialize. */
export function TemplateTab({
  backendURL,
  moduleId,
  onMaterialized,
}: {
  backendURL: string | null | undefined;
  moduleId: string;
  onMaterialized: (result: MaterializedTemplate) => void;
}): ReactElement {
  const base = backendURL ? `${backendURL}/api/modules/${moduleId}` : null;
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<FormValues>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
        setTemplates(payload.data.templates);
        const first = payload.data.templates[0];
        if (first) {
          setTemplateId(first.id);
          setValues(toFormValues(first.defaults));
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

  const handleGenerate = useCallback(async () => {
    if (!base || !template || !validation?.ok) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const response = await fetch(
        `${base}/templates/${template.id}/materialize`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ params: validation.values }),
        },
      );
      const payload = (await readJson(response)) as {
        ok?: boolean;
        data?: MaterializedTemplate;
      } | null;
      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(
          toUserError(payload, `Generate failed (HTTP ${response.status})`),
        );
      }
      onMaterialized(payload.data);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to generate footprint",
      );
    } finally {
      setBusy(false);
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
          value={templateId}
          onChange={(id) => {
            const next = templates.find((t) => t.id === id);
            setTemplateId(id);
            setValues(next ? toFormValues(next.defaults) : {});
            setSubmitError(null);
          }}
        />
      </Field>
      {template.schema.fields.map((field) => (
        <ParamInput
          key={`${template.id}:${field.key}`}
          field={field}
          value={values[field.key]}
          error={errors[field.key]}
          onChange={(next) => {
            setValues((prev) => ({ ...prev, [field.key]: next }));
            setSubmitError(null);
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
