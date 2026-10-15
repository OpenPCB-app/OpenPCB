import { AppError } from "../../../../core/contracts/errors";

/**
 * 422 `UNQUALIFIED_GENERATOR`. Its own module so the generator resolver and
 * the generated-geometry guard can both throw it without an import cycle.
 */
export class UnqualifiedGeneratorError extends AppError {
  constructor(message: string) {
    super(
      message,
      422,
      "Footprint generator unavailable",
      "https://openpcb.dev/problems/unqualified-generator",
      { code: "UNQUALIFIED_GENERATOR" },
    );
  }
}
