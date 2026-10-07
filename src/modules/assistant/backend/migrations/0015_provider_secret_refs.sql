-- Legacy plaintext is cleared by the trusted vault migration only after durable readback.
ALTER TABLE assistant_provider_config ADD COLUMN secret_ref TEXT;
