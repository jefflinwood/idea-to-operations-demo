CREATE TABLE IF NOT EXISTS Repository (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, artifactsRepo TEXT, mainSha TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS Issue (
  id TEXT PRIMARY KEY, repositoryId TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  status TEXT DEFAULT 'open', createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS Task (
  id TEXT PRIMARY KEY, issueId TEXT, repositoryId TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
  status TEXT DEFAULT 'ready', claimedBy TEXT, claimedAt TEXT, startedAt TEXT, changeId TEXT,
  submittedAt TEXT, completedAt TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS Change (
  id TEXT PRIMARY KEY, taskId TEXT NOT NULL, repositoryId TEXT NOT NULL, actorId TEXT NOT NULL,
  status TEXT DEFAULT 'working', baseSha TEXT, headSha TEXT, integratedSha TEXT, forkRepo TEXT,
  submittedAt TEXT, completedAt TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS SymbolLease (
  id TEXT PRIMARY KEY, repositoryId TEXT NOT NULL, taskId TEXT NOT NULL, actorId TEXT NOT NULL,
  symbol TEXT NOT NULL, expiresAt TEXT NOT NULL, status TEXT DEFAULT 'active', activeKey TEXT,
  releasedAt TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_SymbolLease_activeKey ON SymbolLease(activeKey);
CREATE TABLE IF NOT EXISTS "Check" (
  id TEXT PRIMARY KEY, changeId TEXT NOT NULL, stage TEXT NOT NULL, outcome TEXT NOT NULL,
  detail TEXT, recordedBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS Decision (
  id TEXT PRIMARY KEY, changeId TEXT NOT NULL, question TEXT NOT NULL, options TEXT,
  status TEXT DEFAULT 'pending', choice TEXT, resolvedBy TEXT, resolvedAt TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ChangeEvent (
  id TEXT PRIMARY KEY, changeId TEXT, taskId TEXT, actorId TEXT, kind TEXT NOT NULL, detail TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
