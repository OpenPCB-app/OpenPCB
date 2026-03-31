export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount?: number;
}

export const paginationInputSchema = {
  cursor: {
    type: "string",
    description: "Pagination cursor (ID of last item from previous page)",
  },
  limit: {
    type: "number",
    description: "Items per page (default 20, max 100)",
    minimum: 1,
    maximum: 100,
  },
} as const;

/**
 * Apply cursor-based pagination to in-memory items.
 * Cursor is the ID of the last item from the previous page.
 */
export function applyCursorPagination<T>(
  items: T[],
  params: CursorPaginationParams,
  getId: (item: T) => string
): PaginatedResult<T> {
  const limit = Math.min(params.limit ?? 20, 100);
  let startIndex = 0;
  
  if (params.cursor) {
    const cursorIndex = items.findIndex((item) => getId(item) === params.cursor);
    if (cursorIndex !== -1) {
      startIndex = cursorIndex + 1;
    } else {
      return {
        items: [],
        nextCursor: null,
        hasMore: false,
      };
    }
  }
  
  const pageItems = items.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < items.length;
  
  let nextCursor: string | null = null;
  if (hasMore && pageItems.length > 0) {
    const lastItem = pageItems[pageItems.length - 1];
    if (lastItem !== undefined) {
      nextCursor = getId(lastItem);
    }
  }
  
  return {
    items: pageItems,
    nextCursor,
    hasMore,
  };
}
