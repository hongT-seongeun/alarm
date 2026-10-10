-- 이미 schema.sql(1차 버전)을 적용한 저장소에 반복 알림과 지난 알림 기록을 추가합니다.
-- 한 번만 실행하세요. 기존 알림은 그대로 두고 '한 번만'으로 취급됩니다.
ALTER TABLE alarms ADD COLUMN repeat_type TEXT NOT NULL DEFAULT 'once';
ALTER TABLE alarms ADD COLUMN days TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  fired_at INTEGER NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_endpoint ON history (endpoint);
