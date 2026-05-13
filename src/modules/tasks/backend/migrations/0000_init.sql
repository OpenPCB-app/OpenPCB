CREATE TABLE IF NOT EXISTS tasks_task (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  queue_key TEXT NOT NULL,
  depends_on TEXT,
  waiting_tasks TEXT NOT NULL DEFAULT '[]',
  payload TEXT NOT NULL,
  result TEXT,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  request_id TEXT,
  correlation TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_task_status ON tasks_task(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_task_queue_status ON tasks_task(queue_key, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_task_depends_on ON tasks_task(depends_on);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tasks_task_chunk (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks_task(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  metadata TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_task_chunk_task_seq ON tasks_task_chunk(task_id, seq);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tasks_task_event (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks_task(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT,
  data TEXT,
  timestamp TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_task_event_task_time ON tasks_task_event(task_id, timestamp);
