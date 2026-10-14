CREATE TABLE IF NOT EXISTS Outcome (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, statement TEXT NOT NULL, owner TEXT, seeded INTEGER DEFAULT 0,
  status TEXT DEFAULT 'shaping', level INTEGER DEFAULT 0, healthNote TEXT, repositoryId TEXT,
  idea TEXT, problem TEXT, experience TEXT, criteria TEXT, assumptions TEXT, questions TEXT, evidence TEXT,
  readiness INTEGER DEFAULT 0, buildStartedAt TEXT, readyAt TEXT, launchedAt TEXT, adoptedAt TEXT,
  teamPromotionRequestedAt TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_Outcome_status ON Outcome(status);
CREATE INDEX IF NOT EXISTS idx_Outcome_repositoryId ON Outcome(repositoryId);
