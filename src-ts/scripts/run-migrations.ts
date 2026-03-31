#!/usr/bin/env bun

/**
 * Database Migration Runner Script
 *
 * Standalone script to run database migrations programmatically.
 * Can be used in CI/CD, deployment scripts, or manual execution.
 *
 * Usage:
 *   bun src-ts/scripts/run-migrations.ts
 */

import { initializeDatabase } from '../src/db';
import { runMigrations, runMigrationsIfNeeded } from '../src/db/migrate';

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  console.log('[Migration Runner] Starting...');

  try {
    // Initialize database
    console.log('[Migration Runner] Initializing database...');
    initializeDatabase();

    // Run migrations
    if (force) {
      console.log('[Migration Runner] Force mode: running all migrations');
      await runMigrations();
    } else {
      console.log('[Migration Runner] Checking for pending migrations...');
      await runMigrationsIfNeeded();
    }

    console.log('[Migration Runner] ✓ Done');
    process.exit(0);
  } catch (error) {
    console.error('[Migration Runner] ✗ Failed:', error);
    process.exit(1);
  }
}

main();
