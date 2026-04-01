import { useState, useEffect, useCallback } from "react";
import {
  listComponentFamilies,
  getComponentFamily,
  type ComponentScope,
  type MountType,
} from "@/lib/api/component-api";
import type { ComponentFamilyType } from "@/../../src-ts/src/core/schemas/component-library.schema";

export interface UseComponentsFilters {
  scope?: ComponentScope;
  search?: string;
  mountTypes?: MountType[];
  category?: string;
}

export interface UseComponentsReturn {
  components: ComponentFamilyType[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  filters: UseComponentsFilters;
  setFilters: (filters: UseComponentsFilters) => void;
}

export function useComponents(
  initialFilters: UseComponentsFilters = {},
): UseComponentsReturn {
  const [components, setComponents] = useState<ComponentFamilyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<UseComponentsFilters>(initialFilters);

  const fetchComponents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let results = await listComponentFamilies(filters.scope, filters.search);

      // Client-side filtering for mount types
      if (filters.mountTypes && filters.mountTypes.length > 0) {
        results = results.filter((component) =>
          component.packageVariants.some((variant) =>
            filters.mountTypes?.includes(variant.mountType as MountType),
          ),
        );
      }

      // Note: category filtering would require categoryPath in ComponentFamily schema
      // For now, we'll skip category filtering until the schema is updated
      if (filters.category) {
        // TODO: Filter by category when categoryPath is added to schema
      }

      setComponents(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch components";
      setError(message);
      console.error("Failed to fetch components:", err);
    } finally {
      setLoading(false);
    }
  }, [filters.scope, filters.search, filters.mountTypes, filters.category]);

  useEffect(() => {
    fetchComponents();
  }, [fetchComponents]);

  return {
    components,
    loading,
    error,
    refetch: fetchComponents,
    filters,
    setFilters,
  };
}

export interface UseComponentDetailReturn {
  component: ComponentFamilyType | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useComponentDetail(id: string): UseComponentDetailReturn {
  const [component, setComponent] = useState<ComponentFamilyType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchComponent = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setError(null);

    try {
      const result = await getComponentFamily(id);
      setComponent(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch component";
      setError(message);
      console.error("Failed to fetch component:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchComponent();
  }, [fetchComponent]);

  return {
    component,
    loading,
    error,
    refetch: fetchComponent,
  };
}
