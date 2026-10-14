import {
  ROUTE_PREVIEW_ILLEGAL,
  ROUTE_PREVIEW_ILLEGAL_OPACITY,
} from "./drc/drc-colors";

export interface RoutePreviewStyle {
  color: string;
  opacity: number;
  illegal: boolean;
}

/**
 * Ghost style for the in-progress route. Illegal = walkaround found no path
 * OR the live DRC verdict has commit-blocking violations. Display only: the
 * commit gate decides legality independently.
 */
export function routePreviewStyle(input: {
  blocked: boolean;
  blockingCount: number;
  layerColor: string;
}): RoutePreviewStyle {
  const illegal = input.blocked || input.blockingCount > 0;
  return illegal
    ? {
        color: ROUTE_PREVIEW_ILLEGAL,
        opacity: ROUTE_PREVIEW_ILLEGAL_OPACITY,
        illegal: true,
      }
    : { color: input.layerColor, opacity: 1, illegal: false };
}
