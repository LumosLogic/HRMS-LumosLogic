-- Session revocation: JWTs issued before this instant are rejected (sign-out-all-devices, admin password reset).
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz;
