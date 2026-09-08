-- Single-user MVP: every data table has FK user_id -> users, but 001 seeds no
-- row, so a fresh database rejects every import until this exists. The id is
-- hard-coded in ios Config.swift (userId) and scripts/smoke-test.py.
INSERT INTO users (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'William')
ON CONFLICT (id) DO NOTHING;
