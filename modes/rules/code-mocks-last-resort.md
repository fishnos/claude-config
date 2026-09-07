---
id: code-mocks-last-resort
setting: code
primary_at: polished
---

Prefer the real implementation, then a fake, then a stub. Mocks are the last
resort: a mocked collaborator can't tell you its contract changed. Mock at the
network boundary (MSW), never your own client. Never `sleep` in a test.
