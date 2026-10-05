# SpringVerify BGV — Configuration & Workflow Guide

Background Verification (BGV) for employees through SpringVerify. It is **optional, off by default, and manual** (a person clicks every time; nothing starts automatically). The existing Documents review flow is unchanged.

Based on SpringVerify BGV API guide v3.4.

---

## 1. How it works (one paragraph)

Platform Admin switches the **BGV** feature on for an organization. HR or Root Admin then opens **Documents → Verification Queue** and clicks **Run BGV** for an employee. HRMS creates the employee as a candidate in SpringVerify, and SpringVerify emails the employee a personal form. The employee fills in their identity, address, education and employment details and documents **on SpringVerify's form**. SpringVerify verifies everything and notifies HRMS by webhook. HR/Root sees the status badge change and opens the final report.

One BGV = **one employee, all documents** (identity + address + education + employment, per the package). SpringVerify does not offer single-document checks.

---

## 2. Workflow by role

### Platform Admin (platform-admin app)
| Step | Action |
|---|---|
| 1 | Open the organization → **Features** (or the Features page). |
| 2 | Turn on **Background Verification (BGV)**. It is OFF for every organization by default. |
| 3 | Turning it off hides the Run BGV button but **keeps all BGV history**. |

Notes: BGV is *not* part of any plan (not even Platinum) and is skipped by "Enable all / Disable all". It must be switched on per organization, deliberately.

### Root Admin (`/root/documents`)
- Sees the **Verification Queue** exactly as before, plus the BGV control when the feature is on.
- Can run BGV for **any employee in the organization**.
- Can see all BGV statuses and open reports.
- Still the only role that can give final document approval (unchanged).

### HR Admin (`/documents`)
- Same Verification Queue and the same BGV control.
- Limited to **employees in their own branch(es)**, using the existing branch rules. An HR admin from Branch A cannot see, start or open reports for Branch B.
- Cannot give final document approval (unchanged).

### Employee (`/portal/documents`)
- **Sees nothing new in HRMS.** There is no BGV screen, button or API access for employees (the API returns 403).
- Receives an **email from SpringVerify** with a personal link, fills in the form (ID, address, education, employment details and documents), and submits.
- Needs a valid **name, email and 10-digit Indian mobile number** in HRMS, otherwise HR gets an error and nothing is sent.

---

## 3. Step-by-step: running a BGV (HR / Root)

1. Go to **Documents → Verification Queue**.
2. Find the employee. The control appears **once per employee** (on their first visible row), labelled *Background check · all documents*.
3. Click **Run BGV**.
4. Confirm the warning: *"BGV verification may incur a charge. Do you want to continue?"*
5. The badge shows **BGV Pending**. SpringVerify emails the employee.
6. As the employee completes the form and SpringVerify works, the badge moves to **BGV In Progress** and then **BGV Completed**.
7. When completed, click **View report** to open the PDF.
8. If it ends **Failed** or **Cancelled**, a **Retry BGV** button appears.

While a BGV is Pending or In Progress, a second one **cannot** be started for the same employee (prevents duplicate paid requests).

---

## 4. Statuses

| Badge | Meaning | SpringVerify `overall_status_code` |
|---|---|---|
| Pending | Waiting for the employee to fill the form / consent | 3 Awaiting Input, 11 Consent missing |
| In Progress | Being verified or temporarily stalled | 0, 4, 5 Discrepancy, 9 On Hold, 12 Insufficient funds |
| Completed | Finished, report available | 1 Completed, 6 Completed with exception |
| Cancelled | Closed or cancelled by SpringVerify | 8 Closed, 10 Cancelled |
| Failed | The request could not be submitted (or provider reported failure) | — |

Stalled states (Discrepancy, On Hold, Insufficient funds) stay "In Progress" on purpose so nobody starts a second paid request.

---

## 5. Configuration

### 5.1 Server `.env` (VPS: `/opt/lumos-hrms/.env`)
```env
BGV_PROVIDER_MODE=springverify
SPRINGVERIFY_BASE_URL=https://api-acceptance-2-sa.in.springverify.com
SPRINGVERIFY_API_TOKEN=<API token from SpringVerify>
SPRINGVERIFY_PACKAGE_IDENTIFIER=<integer subtype_id>
SPRINGVERIFY_WEBHOOK_SECRET=<random secret you generate>
```

| Variable | Notes |
|---|---|
| `BGV_PROVIDER_MODE` | `springverify` for real use. `mock` is for development only and is **refused when `NODE_ENV=production`**. Unset = BGV unusable. |
| `SPRINGVERIFY_BASE_URL` | Sandbox `https://api-acceptance-2-sa.in.springverify.com` · Production `https://api-sa.in.springverify.com`. Must be https and a `*.springverify.com` host. |
| `SPRINGVERIFY_API_TOKEN` | Bearer token for that environment. Server-side only; never sent to the browser or stored in the database. |
| `SPRINGVERIFY_PACKAGE_IDENTIFIER` | Integer `subtype_id` of the package (sandbox ID+ADD+EDU+EMP = `4238`). **Differs between sandbox and production.** |
| `SPRINGVERIFY_WEBHOOK_SECRET` | Generate with `openssl rand -hex 32`. SpringVerify sends it back as `Authorization: Bearer <secret>`. |

After editing `.env`: `docker compose up -d --force-recreate app`.

Find the package id: `GET {BASE_URL}/external/v1/candidate/packages` with the bearer token → `data.packages[].subtype_id`.

### 5.2 Database
Apply once (idempotent, only adds tables):
```bash
docker cp backend/migrations/add_bgv_springverify_2026_10_05.sql lumos_postgres:/tmp/add_bgv.sql
docker exec -it lumos_postgres psql -U lumos_admin -d lumos_hrms -v ON_ERROR_STOP=1 -f /tmp/add_bgv.sql
```
Creates `bgv_requests` and `bgv_events`. Take a `pg_dump` backup first. Deploys do **not** run this file automatically.

### 5.3 SpringVerify webhook (set up by SpringVerify)
Send your SpringVerify contact:
- Endpoint: `https://<your-domain>/api/bgv/webhook` (HTTPS strongly preferred)
- Auth scheme: **bearer**, with the value of `SPRINGVERIFY_WEBHOOK_SECRET`
- Ask them to enable **interim status pushes** (by default only finished outcomes are sent) and to send a **test push**.

Webhook returns 200 on success. A wrong or missing secret returns 401 (SpringVerify disables an endpoint that returns 401/403, so keep the secret in sync).

### 5.4 Deploy
```bash
cd /opt/lumos-hrms
git pull origin HRMS-Migration-16Sep
docker compose up -d --build app
```
`docker compose up -d --force-recreate app` alone does **not** pick up new code, only new env values.

### 5.5 Going to production
Change the base URL to `https://api-sa.in.springverify.com`, use the production token, re-read `GET /packages` for the production `subtype_id`, update `.env`, recreate the app, and ask SpringVerify to register the production webhook.

---

## 6. Technical overview

| Piece | Location |
|---|---|
| Routes | `backend/src/modules/bgv/bgv.routes.js` (mounted at `/api/bgv`) |
| Provider interface | `bgv.provider.js` (SpringVerify is replaceable) |
| SpringVerify client | `springverify.client.js` |
| Dev/test provider | `mock.provider.js` |
| Migration | `backend/migrations/add_bgv_springverify_2026_10_05.sql` |
| UI | `client/src/pages/Documents.jsx` (`BgvCell`, Verification Queue) |
| Platform Admin cards | `PlatformFeatures.jsx`, `PlatformOrgDetail.jsx` |
| Real-DB test | `backend/src/tests/bgv_realdb.test.js` |

### API (`/api/bgv`)
| Endpoint | Who | Purpose |
|---|---|---|
| `GET /requests` | HR, Root | List BGV requests (branch-scoped) |
| `POST /requests` | HR, Root (feature ON) | Start a BGV `{ employee_id }` |
| `GET /requests/:id` | HR, Root | One request |
| `GET /requests/:id/report` | HR, Root | Fetch the report PDF from SpringVerify (audited) |
| `POST /webhook` | SpringVerify | Status updates (bearer secret) |

### What HRMS sends to SpringVerify
`POST /external/v1/candidate/add` with the employee's name, email, 10-digit phone, `invite: true`, and `package.subtype_id`. HRMS never sends documents; the employee uploads them on SpringVerify.

---

## 7. Security & safety

- **Feature default OFF.** A missing flag means OFF; plans and bulk toggles never enable it.
- **Roles:** only HR admin and Root admin; employees get 403.
- **Isolation:** organization and branch scope come from the logged-in user, never from the request body. HR cannot touch another branch; no one can touch another organization.
- **Duplicate protection:** a database unique index allows only one active BGV per employee, so double-clicks and concurrent clicks create exactly one request.
- **Webhook:** bearer secret (timing-safe check); the request is found by SpringVerify's candidate id stored at creation, never by organization/employee values in the payload; duplicate pushes are ignored; finished requests are never moved backwards.
- **Secrets:** the API token and webhook secret live only in the server `.env`. The candidate's SpringVerify form link is never stored. Webhook payloads are stored without name/email/report link.
- **Reports** are fetched on demand through an authenticated, branch-checked endpoint, and every report access is audited. There is no public report URL.
- **Audit trail** (`bgv_events`): requested, request_failed, completed/failed/cancelled, report_accessed, with actor and time.
- **Failures never break HRMS:** if SpringVerify is down, slow or rejects the request, the BGV is marked Failed with a safe message and the Documents module keeps working.

---

## 8. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| No "Run BGV" button | BGV not enabled for the org in Platform Admin; or hard-refresh; or not an HR/Root user. |
| "BGV service is not configured" (503) | A `.env` value is missing or invalid (base URL, token, package id), or the app wasn't recreated after editing `.env`. |
| "needs a valid name, email and 10-digit mobile" | The employee's HRMS profile lacks a valid email or Indian mobile number. |
| "already exists in SpringVerify" | Same email/phone already registered as a candidate in your SpringVerify account. |
| Error mentioning credits / rejected | SpringVerify account has insufficient credits (sandbox currently shows 0), or the package is not allowed. |
| Stays "Pending" forever | Employee hasn't filled the SpringVerify form, or the webhook is not registered/reachable. Check with SpringVerify. |
| "Outcome unknown" on a failed request | A timeout/5xx happened; the request may exist at SpringVerify. **Check the SpringVerify portal before retrying**, a retry could be a second paid request. |
| `404` when testing with `curl localhost:3000` on the VPS | Port 3000 may be answered by another app over IPv6. Use `http://127.0.0.1:3000/...` or the public port. A healthy BGV route returns `401` without a login. |

---

## 9. Known limits

- Employee-fills-form flow only. Sending HRMS's own documents/profile data to SpringVerify (`/v2/submit-bgv`) is not built.
- No scheduled reconciliation: status relies on webhooks (SpringVerify batches pushes). A periodic `GET /candidate/details` sync is a possible follow-up.
- No BGV notifications inside HRMS (HR sees the badge; the employee is emailed by SpringVerify).
- Only the built-in `admin` (HR) and `root_admin` roles can use BGV; there is no separate RBAC permission for it.
- Sandbox only has been configured; production credentials and package id are still to be provided by SpringVerify.
