-- BGV consent: one signed consent document per employee, uploaded by HR / root admin.
-- Its https URL is sent to SpringVerify as candidate.consent / consent.doc_url (CONSENT_LETTER companies).
CREATE TABLE IF NOT EXISTS bgv_consents (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_url         TEXT   NOT NULL,
  public_id        TEXT,
  file_name        TEXT,
  file_type        TEXT,
  file_size        BIGINT,
  uploaded_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bgv_consent_employee UNIQUE (organization_id, employee_id)
);
