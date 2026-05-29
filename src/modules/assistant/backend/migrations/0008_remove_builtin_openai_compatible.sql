-- Remove the built-in "Custom OpenAI-compatible" preset provider.
-- The curated built-ins are now OpenAI, LM Studio, and oMLX only. Users can
-- still add their own OpenAI-compatible endpoint via "Add provider" (those are
-- is_builtin=0 with UUID ids and are left untouched here).

-- Reassign the default away from the provider being removed.
UPDATE assistant_settings
  SET default_provider_id = 'openai'
  WHERE default_provider_id = 'openai-compatible';
--> statement-breakpoint
-- Clean cached children first (no reliance on FK cascade being enabled).
DELETE FROM assistant_provider_model_cache WHERE provider_id = 'openai-compatible';
--> statement-breakpoint
DELETE FROM assistant_provider_capability WHERE provider_id = 'openai-compatible';
--> statement-breakpoint
-- Only drop the built-in seed (id == kind, is_builtin=1); custom providers keep their UUID ids.
DELETE FROM assistant_provider_config WHERE id = 'openai-compatible' AND is_builtin = 1;
