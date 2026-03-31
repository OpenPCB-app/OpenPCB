export const fieldsInputSchema = {
  fields: {
    type: "array",
    items: { type: "string" },
    description:
      "Fields to include in response. If omitted, returns all fields. Unknown fields are ignored.",
  },
} as const;

/**
 * Pick specific fields from an object.
 */
export function pickFields<T extends Record<string, any>>(
  item: T,
  fields?: string[]
): Partial<T> {
  if (!fields || fields.length === 0) {
    return item;
  }
  
  const result: Partial<T> = {};
  
  for (const field of fields) {
    if (field in item) {
      result[field as keyof T] = item[field];
    }
  }
  
  return result;
}

/**
 * Apply field selection to an array of items.
 */
export function applyFieldSelection<T extends Record<string, any>>(
  items: T[],
  fields?: string[]
): Partial<T>[] {
  if (!fields || fields.length === 0) {
    return items;
  }
  
  return items.map((item) => pickFields(item, fields));
}
