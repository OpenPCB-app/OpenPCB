import { useCallback, useEffect, useState } from "react";
import {
  createComponent as createComponentRecord,
  deleteComponent as deleteComponentRecord,
  getComponent,
  listComponents,
  type MountType,
  type ComponentType,
  updateComponent as updateComponentRecord,
} from "@/lib/api/component-api";

export interface UseComponentsFilters {
  search?: string;
  mountType?: MountType;
  categoryPath?: string;
  tags?: string[];
}

export interface UseComponentsReturn {
  components: ComponentType[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  filters: UseComponentsFilters;
  setFilters: (filters: UseComponentsFilters) => void;
}

export interface UseComponentMutationsReturn {
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  error: string | null;
  clearError: () => void;
  createComponent: (payload?: Partial<ComponentType>) => Promise<ComponentType>;
  updateComponent: (
    id: string,
    updates: Partial<ComponentType>,
  ) => Promise<ComponentType>;
  deleteComponent: (id: string) => Promise<void>;
}

function toErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error ? error.message : fallback;
}

export function useComponents(
  initialFilters: UseComponentsFilters = {},
): UseComponentsReturn {
  const [components, setComponents] = useState<ComponentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<UseComponentsFilters>(initialFilters);

  const fetchComponents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const results = await listComponents(filters);
      setComponents(results);
    } catch (err) {
      const message = toErrorMessage(err, "Failed to fetch components");
      setError(message);
      console.error("Failed to fetch components:", err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void fetchComponents();
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

export function useComponentMutations(): UseComponentMutationsReturn {
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const createComponent = useCallback(
    async (payload: Partial<ComponentType> = {}) => {
      setCreating(true);
      setError(null);

      try {
        return await createComponentRecord(payload);
      } catch (err) {
        const message = toErrorMessage(err, "Failed to create component");
        setError(message);
        throw err;
      } finally {
        setCreating(false);
      }
    },
    [],
  );

  const updateComponent = useCallback(
    async (id: string, updates: Partial<ComponentType>) => {
      setUpdating(true);
      setError(null);

      try {
        return await updateComponentRecord(id, updates);
      } catch (err) {
        const message = toErrorMessage(err, "Failed to save component");
        setError(message);
        throw err;
      } finally {
        setUpdating(false);
      }
    },
    [],
  );

  const deleteComponent = useCallback(async (id: string) => {
    setDeleting(true);
    setError(null);

    try {
      await deleteComponentRecord(id);
    } catch (err) {
      const message = toErrorMessage(err, "Failed to delete component");
      setError(message);
      throw err;
    } finally {
      setDeleting(false);
    }
  }, []);

  return {
    creating,
    updating,
    deleting,
    error,
    clearError,
    createComponent,
    updateComponent,
    deleteComponent,
  };
}

export interface UseComponentDetailReturn {
  component: ComponentType | null;
  loading: boolean;
  error: string | null;
  mutationError: string | null;
  saving: boolean;
  deleting: boolean;
  clearMutationError: () => void;
  refetch: () => Promise<void>;
  updateComponent: (updates: Partial<ComponentType>) => Promise<ComponentType>;
  deleteComponent: () => Promise<void>;
}

export function useComponentDetail(id?: string | null): UseComponentDetailReturn {
  const [component, setComponent] = useState<ComponentType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchComponent = useCallback(async () => {
    if (!id) {
      setComponent(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getComponent(id);
      setComponent(result);
    } catch (err) {
      const message = toErrorMessage(err, "Failed to fetch component");
      setError(message);
      console.error("Failed to fetch component:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchComponent();
  }, [fetchComponent]);

  const clearMutationError = useCallback(() => {
    setMutationError(null);
  }, []);

  const updateComponentDetail = useCallback(
    async (updates: Partial<ComponentType>) => {
      if (!id) {
        throw new Error("Component id is required");
      }

      setSaving(true);
      setMutationError(null);

      try {
        const updated = await updateComponentRecord(id, updates);
        setComponent(updated);
        return updated;
      } catch (err) {
        const message = toErrorMessage(err, "Failed to save component");
        setMutationError(message);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [id],
  );

  const deleteComponentDetail = useCallback(async () => {
    if (!id) {
      throw new Error("Component id is required");
    }

    setDeleting(true);
    setMutationError(null);

    try {
      await deleteComponentRecord(id);
      setComponent(null);
    } catch (err) {
      const message = toErrorMessage(err, "Failed to delete component");
      setMutationError(message);
      throw err;
    } finally {
      setDeleting(false);
    }
  }, [id]);

  return {
    component,
    loading,
    error,
    mutationError,
    saving,
    deleting,
    clearMutationError,
    refetch: fetchComponent,
    updateComponent: updateComponentDetail,
    deleteComponent: deleteComponentDetail,
  };
}
