/**
 * Canvas defaults — KLC visual constants, grid sizes, camera defaults.
 *
 * The single source of truth lives in `@openpcb/rendering-core` so the
 * pure render-model builders and the R3F canvas layer share one copy. This
 * shim preserves the historical `@shared/frontend/canvas/defaults` import
 * path for in-tree callers.
 */
export * from "@openpcb/rendering-core";
