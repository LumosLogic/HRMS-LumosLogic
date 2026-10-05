-- BGV (Background Verification) — SpringVerify integration. ADDITIVE ONLY: new tables, no changes to existing ones.
-- Date: 2026-10-05

CREATE TABLE IF NOT EXISTS bgv_requests (
  id                         BIGSERIAL PRIMARY KEY,
  organization_id            BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id                BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_doc_submission_id BIGINT REFERENCES employee_doc_submissions(id) ON DELETE SET NULL,
  provider                   TEXT   NOT NULL,
  provider_candidate_id      TEXT,
  provider_request_id        TEXT,
  package_identifier         TEXT,
  -- internal, provider-neutral status
  status                     TEXT   NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','in_progress','completed','failed','cancelled')),
  provider_status            TEXT,            -- last raw provider status string (diagnostic)
  requested_by               BIGINT REFERENCES users(id) ON DELETE SET NULL,
  requested_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at               TIMESTAMPTZ,
  report_url                 TEXT,
  error_message              TEXT,
  raw_response               JSONB,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most ONE active (paid, unfinished) request per employee per provider.
-- Concurrent "Run BGV" clicks: the second INSERT violates this index and is rejected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bgv_active_per_employee
  ON bgv_requests (organization_id, employee_id, provider)
  WHERE status IN ('pending','in_progress');

-- Webhook lookup: the request is resolved by provider candidate id, never by payload org/employee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bgv_provider_candidate
  ON bgv_requests (provider, provider_candidate_id)
  WHERE provider_candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bgv_requests_org_emp ON bgv_requests (organization_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bgv_requests_org_status ON bgv_requests (organization_id, status);

-- Event log: webhook events (deduplicated) + audit trail entries (requested/failed/completed/report_accessed).
CREATE TABLE IF NOT EXISTS bgv_events (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  bgv_request_id    BIGINT REFERENCES bgv_requests(id) ON DELETE SET NULL,
  provider          TEXT NOT NULL,
  provider_event_id TEXT,
  event_type        TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'webhook' CHECK (source IN ('webhook','audit')),
  actor_id          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  payload           JSONB,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency: the same provider event is stored/processed only once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bgv_events_provider_event
  ON bgv_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bgv_events_request ON bgv_events (bgv_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bgv_events_org ON bgv_events (organization_id, created_at DESC);

-- NOTE: no rows are inserted into organization_features. 'bgv' is OFF unless a Platform Admin
-- explicitly enables it per organization.
