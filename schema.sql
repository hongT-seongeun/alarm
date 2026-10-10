-- 처음 설치할 때 한 번 실행합니다. (이미 쓰던 저장소는 migration-2.sql을 쓰세요)
CREATE TABLE IF NOT EXISTS alarms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  sub TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  message TEXT NOT NULL,
  repeat_type TEXT NOT NULL DEFAULT 'once',
  days TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_alarms_fire_at ON alarms (fire_at);
CREATE INDEX IF NOT EXISTS idx_alarms_endpoint ON alarms (endpoint);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  fired_at INTEGER NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_endpoint ON history (endpoint);
