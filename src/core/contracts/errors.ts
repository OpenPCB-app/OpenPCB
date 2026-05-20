/**
 * Shim around `@openpcb/contracts/errors` so existing relative imports of
 * AppError / ValidationError / ProblemDetails keep resolving.
 */
export * from "@openpcb/contracts/errors/index";
