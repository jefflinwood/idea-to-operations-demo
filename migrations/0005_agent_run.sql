CREATE TABLE IF NOT EXISTS AgentRun (
  id TEXT PRIMARY KEY, changeId TEXT, taskId TEXT, actorId TEXT, kind TEXT NOT NULL, parentRunId TEXT,
  model TEXT, promptHash TEXT, instruction TEXT, context TEXT, attempts TEXT, summary TEXT, headSha TEXT, files TEXT,
  durationMs INTEGER, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_AgentRun_changeId ON AgentRun(changeId);
