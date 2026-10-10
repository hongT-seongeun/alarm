CREATE TABLE IF NOT EXISTS alarms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  sub TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alarms_fire_at ON alarms (fire_at);
CREATE INDEX IF NOT EXISTS idx_alarms_endpoint ON alarms (endpoint);
