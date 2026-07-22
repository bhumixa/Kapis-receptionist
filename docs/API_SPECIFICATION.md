# API_SPECIFICATION.md

## AI-Powered WhatsApp Appointment Booking SaaS for Salons
### REST API Specification — Frontend/Backend Contract

**Document Status:** Draft for Approval
**Version:** 1.0 (documents API version `v1`)
**Depends on:** PROJECT_REQUIREMENTS.md, SYSTEM_ARCHITECTURE.md, DATABASE_DESIGN.md, PRISMA_SCHEMA.md (v1.0 each)
**Scope:** REST API contract only. No NestJS code, no Angular code, no implementation. This document is the binding contract between frontend and backend teams once approved.

---

## 1. Introduction & Scope

This document specifies every REST endpoint the platform exposes, organized by domain to mirror the module boundaries established in SYSTEM_ARCHITECTURE.md Section 3. It follows OpenAPI 3.1 conceptual organization — reusable **components** (schemas, security schemes, common parameters, common responses) defined once and referenced by every endpoint — expressed here in Markdown/JSON for readability, with a mapping note (Section 18) on how this translates directly into a physical `openapi.yaml` file in the next phase.

Every endpoint entry in Sections 4–16 covers, per the request: Purpose, Authentication Required, Authorization Required, Path/Query Parameters, Headers, Request Body, Success Response, Validation Rules, Possible Errors, HTTP Status Codes, Rate Limits, Idempotency Requirements, and an Example Request/Response. To avoid ~65 endpoints each repeating identical boilerplate, every entry **references** the shared conventions defined in Section 2 (response envelope, error catalog, pagination, headers, rate-limit tiers) and the shared schemas in Section 3, stating only what is specific to that endpoint — exactly as a well-factored OpenAPI document uses `$ref` rather than inlining the same schema sixty-five times.

**Base URL:** `https://api.<platform-domain>/api/v1`

---

## 2. Global API Standards

### 2.1 Versioning Strategy

- The entire API is versioned at the **URI path level**: `/api/v1/...` — fixed by requirement, and the simplest strategy for clients (including the Angular frontend, third-party integrators via the future `APIKey` mechanism from PRISMA_SCHEMA.md Section 12, and Postman/testing tooling) to reason about explicitly, with no ambiguity from header-based versioning that's easy to omit by accident.
- **Backward-compatible changes** (new optional request fields, new response fields, new endpoints, new optional query parameters) ship within `v1` without a version bump — clients must be built to ignore unknown response fields, a requirement stated explicitly here as part of the contract.
- **Breaking changes** (removing/renaming a field, changing a field's type or meaning, changing required-ness, changing an endpoint's URL or method, changing error codes) require a new version, `/api/v2`, with `v1` continuing to run in parallel through the deprecation window (Section 2.13). No breaking change is ever pushed into `v1` silently.
- A change's breaking/non-breaking classification is a mandatory field in every PR that touches this contract — this is a process convention for the next phase's implementation, not a schema mechanism, but is recorded here since it is this document's enforcement responsibility.

### 2.2 Standard Success Response Envelope

Every successful response (2xx) uses this envelope:

```json
{
  "success": true,
  "data": {},
  "meta": {},
  "message": null,
  "requestId": "req_01J8Z3K7XG9F5Q2M4N6P8R1T3V"
}
```

- `data` — the resource(s) requested/created/modified. An object for single-resource endpoints, an array for list endpoints.
- `meta` — non-resource metadata: pagination info (Section 2.4), counts, or other contextual data. Omitted (`null`) or `{}` when not applicable — never a required field for the client to depend on being populated.
- `message` — an optional, human-readable confirmation string (e.g., `"Verification email sent."`). `null` when the data itself is self-explanatory (most `GET` responses).
- `requestId` — always present; see Section 2.9.

List endpoints follow this shape:

```json
{
  "success": true,
  "data": [ {}, {} ],
  "meta": {
    "pagination": { "strategy": "cursor", "limit": 20, "nextCursor": "eyJpZCI6Ii4uLiJ9", "hasMore": true }
  },
  "message": null,
  "requestId": "req_01J8Z3K7XG9F5Q2M4N6P8R1T3V"
}
```

### 2.3 Standard Error Response Envelope

Every error response (4xx/5xx) uses this envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields failed validation.",
    "details": [
      { "field": "email", "issue": "must be a valid email address" }
    ]
  },
  "requestId": "req_01J8Z3K7XG9F5Q2M4N6P8R1T3V"
}
```

- `error.code` — a stable, machine-readable string from the catalog below (Section 2.3.1). Frontend code branches on this, never on `error.message` (which is human-readable and may be reworded without notice).
- `error.details` — an array, populated primarily for `VALIDATION_ERROR` (one entry per failing field, `{ field, issue }`), empty (`[]`) for error types with no field-level breakdown.
- `requestId` — always present, and always safe to show to a user in a "please quote this reference when contacting support" message.

#### 2.3.1 Global Error Code Catalog

Every endpoint's "Possible Errors" section below lists only its **endpoint-specific** error codes; every endpoint additionally and implicitly returns the following where applicable, not re-stated per endpoint:

| `error.code` | HTTP Status | Meaning | Applies To |
|---|---|---|---|
| `VALIDATION_ERROR` | 422 | Request body/query failed schema or business-rule validation | Any endpoint accepting input |
| `UNAUTHORIZED` | 401 | Missing, malformed, or expired access token | Any authenticated endpoint |
| `FORBIDDEN` | 403 | Authenticated, but the caller's role/permission does not allow this action, or the request targets a resource outside the caller's tenant | Any authorized endpoint |
| `TENANT_SUSPENDED` | 402 | The caller's tenant subscription is `PAST_DUE`/`SUSPENDED` and the action is blocked pending payment resolution (mirrors the frontend's `TenantActiveGuard`, SYSTEM_ARCHITECTURE.md 4.6) | Any tenant-scoped write endpoint |
| `NOT_FOUND` | 404 | The resource does not exist, or exists in a different tenant (identical response in both cases — see Section 8, Security Note) | Any endpoint with a path resource ID |
| `CONFLICT` | 409 | The request conflicts with current state (duplicate unique field, booking overlap, idempotency key reused with a different payload) | Write endpoints |
| `RATE_LIMITED` | 429 | The caller exceeded their rate-limit tier (Section 2.10) | All endpoints |
| `UPSTREAM_UNAVAILABLE` | 503 | A required third-party dependency (OpenAI, WhatsApp Cloud API, Stripe) is unreachable or erroring | Endpoints depending on that integration |
| `INTERNAL_ERROR` | 500 | An unexpected server-side failure | Any endpoint |

Every error response additionally sets the `X-Request-Id` response header to the same value as the body's `requestId`, and a `429` response additionally sets a `Retry-After` header (seconds).

### 2.4 Pagination

**Decision: cursor-based (keyset) pagination is the default and required strategy for all list endpoints. Offset-based (`page`/`limit`) pagination is additionally supported, but only on a short, explicitly-named allow-list of small, bounded, admin-facing lists.**

#### 2.4.1 Why Cursor-Based Is the Default

- **Stability under concurrent writes.** The platform's highest-volume list endpoints (`GET /messages`, `GET /conversations`, `GET /appointments`) are read against tables that are being written to continuously and in real time (an inbound WhatsApp message can arrive mid-scroll). Offset pagination (`LIMIT/OFFSET`) is well-known to skip or duplicate rows when the underlying result set shifts between page requests; keyset pagination (`WHERE (created_at, id) < (:cursorCreatedAt, :cursorId)`) does not have this failure mode, because each page is defined relative to the last row actually seen, not a positional offset.
- **Performance at scale.** DATABASE_DESIGN.md Section 12.5 explicitly models `messages` reaching 10 million+ rows platform-wide. A deep `OFFSET 500000` query forces PostgreSQL to scan and discard half a million rows before returning results; a keyset condition using the already-indexed `(conversationId, createdAt)` composite index (PRISMA_SCHEMA.md Section 8) resolves in constant time regardless of how deep the client has paged.
- **Natural fit with UUIDv7 primary keys.** PRISMA_SCHEMA.md Section 1.1 already gives `Message`, `AuditLog`, `ActivityLog`, `AppointmentStatusHistory`, and the webhook-log tables time-ordered primary keys specifically so a keyset cursor can be built directly from `id` (or `id` combined with a secondary sort field) without needing a separate covering index just to support pagination.

Cursor format: an opaque, base64-encoded JSON string (e.g., `eyJpZCI6IjAxSjguLi4iLCJjcmVhdGVkQXQiOiIuLi4ifQ==`) encoding the last-seen sort key(s) — clients must treat it as opaque and never construct or parse it themselves; the encoding is an implementation detail free to change within `v1` as long as previously-issued cursors remain valid through their natural expiry (cursors are not guaranteed valid indefinitely — a cursor older than 24 hours may 400 with `CURSOR_EXPIRED`, prompting the client to restart from the first page, an acceptable UX tradeoff for a real-time inbox/calendar view that wouldn't want a week-old cursor silently resuming anyway).

#### 2.4.2 Where Offset Pagination Is Also Available

`GET /employees`, `GET /services`, `GET /plans`, `GET /admin/tenants`, `GET /admin/users` — resources that are either genuinely small per tenant (an employee/service catalog is realistically dozens of rows, DATABASE_DESIGN.md 3.3.1/3.3.3 row-growth estimates) or are Admin-console screens where "jump to page 4 of 10" and a visible total-page-count are worth the tradeoff, and where the underlying data changes slowly enough that offset drift is a non-issue in practice. **`GET /messages`, `GET /conversations`, `GET /appointments`, and any future audit/activity-log-backed endpoint must never offer offset pagination** — this is a standing rule for this API, not a per-endpoint judgment call, to prevent the exact performance/correctness failure mode Section 2.4.1 describes from being reintroduced by a future endpoint author reaching for the more "familiar" pattern.

Query parameters:

| Strategy | Params | Response `meta.pagination` |
|---|---|---|
| Cursor (default) | `cursor` (opaque string, omit for first page), `limit` (default 20, max 100) | `{ "strategy": "cursor", "limit": 20, "nextCursor": "...", "hasMore": true }` |
| Offset (allow-listed endpoints only) | `page` (default 1), `limit` (default 20, max 100) | `{ "strategy": "offset", "page": 1, "limit": 20, "totalItems": 47, "totalPages": 3 }` |

### 2.5 Filtering Conventions

Bracket-notation query parameters, applied only against the field allow-list each endpoint documents in its "Query Parameters" table — an unrecognized `filter[...]` key returns `400 INVALID_FILTER_FIELD`, never silently ignored (silent ignoring masks client bugs and gives a false sense that a filter was applied).

| Syntax | Meaning | Example |
|---|---|---|
| `filter[field]=value` | Exact match | `filter[status]=CONFIRMED` |
| `filter[field][in]=a,b,c` | Value in set | `filter[status][in]=CONFIRMED,PENDING` |
| `filter[field][gte]=value` / `[lte]` / `[gt]` / `[lt]` | Range comparison (dates, numbers) | `filter[startTime][gte]=2026-08-01T00:00:00Z` |
| `filter[field][ne]=value` | Not-equal | `filter[status][ne]=CANCELLED` |

Every tenant-scoped list endpoint implicitly filters to the caller's own `tenantId` (Section 2.14) — this is never a client-supplied filter and is not listed in any endpoint's filter allow-list, since it is not optional.

### 2.6 Sorting Conventions

`sort=field` for ascending, `sort=-field` for descending, comma-separated for multi-field sort with left-to-right precedence: `sort=-startTime,customerName`. Each endpoint documents its sortable-field allow-list; an unrecognized sort field returns `400 INVALID_SORT_FIELD`. Every list endpoint has a documented **default sort** (typically `-createdAt` or a domain-appropriate equivalent like `startTime` for appointments) applied when `sort` is omitted, so result ordering is never left to incidental database behavior.

### 2.7 Searching Conventions

A single `q` query parameter, supported only on endpoints that document it (`GET /customers`, `GET /employees`, `GET /services`). At MVP, `q` performs a case-insensitive substring match against a documented, small set of fields per resource (e.g., `Customer`: `firstName`, `lastName`, `phoneNumber`; via indexed `ILIKE`/prefix matching, not full-text ranking). DATABASE_DESIGN.md Section 6.4 flags a `pg_trgm` trigram-index upgrade as a near-term follow-up once staff-facing search-as-you-type is prioritized — `q`'s contract (a single free-text query string returning ranked-or-simply-matched results) is written to remain stable across that internal implementation upgrade, so no client-facing contract change is needed when it lands.

### 2.8 Common Reusable Response: List Query Parameters

Rather than repeat `cursor`/`page`/`limit`/`sort`/`q`/`filter[...]` in full on every list endpoint, each list endpoint's Query Parameters table states only its **resource-specific filters and sortable fields**, and links back here for the mechanics.

### 2.9 Request IDs

Every request is assigned a `requestId` (format `req_<26-char ULID>`), surfaced identically in the response body (`requestId` field, Section 2.2/2.3) and the `X-Request-Id` response header. A client **may** send its own `X-Request-Id` request header to correlate a request across its own logs; if present and well-formed, the server echoes that same value back rather than generating a new one, otherwise the server generates one. Every log line the backend emits for a request is tagged with this ID (SYSTEM_ARCHITECTURE.md 10.9), making it the single reference a support engineer needs to trace a specific user-reported issue end to end — this is why `requestId` is documented as always safe to surface in user-facing error UI ("quote this ID when contacting support").

### 2.10 Rate Limiting

Six tiers, referenced by name from each endpoint's "Rate Limits" field rather than restating numbers 65 times:

| Tier | Limit | Scope | Applies To |
|---|---|---|---|
| **Public-Sensitive** | 10 req/min | per IP | `/auth/register`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/google` |
| **Standard-Authenticated** | 120 req/min | per user | Most authenticated CRUD: Users, Tenant, Employees, Services, Customers, Notifications, Dashboard |
| **Booking-Critical** | 60 req/min | per user | `Appointments` write endpoints (create/cancel/reschedule) |
| **AI-Conversational** | 30 req/min | per tenant | `POST /ai/chat` (per-user for dashboard-test usage; per-tenant aggregate for webhook-triggered usage — Section 12) — additionally subject to the plan-based **monthly** message cap (FR-22), a separate, longer-window limit tracked via `Subscription.messagesUsedCurrentPeriod` (PRISMA_SCHEMA.md Section 10), not this per-minute tier |
| **Webhook-Ingestion** | 600 req/min | per source IP, DDoS backstop only | `POST /webhooks/whatsapp`, `POST /stripe/webhook` — not the primary control for these endpoints (signature verification and idempotency are, Sections 2.12/2.11); exempted from standard per-user limiting since Meta/Stripe are the caller, not an end user (SYSTEM_ARCHITECTURE.md 9.2) |
| **Admin** | 60 req/min | per user | `/admin/*` |

Every response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Unix timestamp) headers. A `429` additionally sets `Retry-After` (seconds) and returns the standard error envelope with `error.code = "RATE_LIMITED"`.

### 2.11 Security Headers

Applied to every API response (restating and operationalizing SYSTEM_ARCHITECTURE.md Section 9.7 at the API layer specifically):

| Header | Value | Purpose |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Enforce HTTPS |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-sniffing |
| `X-Frame-Options` | `DENY` | The API is never framed |
| `Content-Security-Policy` | `default-src 'none'` | An API has no scripts/styles/images to permit — deny everything by default |
| `Referrer-Policy` | `no-referrer` | No referrer leakage on any cross-origin API call |
| `Cache-Control` | `no-store` | Every API response is dynamic and potentially tenant-sensitive; nothing is cached by intermediaries or the browser |
| `Access-Control-Allow-Origin` | The exact configured frontend origin (never `*`) | CORS — see below |
| `Access-Control-Allow-Credentials` | `true` | Required for the httpOnly refresh-token cookie flow (SYSTEM_ARCHITECTURE.md 7.2) to function cross-origin between the SPA's origin and the API's origin |

CORS is an **allow-list of exactly the known frontend origin(s) per environment** (local dev, staging, production) — never a wildcard, since `Access-Control-Allow-Credentials: true` combined with `Access-Control-Allow-Origin: *` is both invalid per the CORS spec and a serious security anti-pattern if it were permitted.

### 2.12 Webhook Security

Applies to `POST /webhooks/whatsapp` and `POST /stripe/webhook` (Sections 11.1, 13.4):

- **No bearer-token authentication** — these endpoints are called by Meta/Stripe directly, which cannot hold a platform user session. Trust is instead established via **payload signature verification**:
  - WhatsApp: the `X-Hub-Signature-256` header (an HMAC-SHA256 of the raw request body, keyed with the app secret) is verified before the payload is trusted; a missing/invalid signature returns `401 INVALID_SIGNATURE` and the payload is discarded without processing.
  - Stripe: the `Stripe-Signature` header is verified against the endpoint's webhook signing secret using Stripe's signed-payload scheme; same failure behavior.
- **Raw body persistence before verification failure short-circuits.** Per SYSTEM_ARCHITECTURE.md 6.1, the raw payload is still logged to `WebhookEvent`/`WebhookLog` (PRISMA_SCHEMA.md Sections 9, 10) even on a verification failure, specifically so a pattern of failed-signature attempts is itself detectable (a potential spoofing attempt) rather than silently dropped with no trace.
- **Fast acknowledgment.** Both endpoints return `200 OK` immediately after signature verification and raw persistence, before any business-logic processing — Meta and Stripe both retry on non-2xx or slow responses, and slow synchronous processing inside the webhook handler would trigger unnecessary retries and duplicate event log entries (mitigated further by idempotency, Section 2.13, but avoided at the source here).
- **IP allow-listing as defense-in-depth, not the primary control.** Both Meta and Stripe publish their outbound webhook IP ranges; restricting inbound connections to these ranges at the Nginx/firewall layer (SYSTEM_ARCHITECTURE.md 10.3) is a recommended additional layer, but signature verification remains the authoritative trust mechanism, since IP ranges can change without notice and must never be the sole gate.

### 2.13 Idempotency Strategy

An `Idempotency-Key` request header (client-generated UUID) is **required** on the following state-mutating endpoints, all of which create a real-world side effect that must never be accidentally duplicated by a client retry (a dropped connection after the server already committed the write, a double-tap on a mobile network, an AI orchestration retry after a timeout):

`POST /appointments`, `POST /appointments/:id/cancel`, `POST /appointments/:id/reschedule`, `POST /messages/send`, `POST /subscriptions`, `POST /ai/tools/book`, `POST /ai/tools/reschedule`, `POST /ai/tools/cancel`.

**Mechanics:** the server stores `(tenantId, idempotencyKey) → { statusCode, responseBody }` in Redis (extending the key patterns in DATABASE_DESIGN.md Section 10) with a 24-hour TTL. A repeated request with the same key and an **identical request body** (compared via a hash of the normalized payload) returns the original cached response verbatim, without re-executing the operation. A repeated request with the same key but a **different** body returns `409 CONFLICT` with `error.code = "IDEMPOTENCY_KEY_REUSED"` — reusing a key for a different logical operation is a client bug, not something the server silently reconciles. Omitting the header on a required endpoint returns `400 IDEMPOTENCY_KEY_REQUIRED`.

**Endpoints not requiring it:** all `GET`s (naturally idempotent/side-effect-free); `PATCH` endpoints (this API's `PATCH` semantics are always full-field-replacement for the fields provided, making a retry naturally idempotent — resending the same `PATCH` body twice produces the same end state); `POST /auth/register` (naturally idempotent via the `email` unique constraint — a retry after a dropped connection either created the account on attempt one and gets `409 EMAIL_ALREADY_EXISTS` on attempt two, a safe and correct outcome without needing a key); webhook endpoints (idempotency is instead keyed on the **provider's own event ID** — Meta's `whatsappMessageId`, Stripe's event ID — per PRISMA_SCHEMA.md Sections 9/10, an entirely separate mechanism from the client-header pattern described here, documented in Section 2.12).

### 2.14 Authentication & Authorization Model (Summary)

- **Authentication:** `Authorization: Bearer <accessToken>` (short-lived JWT) on every non-public endpoint, exactly as designed in SYSTEM_ARCHITECTURE.md Section 7.1. The long-lived refresh token is never sent as a bearer token — it lives only in the httpOnly, `SameSite=strict` cookie set by `POST /auth/login`/`POST /auth/refresh` (Section 4).
- **Tenant scoping:** the JWT's `tenantId` claim is the **sole source of tenant context** for every tenant-scoped endpoint. No endpoint accepts a client-supplied `tenantId` in the path, query, or body for determining *which* tenant's data to operate on — doing so would be a direct IDOR/cross-tenant vulnerability (SYSTEM_ARCHITECTURE.md Section 8). Where a request body includes a `tenantId`-shaped field in this document's examples, it refers to a *different* tenant relationship (none exist in this API for MVP, since all resources are single-tenant-owned) — called out explicitly so implementers never add one by habit.
- **Roles:** `SUPER_ADMIN`, `OWNER`, `MANAGER`, `STAFF` (PRISMA_SCHEMA.md `RoleName`). Each endpoint's "Authorization Required" field names the minimum role(s), satisfied by that role or anything ranked higher (`SUPER_ADMIN` > `OWNER` > `MANAGER` > `STAFF`, docs/adr/ADR-005-rbac.md's role-hierarchy interpretation). ~~`SUPER_ADMIN` is never implicitly included in a tenant-scoped endpoint's allowed roles (a Super Admin uses the separate `/admin/*` surface, Section 16, to act on tenant data, preserving the architectural separation from SYSTEM_ARCHITECTURE.md Section 8.4).`~~ **Amended, Sprint 2.4/docs/adr/ADR-005-rbac.md:** `RolesGuard`/`PermissionGuard` now grant `SUPER_ADMIN` an explicit, logged bypass on every tenant-scoped role/permission check — a deliberate, requester-confirmed deviation from this section's original design, mitigated by a single shared chokepoint (`SuperAdminBypassService`) and mandatory audit logging (`SecurityEventService.record('SUPER_ADMIN_BYPASS', ...)`). The `/admin/*` surface (Section 16) still exists and is unaffected; the bypass only means `SUPER_ADMIN` no longer *needs* it to act on tenant-scoped endpoints. See the ADR for full reasoning.
- **Internal/system-scoped endpoints:** `POST /ai/tools/book`, `POST /ai/tools/reschedule`, `POST /ai/tools/cancel`, `POST /ai/tools/faq` are authenticated via a **service-level credential** (an internal API key issued to the backend's own AI-orchestration process, rotated independently of any user credential), not a user JWT — see Section 12's introductory note for why these exist as HTTP endpoints at all in a modular monolith.

### 2.14.1 RBAC Error Semantics (Sprint 2.4, docs/adr/ADR-005-rbac.md)

- **`403 FORBIDDEN`** (with a specific `error.code` — `INSUFFICIENT_ROLE`, `INSUFFICIENT_PERMISSION`, or `INVALID_TENANT_CONTEXT`) — the caller is authenticated but doesn't hold the required role/permission, or a tenant-scoped role's token unexpectedly carries no `tenantId`.
- **`404 NOT_FOUND`**, never `403` — a cross-tenant resource access attempt (Section 2.3.1's existing anti-enumeration rule), so a caller can never distinguish "doesn't exist" from "exists but belongs to another tenant." This applies uniformly to `SUPER_ADMIN` too, unlike the role/permission bypass above — the bypass only affects role/permission *requirement* checks, not resource-existence checks. (The per-resource-ID check itself is not yet built — see docs/SECURITY.md Section 3 — this rule governs it once it is.)
- Every `SUPER_ADMIN` bypass is logged as a `SUPER_ADMIN_BYPASS` security event (`userId`, `tenantId`, `route`, and the requirement that was bypassed) — not yet exposed via any API endpoint, but searchable in centralized logs today and designed to be trivially replayable into a real `AuditLog` table once Milestone 9 builds one.

### 2.15 Deprecation Strategy

- A deprecated endpoint (one being phased out within `v1`, or a `v1` endpoint superseded by `v2`) sets two response headers on every call: `Deprecation: true` and `Sunset: <RFC-1123 date>` (per RFC 8594), plus a `Link: <https://docs.<platform-domain>/migration/xyz>; rel="deprecation"` header pointing to migration guidance.
- **Minimum notice period: 90 days** between an endpoint being marked deprecated and its removal — no exceptions for convenience; a security-critical deprecation (e.g., an auth flow found to have a flaw) follows a separate, explicitly-communicated expedited path agreed with the frontend team, not this default window.
- Deprecated endpoints continue to function identically (no behavior change, only the added headers) throughout the notice window — deprecation is a signal, never a silent degradation.
- Every deprecation is logged in a maintained `CHANGELOG.md` (a deliverable of the next implementation phase, not this document) with the deprecation date, removal date, and migration path.

---

## 3. Shared Schemas (Components)

Referenced by name (e.g., "Response: `AppointmentDTO`") from every endpoint in Sections 4–16, instead of being redefined per endpoint — mirroring OpenAPI's `components.schemas` + `$ref` pattern. Field names/types trace directly to PRISMA_SCHEMA.md; only API-relevant fields are exposed (internal-only columns like `passwordHash`, `accessTokenEncrypted`, `refreshTokenHash` are never serialized into any response, regardless of caller role).

```
UserDTO {
  id: uuid
  email: string
  firstName: string
  lastName: string
  roles: RoleName[]              // e.g. ["OWNER"]
  isActive: boolean
  isEmailVerified: boolean
  lastLoginAt: datetime | null
  createdAt: datetime
}

TenantDTO {
  id: uuid
  name: string
  slug: string
  status: TenantStatus
  timezone: string
  addressLine1: string | null
  city: string | null
  countryCode: string | null
  defaultLocale: string
  logoUrl: string | null         // pre-signed S3 URL, resolved server-side from logoFileId
  trialEndsAt: datetime | null
  createdAt: datetime
}

TenantSettingsDTO {
  aiGreetingMessage: string | null
  aiTone: string
  aiEscalationInstructions: string | null
  cancellationNoticeHours: integer
  bookingBufferMinutes: integer
  reminderHoursBefore: integer
  aiDisclosureEnabled: boolean
  notificationPreferences: object
}

EmployeeDTO {
  id: uuid
  firstName: string
  lastName: string
  phoneNumber: string | null
  status: EmployeeStatus
  colorTag: string | null
  bio: string | null
  serviceIds: uuid[]             // from EmployeeService
  createdAt: datetime
}

ServiceDTO {
  id: uuid
  categoryId: uuid | null
  categoryName: string | null
  name: string
  description: string | null
  durationMinutes: integer
  priceCents: integer
  currency: string
  isActive: boolean
  eligibleEmployeeIds: uuid[]
}

CustomerDTO {
  id: uuid
  phoneNumber: string
  firstName: string | null
  lastName: string | null
  email: string | null
  preferredLanguage: string | null
  preferredEmployeeId: uuid | null
  marketingOptIn: boolean
  tags: { id: uuid, name: string, color: string | null }[]
  createdAt: datetime
}

AppointmentServiceLineDTO {
  serviceId: uuid
  serviceName: string            // snapshot at booking time
  durationMinutes: integer       // snapshot
  priceCents: integer            // snapshot
  employeeId: uuid
}

AppointmentDTO {
  id: uuid
  customerId: uuid
  customer: { id: uuid, firstName: string | null, lastName: string | null, phoneNumber: string }
  employeeId: uuid
  employeeName: string
  status: AppointmentStatus
  startTime: datetime
  endTime: datetime
  totalPriceCents: integer
  currency: string
  services: AppointmentServiceLineDTO[]
  notes: string | null
  cancellationReason: string | null
  conversationId: uuid | null
  rescheduledFromAppointmentId: uuid | null
  createdAt: datetime
  updatedAt: datetime
}

AvailabilitySlotDTO {
  employeeId: uuid
  employeeName: string
  startTime: datetime
  endTime: datetime
}

ConversationDTO {
  id: uuid
  customerId: uuid
  customer: { id: uuid, firstName: string | null, lastName: string | null, phoneNumber: string }
  status: ConversationStatus
  assignedUserId: uuid | null
  lastMessageAt: datetime
  lastMessagePreview: string | null
  createdAt: datetime
}

MessageDTO {
  id: uuid
  conversationId: uuid
  direction: MessageDirection
  senderType: MessageSenderType
  senderUserId: uuid | null
  messageType: MessageType
  content: string | null
  mediaUrl: string | null        // pre-signed URL, resolved from mediaId
  status: MessageDeliveryStatus
  createdAt: datetime
}

PlanDTO {
  id: uuid
  name: string
  monthlyPriceCents: integer
  currency: string
  maxStaff: integer | null
  maxMessagesPerMonth: integer | null
  maxLocations: integer
  trialDays: integer
}

SubscriptionDTO {
  id: uuid
  planId: uuid
  plan: PlanDTO
  status: SubscriptionStatus
  currentPeriodStart: datetime | null
  currentPeriodEnd: datetime | null
  cancelAtPeriodEnd: boolean
  messagesUsedCurrentPeriod: integer
}

InvoiceDTO {
  id: uuid
  amountDueCents: integer
  amountPaidCents: integer
  currency: string
  status: InvoiceStatus
  invoicePdfUrl: string | null
  issuedAt: datetime
  paidAt: datetime | null
}

NotificationDTO {
  id: uuid
  channel: NotificationChannel
  type: NotificationType
  subject: string | null
  status: NotificationStatus
  readAt: datetime | null        // application-level "read" tracking, surfaced via this DTO field
  createdAt: datetime
}

ValidationErrorDetail {
  field: string
  issue: string
}
```

**Enums referenced above** (`RoleName`, `TenantStatus`, `EmployeeStatus`, `AppointmentStatus`, `ConversationStatus`, `MessageDirection`, `MessageSenderType`, `MessageType`, `MessageDeliveryStatus`, `SubscriptionStatus`, `InvoiceStatus`, `NotificationChannel`, `NotificationType`, `NotificationStatus`) are exactly the enums defined in PRISMA_SCHEMA.md Section 2 — this API never introduces a parallel, API-only enum for a concept the database already models, keeping the contract and the schema provably in sync.

---

## 4. Authentication Endpoints

Tag: `Auth`. Base path: `/api/v1/auth`.

#### `POST /auth/register`
**Purpose:** Create a new salon (`Tenant`) and its first `User` (`OWNER`) in a single call — the sign-up entry point (FR-1, PROJECT_REQUIREMENTS.md 14.1).
**Auth:** Public. **Authorization:** None.
**Path/Query Params:** None. **Headers:** `Content-Type: application/json`.
**Request Body:**
```json
{ "email": "owner@salon.com", "password": "Str0ngP@ss!", "firstName": "Maria", "lastName": "Gomez", "tenantName": "Bella Salon", "timezone": "America/Sao_Paulo" }
```
**Validation Rules:** `email` valid format & globally unique (PRISMA_SCHEMA.md 3.1.1); `password` min 8 chars, ≥1 uppercase, ≥1 number; `firstName`/`lastName`/`tenantName` required, 1–100 chars; `timezone` must be a valid IANA name.
**Success — 201 Created:** `{ "success": true, "data": { "user": UserDTO, "tenant": TenantDTO }, "message": "Account created. Please log in." }`
**Errors:** `409 EMAIL_ALREADY_EXISTS`, `422 VALIDATION_ERROR` (+ global set, Section 2.3.1).
**Rate Limit:** Public-Sensitive. **Idempotency:** Not required (naturally idempotent via `email` uniqueness, Section 2.13).
**Example:** `curl -X POST /api/v1/auth/register -d '{...above...}'` → `201` with the body shown above.
**Implementation note (Milestone 2 Core Authentication sprint, docs/adr/ADR-003-core-authentication.md; updated Sprint 2.3, docs/adr/ADR-004-account-security.md):** as of the Core Authentication sprint, only `Tenant` + `User` (`OWNER`) + `UserRole` are created — `TenantSettings` and the default trial `Subscription` don't exist as tables yet (Milestone 3/8) and are not created here; this part of the note remains accurate and should be removed once Milestone 3 wires up the full atomic `Tenant`+`Owner`+`TenantSettings`+`Subscription` transaction IMPLEMENTATION_ROADMAP.md Sprint 3.1 specifies. **As of Sprint 2.3, the `message` is `"Verification email sent."` again** (matching the original documented contract above) — a verification email is genuinely sent now (docs/AUTHENTICATION.md Section 6a.3), so the Core Authentication sprint's temporary substitution of `"Account created. Please log in."` no longer applies.

#### `POST /auth/login`
**Purpose:** Authenticate with email/password and establish a session.
**Auth:** Public. **Authorization:** None.
**Headers:** `Content-Type: application/json`.
**Request Body:** `{ "email": "owner@salon.com", "password": "Str0ngP@ss!" }`
**Validation Rules:** both fields required.
**Success — 200 OK:** `{ "success": true, "data": { "user": UserDTO, "tenant": TenantDTO, "accessToken": "<jwt>", "expiresIn": 900 } }` — a `Set-Cookie` response header additionally sets the httpOnly refresh-token cookie (Section 2.14); the refresh token itself never appears in the JSON body.
**Errors:** `401 INVALID_CREDENTIALS`, `403 EMAIL_NOT_VERIFIED`, `403 ACCOUNT_DEACTIVATED`, `403 ACCOUNT_LOCKED` (5 failed attempts within 15 minutes triggers a 15-minute temporary lockout, tracked in Redis keyed by normalized email — docs/AUTHENTICATION.md Section 6a.5).
**Rate Limit:** Public-Sensitive (deliberately strict — this is the primary brute-force target, SYSTEM_ARCHITECTURE.md 9.2). **Idempotency:** Not required (read-like in effect; each call issues a new independent session, which is correct, not a duplication concern).
**Example Response (200):** as above.

#### `POST /auth/logout`
**Purpose:** Revoke the current session's refresh token (SYSTEM_ARCHITECTURE.md 7.2).
**Auth:** Required (Bearer JWT). **Authorization:** Any authenticated role.
**Headers:** `Authorization: Bearer <accessToken>`; the refresh-token cookie is read server-side, not client-supplied in the body.
**Request Body:** None.
**Success — 200 OK:** `{ "success": true, "data": {}, "message": "Logged out." }` — response also clears the refresh-token cookie (`Set-Cookie` with immediate expiry).
**Errors:** `401 UNAUTHORIZED`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (revoking an already-revoked session is a safe no-op, returns `200` either way).

#### `POST /auth/refresh`
**Purpose:** Exchange a valid refresh-token cookie for a new access token, rotating the refresh token (SYSTEM_ARCHITECTURE.md 7.2).
**Auth:** Refresh-token cookie (no `Authorization` header expected/used on this call). **Authorization:** None beyond a valid, unrevoked session.
**Headers:** Refresh-token cookie sent automatically by the browser.
**Request Body:** None.
**Success — 200 OK:** `{ "success": true, "data": { "accessToken": "<jwt>", "expiresIn": 900 } }` — `Set-Cookie` rotates the refresh token to a new value; the prior token is marked `revokedAt` (`RefreshToken.replacedBySessionId` chain, PRISMA_SCHEMA.md 3.1.5).
**Errors:** `401 INVALID_OR_EXPIRED_REFRESH_TOKEN`, `401 REFRESH_TOKEN_REUSE_DETECTED` (triggers full session-chain revocation as a security response, SYSTEM_ARCHITECTURE.md 7.2).
**Rate Limit:** Standard-Authenticated (keyed by session, not user, since this is called automatically by the frontend's `AuthInterceptor` on 401). **Idempotency:** Not required — each call is expected to produce a new rotated token; that is the intended behavior, not a duplication risk.

#### `POST /auth/forgot-password`
**Purpose:** Trigger a password-reset email (SYSTEM_ARCHITECTURE.md 7.6).
**Auth:** Public. **Authorization:** None.
**Request Body:** `{ "email": "owner@salon.com" }`
**Validation Rules:** `email` valid format.
**Success — 200 OK:** `{ "success": true, "data": {}, "message": "If an account exists for this email, a reset link has been sent." }` — **deliberately identical response whether or not the email exists**, to prevent user enumeration via this endpoint.
**Errors:** `422 VALIDATION_ERROR` only (no `404` — see above).
**Rate Limit:** Public-Sensitive. **Idempotency:** Not required (each call issuing a fresh token is correct behavior).

#### `POST /auth/reset-password`
**Purpose:** Complete the password-reset flow using the emailed token.
**Auth:** Public (the token itself is the credential). **Authorization:** None.
**Request Body:** `{ "token": "<raw-token-from-email-link>", "newPassword": "N3wStr0ngP@ss!" }`
**Validation Rules:** `newPassword` same rules as registration; `token` required, must resolve to a `PasswordReset` row with `usedAt = null` and `expiresAt > now()`.
**Success — 200 OK:** `{ "success": true, "data": {}, "message": "Password updated. Please log in." }` — all active sessions/refresh tokens for the user are revoked as part of this call (Section 7.6 security measure).
**Errors:** `400 INVALID_OR_EXPIRED_TOKEN`, `422 VALIDATION_ERROR`.
**Rate Limit:** Public-Sensitive. **Idempotency:** Not required (the token itself is single-use by design — `usedAt` — so a replay naturally fails with `400 INVALID_OR_EXPIRED_TOKEN` rather than needing a separate idempotency mechanism).

#### `POST /auth/verify-email`
**Purpose:** Complete email verification using the emailed token (SYSTEM_ARCHITECTURE.md 7.7).
**Auth:** Public (token is the credential). **Authorization:** None.
**Request Body:** `{ "token": "<raw-token-from-email-link>" }`
**Success — 200 OK:** `{ "success": true, "data": { "user": UserDTO }, "message": "Email verified." }`
**Errors:** `400 INVALID_OR_EXPIRED_TOKEN`.
**Rate Limit:** Public-Sensitive. **Idempotency:** Not required (single-use token, same rationale as above).

#### `POST /auth/resend-verification`
**Added:** Sprint 2.3 (docs/adr/ADR-004-account-security.md) — not part of this document's original Section 4 endpoint set; added here as a living-document amendment per IMPLEMENTATION_ROADMAP.md Section 8.1's policy.
**Purpose:** Re-send the email verification link (SYSTEM_ARCHITECTURE.md 7.7) — for a user who lost the original email or whose link expired.
**Auth:** Public. **Authorization:** None.
**Request Body:** `{ "email": "owner@salon.com" }`
**Validation Rules:** `email` valid format.
**Success — 200 OK:** `{ "success": true, "data": {}, "message": "If an account exists for this email and is not yet verified, a verification link has been sent." }` — **deliberately identical response** whether the account doesn't exist, is already verified, or a fresh token was actually issued (enumeration-resistant, mirroring `/auth/forgot-password`'s non-enumeration contract).
**Errors:** `422 VALIDATION_ERROR` only (no `404`/distinguishing code — see above).
**Rate Limit:** Public-Sensitive. **Idempotency:** Not required (each call issuing a fresh token — and invalidating the prior one — is correct behavior).

#### `POST /auth/google`
**Purpose:** Complete the Google OAuth 2.0 authorization-code exchange and establish a session (SYSTEM_ARCHITECTURE.md 7.5).
**Auth:** Public (the OAuth code is the credential). **Authorization:** None.
**Request Body:** `{ "code": "<oauth-authorization-code>", "redirectUri": "https://app.<platform-domain>/auth/google/callback" }`
**Validation Rules:** `code` required; the Google identity's email must match an existing invited/registered `User` — this endpoint does **not** self-register a new tenant (only `/auth/register` does), consistent with SYSTEM_ARCHITECTURE.md 7.5's rule that Google login cannot self-assign to an arbitrary tenant.
**Success — 200 OK:** Same shape as `POST /auth/login`.
**Errors:** `401 GOOGLE_TOKEN_INVALID`, `403 NO_MATCHING_ACCOUNT` (email not linked to any existing `User`/pending `TenantInvitation`).
**Rate Limit:** Public-Sensitive. **Idempotency:** Not required.

#### `GET /auth/me`
**Purpose:** Return the currently authenticated user's identity, roles, and tenant context — used by the frontend on app bootstrap to hydrate `AuthStateService` (SYSTEM_ARCHITECTURE.md 4.2).
**Auth:** Required (Bearer JWT). **Authorization:** Any authenticated role.
**Request Body:** None.
**Success — 200 OK:** `{ "success": true, "data": { "user": UserDTO, "tenant": TenantDTO | null } }` — `tenant` is `null` only for `SUPER_ADMIN`.
**Errors:** `401 UNAUTHORIZED`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (read-only).

---

## 5. Users Endpoints

Tag: `Users`. Base path: `/api/v1/users`. All endpoints are tenant-scoped to the caller's own tenant (Section 2.14) — cross-tenant user administration happens only via `GET /admin/users` (Section 16).

#### `GET /users`
**Purpose:** List staff/platform users within the caller's tenant (FR-4).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Query Params:** `filter[roles][in]`, `filter[isActive]`; sortable: `firstName`, `lastName`, `createdAt` (default `-createdAt`); pagination: offset (small, bounded list, Section 2.4.2); `q` searches `firstName`/`lastName`/`email`.
**Success — 200 OK:** `{ "success": true, "data": UserDTO[], "meta": { "pagination": {...offset...} } }`
**Errors:** `403 FORBIDDEN`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A (read).

#### `GET /users/:id`
**Purpose:** Retrieve a single user's detail.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, or the requesting `STAFF` user viewing **their own** record (`:id === caller.id`).
**Path Params:** `id` (uuid, required).
**Success — 200 OK:** `{ "success": true, "data": UserDTO }`
**Errors:** `403 FORBIDDEN` (Staff viewing another user), `404 NOT_FOUND` (also returned, not `403`, if `:id` belongs to a different tenant — Section 2.3.1 note on identical 404 behavior to avoid leaking cross-tenant existence).
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `POST /users`
**Purpose:** Invite a new staff user to the tenant (creates a `TenantInvitation`, not an active `User` directly — FR-4).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Request Body:** `{ "email": "ana@salon.com", "firstName": "Ana", "lastName": "Silva", "role": "STAFF" }`
**Validation Rules:** `email` valid, no existing pending invitation for `(tenantId, email)` (PRISMA_SCHEMA.md 4.1); `role` must be `MANAGER` or `STAFF` — `OWNER` cannot be assigned via invite (only via account transfer, out of API scope for MVP) and `SUPER_ADMIN` is never assignable through this endpoint.
**Success — 201 Created:** `{ "success": true, "data": { "invitationId": "uuid", "email": "ana@salon.com", "role": "STAFF", "expiresAt": "..." }, "message": "Invitation sent." }`
**Errors:** `403 FORBIDDEN` (a `MANAGER` attempting to invite a `MANAGER`, if the business rule restricts that — configurable, defaults to allowed), `409 INVITATION_ALREADY_PENDING`, `402 TENANT_SUSPENDED`, `403 PLAN_STAFF_LIMIT_EXCEEDED` (Plan.maxStaff reached).
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (the `(tenantId, email)` pending-invitation uniqueness constraint, PRISMA_SCHEMA.md 4.1, gives natural idempotency — a retry hits `409 INVITATION_ALREADY_PENDING`, a safe outcome).

#### `PATCH /users/:id`
**Purpose:** Update a user's profile or role.
**Auth:** Required. **Authorization:** `OWNER` for role changes; `OWNER`/`MANAGER` for profile fields on others; any user may `PATCH` their own `firstName`/`lastName` (role/`isActive` changes to self are rejected regardless of role, to prevent accidental self-lockout).
**Path Params:** `id` (uuid). **Request Body (all fields optional):** `{ "firstName": "...", "lastName": "...", "role": "MANAGER", "isActive": false }`
**Validation Rules:** at least one field present; `role` change validated against the same allow-list as `POST /users`; cannot demote/deactivate the tenant's **last remaining `OWNER`** (business rule, PROJECT_REQUIREMENTS.md Section 15) — returns `409 LAST_OWNER_PROTECTED`.
**Success — 200 OK:** `{ "success": true, "data": UserDTO }`
**Errors:** `403 FORBIDDEN`, `404 NOT_FOUND`, `409 LAST_OWNER_PROTECTED`, `422 VALIDATION_ERROR`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (full-field-replacement PATCH semantics, Section 2.13).

#### `DELETE /users/:id`
**Purpose:** Deactivate (soft-delete) a staff user — revokes dashboard access; does **not** delete the linked `Employee` schedulable-resource record if one exists (PRISMA_SCHEMA.md 5.1 — `Employee.userId` is set null, the employee resource itself survives independently, since a departed staff member's historical bookings must remain intact).
**Auth:** Required. **Authorization:** `OWNER` only.
**Path Params:** `id` (uuid).
**Success — 200 OK:** `{ "success": true, "data": {}, "message": "User deactivated." }`
**Errors:** `403 FORBIDDEN`, `404 NOT_FOUND`, `409 LAST_OWNER_PROTECTED`, `409 CANNOT_DELETE_SELF`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (soft-delete is naturally idempotent — deactivating an already-deactivated user is a safe no-op, `200`).

---

## 6. Tenant Endpoints

Tag: `Tenant`. Base path: `/api/v1/tenant`. Singular, unparameterized paths — always refers to the caller's own tenant (resolved from the JWT), never a path `:id` (Section 2.14).

#### `GET /tenant`
**Purpose:** Retrieve the caller's salon profile.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF` (all roles can view; SYSTEM_ARCHITECTURE.md 4.5 `settings` feature is Owner/Manager-only for editing, but read access to basic profile is broadly useful, e.g., to display salon name/hours in the dashboard shell for any role).
**Success — 200 OK:** `{ "success": true, "data": TenantDTO }`
**Errors:** `401 UNAUTHORIZED`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `PATCH /tenant`
**Purpose:** Update salon profile fields (name, address, timezone, branding).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Request Body (all optional):** `{ "name": "...", "addressLine1": "...", "city": "...", "countryCode": "BR", "timezone": "America/Sao_Paulo", "defaultLocale": "pt", "logoFileId": "uuid" }`
**Validation Rules:** `timezone` valid IANA name; `countryCode` valid ISO 3166-1 alpha-2; `logoFileId` (if present) must reference a `File` row already uploaded via `POST /files` (Section 15 note — the Files upload endpoint itself is out of this document's explicit endpoint list but implied by `TenantDTO.logoUrl`; flagged in Section 17 as a gap to close before implementation) owned by the caller's tenant.
**Success — 200 OK:** `{ "success": true, "data": TenantDTO }`
**Errors:** `403 FORBIDDEN`, `422 VALIDATION_ERROR`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (full-field PATCH semantics).

#### `GET /tenant/settings`
**Purpose:** Retrieve AI-behavior and policy configuration (SYSTEM_ARCHITECTURE.md `Settings` module, FR-29).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Success — 200 OK:** `{ "success": true, "data": TenantSettingsDTO }`
**Errors:** `403 FORBIDDEN`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `PATCH /tenant/settings`
**Purpose:** Update AI behavior/policy configuration.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Request Body (all optional):** `{ "aiGreetingMessage": "...", "aiTone": "friendly", "aiEscalationInstructions": "...", "cancellationNoticeHours": 24, "bookingBufferMinutes": 10, "reminderHoursBefore": 24, "aiDisclosureEnabled": true, "notificationPreferences": {} }`
**Validation Rules:** `cancellationNoticeHours`/`bookingBufferMinutes`/`reminderHoursBefore` non-negative integers within sane bounds (e.g., ≤ 168 hours); `aiTone` from a documented small allow-list (`friendly`, `professional`, `casual`) at MVP.
**Success — 200 OK:** `{ "success": true, "data": TenantSettingsDTO }` — this write also invalidates the Redis-cached `ai:tenant-config:{tenantId}` key (DATABASE_DESIGN.md 10.2) so the AI reflects the change on the very next customer message, not after a TTL expiry.
**Errors:** `403 FORBIDDEN`, `422 VALIDATION_ERROR`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required.

---

## 7. Employees Endpoints

Tag: `Employees`. Base path: `/api/v1/employees`. Tenant-scoped.

#### `GET /employees`
**Purpose:** List schedulable staff resources (FR-4, DATABASE_DESIGN.md 3.3.1).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF` (read — staff need to see coworkers for context, e.g., booking hand-offs).
**Query Params:** `filter[status]`, `filter[serviceId]` (employees eligible for a given service, joins `EmployeeService`); sortable: `firstName`, `status` (default `firstName`); pagination: offset; `q` searches `firstName`/`lastName`.
**Success — 200 OK:** `{ "success": true, "data": EmployeeDTO[], "meta": { "pagination": {...} } }`
**Errors:** `403 FORBIDDEN`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `GET /employees/:id`
**Purpose:** Retrieve a single employee's detail, including working-hours summary.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF`.
**Path Params:** `id` (uuid).
**Success — 200 OK:** `{ "success": true, "data": EmployeeDTO }`
**Errors:** `404 NOT_FOUND`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `POST /employees`
**Purpose:** Add a new staff resource.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Request Body:** `{ "firstName": "Ana", "lastName": "Silva", "phoneNumber": "+5511999999999", "colorTag": "#4F46E5", "bio": "...", "serviceIds": ["uuid1","uuid2"], "userId": "uuid | null" }`
**Validation Rules:** `firstName`/`lastName` required; `phoneNumber` E.164 format if present; every `serviceIds[]` entry must reference a `Service` in the caller's own tenant (cross-tenant reference returns `422 VALIDATION_ERROR`, not `404`, since it's a body-field validation failure, not a missing-resource lookup); `userId` if present must be an existing `User` in the same tenant not already linked to another `Employee` (`Employee.userId` unique, PRISMA_SCHEMA.md 5).
**Success — 201 Created:** `{ "success": true, "data": EmployeeDTO }`
**Errors:** `403 PLAN_STAFF_LIMIT_EXCEEDED`, `402 TENANT_SUSPENDED`, `422 VALIDATION_ERROR`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Recommended via `Idempotency-Key` (optional, not in the required list of Section 2.13, since duplicate employee creation is a low-severity, staff-visible-and-correctable mistake rather than a customer-facing financial/booking error — the required list is reserved for higher-stakes operations).
**Example Response (201):** `{ "success": true, "data": { "id": "...", "firstName": "Ana", ..., "serviceIds": ["uuid1","uuid2"] } }`

#### `PATCH /employees/:id`
**Purpose:** Update an employee's profile, status, or service eligibility.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Path Params:** `id`. **Request Body (all optional):** same shape as `POST /employees`, any subset.
**Validation Rules:** same as `POST`; setting `status: "INACTIVE"` while the employee has future `CONFIRMED`/`PENDING` appointments returns `409 EMPLOYEE_HAS_UPCOMING_APPOINTMENTS` with the conflicting appointment count in `error.details`, requiring the caller to reassign/cancel them first — a deliberate guardrail against silently orphaning bookings.
**Success — 200 OK:** `{ "success": true, "data": EmployeeDTO }`
**Errors:** `404 NOT_FOUND`, `409 EMPLOYEE_HAS_UPCOMING_APPOINTMENTS`, `422 VALIDATION_ERROR`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (PATCH semantics).

#### `DELETE /employees/:id`
**Purpose:** Soft-delete an employee (departed staff member) — the underlying `Employee` row survives with `deletedAt` set so historical `Appointment`/`AppointmentService` references remain intact (DATABASE_DESIGN.md 9.5).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Path Params:** `id`.
**Success — 200 OK:** `{ "success": true, "data": {}, "message": "Employee removed." }`
**Errors:** `404 NOT_FOUND`, `409 EMPLOYEE_HAS_UPCOMING_APPOINTMENTS` (same guardrail as `PATCH`'s `INACTIVE` transition).
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (soft-delete idempotent).

---

## 8. Services Endpoints

Tag: `Services`. Base path: `/api/v1/services`. Tenant-scoped. (`ServiceCategory` CRUD is a natural companion resource but was not in the requested endpoint list; noted as a gap in Section 17 — category assignment is still settable via `Service`'s `categoryId` field below.)

#### `GET /services`
**Purpose:** List the service catalog (FR-5) — the data the AI relies on for recommendations and booking.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF`.
**Query Params:** `filter[isActive]`, `filter[categoryId]`; sortable: `name`, `priceCents`, `displayOrder` (default `displayOrder`); pagination: offset; `q` searches `name`/`description`.
**Success — 200 OK:** `{ "success": true, "data": ServiceDTO[], "meta": { "pagination": {...} } }`
**Errors:** `403 FORBIDDEN`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `GET /services/:id`
**Purpose:** Retrieve a single service's detail, including eligible-employee list.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF`.
**Path Params:** `id`.
**Success — 200 OK:** `{ "success": true, "data": ServiceDTO }`
**Errors:** `404 NOT_FOUND`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `POST /services`
**Purpose:** Add a new service to the catalog.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Request Body:** `{ "name": "Haircut & Blow-Dry", "description": "...", "durationMinutes": 45, "priceCents": 8000, "currency": "USD", "categoryId": "uuid | null", "eligibleEmployeeIds": ["uuid1"] }`
**Validation Rules:** `name` required (1–150 chars); `durationMinutes` integer, 5–480; `priceCents` non-negative integer; `currency` valid ISO 4217; `categoryId`/`eligibleEmployeeIds` entries must belong to the caller's tenant.
**Success — 201 Created:** `{ "success": true, "data": ServiceDTO }`
**Errors:** `402 TENANT_SUSPENDED`, `422 VALIDATION_ERROR`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Recommended (optional), same rationale as `POST /employees`.

#### `PATCH /services/:id`
**Purpose:** Update a service's fields, including deactivation.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Path Params:** `id`. **Request Body (all optional):** same shape as `POST /services`.
**Validation Rules:** same as `POST`. **Business rule:** editing `priceCents`/`durationMinutes` **never** modifies historical `AppointmentService` snapshot rows (DATABASE_DESIGN.md 1.4/PRISMA_SCHEMA.md 7.1) — this is stated explicitly here because it is the single most likely point of confusion for a frontend implementer expecting a price edit to retroactively "fix" a past invoice display.
**Success — 200 OK:** `{ "success": true, "data": ServiceDTO }`
**Errors:** `404 NOT_FOUND`, `422 VALIDATION_ERROR`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (PATCH semantics).

#### `DELETE /services/:id`
**Purpose:** Soft-delete (retire) a service — excluded from `filter[isActive]=true` results and from the AI's active catalog immediately (cache-invalidated per Section 6's `PATCH /tenant/settings` note), while past `AppointmentService` snapshot rows remain intact.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Path Params:** `id`.
**Success — 200 OK:** `{ "success": true, "data": {}, "message": "Service removed." }`
**Errors:** `404 NOT_FOUND`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (soft-delete idempotent).

---

## 9. Customers Endpoints

Tag: `Customers`. Base path: `/api/v1/customers`. Tenant-scoped.

#### `GET /customers`
**Purpose:** List the salon's customer records (DATABASE_DESIGN.md 3.4.1).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF`.
**Query Params:** `filter[tagId]`, `filter[marketingOptIn]`; sortable: `firstName`, `createdAt` (default `-createdAt`); pagination: **cursor** (a busy salon's customer list can grow into the thousands, DATABASE_DESIGN.md 3.4.1 row-growth note — this is the one Customer-domain list endpoint that opts into cursor pagination rather than the smaller-catalog offset pattern used by `Employees`/`Services`); `q` searches `firstName`/`lastName`/`phoneNumber`.
**Success — 200 OK:** `{ "success": true, "data": CustomerDTO[], "meta": { "pagination": {...cursor...} } }`
**Errors:** `403 FORBIDDEN`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `GET /customers/:id`
**Purpose:** Retrieve a customer's detail, including tags.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF`.
**Path Params:** `id`.
**Success — 200 OK:** `{ "success": true, "data": CustomerDTO }`
**Errors:** `404 NOT_FOUND`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `POST /customers`
**Purpose:** Manually create a customer record (staff-entered walk-in/phone booking customer — most customers are instead created automatically via the WhatsApp `findOrCreateByPhone` path, SYSTEM_ARCHITECTURE.md `Customers` module, not through this endpoint).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF`.
**Request Body:** `{ "phoneNumber": "+5511999999999", "firstName": "Sofia", "lastName": "Reyes", "email": "sofia@example.com", "preferredLanguage": "pt", "marketingOptIn": false }`
**Validation Rules:** `phoneNumber` required, E.164 format, unique within tenant (`(tenantId, phoneNumber)`, PRISMA_SCHEMA.md 6); `email` valid format if present.
**Success — 201 Created:** `{ "success": true, "data": CustomerDTO }`
**Errors:** `409 PHONE_NUMBER_ALREADY_EXISTS` (with the existing `customerId` in `error.details` so the frontend can offer "view existing customer" instead of a dead-end error), `422 VALIDATION_ERROR`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Recommended (optional) — the unique-phone constraint already gives a safe, informative conflict response on retry.

#### `PATCH /customers/:id`
**Purpose:** Update a customer's profile.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF`.
**Path Params:** `id`. **Request Body (all optional):** same shape as `POST /customers` minus `phoneNumber` (changing the WhatsApp identity of an existing customer record is deliberately not supported via simple `PATCH` — it would silently merge two distinct WhatsApp identities; this requires a dedicated future "merge customers" operation, flagged in Section 17, not this endpoint).
**Success — 200 OK:** `{ "success": true, "data": CustomerDTO }`
**Errors:** `404 NOT_FOUND`, `422 VALIDATION_ERROR`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required.

#### `DELETE /customers/:id`
**Purpose:** Soft-delete a customer record (DATABASE_DESIGN.md 9.1 — data-deletion/compliance-adjacent action).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Path Params:** `id`.
**Success — 200 OK:** `{ "success": true, "data": {}, "message": "Customer removed." }`
**Errors:** `404 NOT_FOUND`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (soft-delete idempotent). **Note:** this performs the standard soft-delete only; a genuine "right to be forgotten" hard-delete/anonymization request (DATABASE_DESIGN.md Risk DB-R7) is **not** served by this endpoint and requires a separate, not-yet-designed compliance procedure — called out so it is never assumed this endpoint satisfies a GDPR erasure request.

---

## 10. Appointments Endpoints

Tag: `Appointments`. Base path: `/api/v1/appointments`. Tenant-scoped. The highest-stakes resource group in the API (Critical-priority NFR, PROJECT_REQUIREMENTS.md Section 9) — every write endpoint here interacts with the booking-conflict-prevention mechanism designed in DATABASE_DESIGN.md Section 10.4/PRISMA_SCHEMA.md Section 14.4 (Redis lock + transactional check + `EXCLUDE` constraint backstop).

**Authorization scoping note (applies to every endpoint below):** `OWNER`/`MANAGER` see and act on all appointments tenant-wide. `STAFF` is scoped to appointments where `employeeId` matches their own linked `Employee` record, per PROJECT_REQUIREMENTS.md Business Rule 11 — a `STAFF` request for another employee's appointment returns `403 FORBIDDEN` (not `404`, since the resource genuinely exists within the same tenant and a `404` would be misleading here, unlike the cross-tenant case in Section 2.3.1).

#### `GET /appointments`
**Purpose:** List appointments — powers the dashboard calendar (FR-17).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF` (scoped per above).
**Query Params:** `filter[status][in]`, `filter[employeeId]`, `filter[customerId]`, `filter[startTime][gte]`/`[lte]` (date-range — the calendar's primary use); sortable: `startTime` (default, ascending), `-startTime`; pagination: **cursor** (high write-volume table, Section 2.4.1).
**Success — 200 OK:** `{ "success": true, "data": AppointmentDTO[], "meta": { "pagination": {...cursor...} } }`
**Errors:** `403 FORBIDDEN`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `GET /appointments/:id`
**Purpose:** Retrieve a single appointment's full detail, including service line-items.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF` (scoped).
**Path Params:** `id`.
**Success — 200 OK:** `{ "success": true, "data": AppointmentDTO }`
**Errors:** `403 FORBIDDEN`, `404 NOT_FOUND`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `POST /appointments`
**Purpose:** Create a new appointment (manual staff booking — the AI's equivalent action is the internal `POST /ai/tools/book`, Section 12, which shares this same underlying booking logic).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF`.
**Headers:** `Idempotency-Key` **required** (Section 2.13).
**Request Body:**
```json
{
  "customerId": "uuid",
  "employeeId": "uuid",
  "startTime": "2026-08-03T14:00:00Z",
  "serviceIds": ["uuid1", "uuid2"],
  "notes": "Customer prefers quiet chair."
}
```
**Validation Rules:** `customerId`/`employeeId`/every `serviceIds[]` entry must belong to the caller's tenant; every `serviceIds[]` entry must be in `EmployeeService` for the given `employeeId` (the employee must actually be eligible for each requested service, FR-11); `startTime` must be in the future and within `employeeId`'s computed availability (weighing `WorkingHours`, `EmployeeAvailability` overrides, `Holiday`, existing appointments, and `TenantSettings.bookingBufferMinutes`) — computed server-side, not trusted from a prior `GET /appointments/availability` call, since availability can change between the two requests; `endTime` is server-computed as `startTime + sum(service durations)`, never client-supplied.
**Success — 201 Created:** `{ "success": true, "data": AppointmentDTO }` — an `AppointmentStatusHistory` row (`action: CREATED`, `actorType: USER`) is written in the same transaction (PRISMA_SCHEMA.md 7.1), and an `AppointmentReminder` row is scheduled per `TenantSettings.reminderHoursBefore`.
**Errors:** `409 SLOT_NO_LONGER_AVAILABLE` (the specific, most important error this endpoint can return — the concurrent-booking race condition scenario, DATABASE_DESIGN.md Risk DB-R3, surfaced as a clear, actionable client error rather than a generic `409 CONFLICT`), `402 TENANT_SUSPENDED`, `422 VALIDATION_ERROR` (includes the "employee not eligible for service" and "outside business hours" cases as field-level `details`).
**Rate Limit:** Booking-Critical. **Idempotency:** **Required.**
**Example Response (201):** `{ "success": true, "data": { "id": "...", "status": "CONFIRMED", "startTime": "2026-08-03T14:00:00Z", "endTime": "2026-08-03T14:45:00Z", "totalPriceCents": 8000, ... } }`

#### `PATCH /appointments/:id`
**Purpose:** Update non-status appointment fields (notes, or a full modification that isn't a reschedule/cancel — e.g., correcting a typo in notes). **Not** used for status transitions — those go through the dedicated `POST .../cancel` and `POST .../reschedule` endpoints below, which carry business rules (cancellation-notice policy, history logging) a generic `PATCH` should not silently bypass.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF` (scoped).
**Path Params:** `id`. **Request Body:** `{ "notes": "..." }` — deliberately the only mutable field via this endpoint; `status`, `startTime`, `employeeId`, `serviceIds` are **rejected** here with `422 USE_DEDICATED_ENDPOINT` naming the correct endpoint, a deliberate API design choice to prevent the booking-integrity guarantees of `cancel`/`reschedule` from being bypassed via a generic field update.
**Success — 200 OK:** `{ "success": true, "data": AppointmentDTO }`
**Errors:** `403 FORBIDDEN`, `404 NOT_FOUND`, `422 USE_DEDICATED_ENDPOINT`, `422 VALIDATION_ERROR`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (PATCH semantics, and the mutable surface is a single non-side-effecting text field).

#### `DELETE /appointments/:id`
**Purpose:** **Hard-remove** an appointment record from all standard views — reserved for genuine data-entry errors (e.g., a test booking, a duplicate created by a client-side bug before idempotency was in place), **not** for real customer cancellations, which must go through `POST .../cancel` to preserve the audit trail (DATABASE_DESIGN.md 1.6 — `Appointment` is soft-deletable specifically so this distinction is meaningful: `DELETE` sets `deletedAt`, `POST .../cancel` sets `status = CANCELLED` and leaves the row fully visible with its history intact).
**Auth:** Required. **Authorization:** `OWNER` only (deliberately more restrictive than other write operations on this resource, given its potential for audit-trail-relevant misuse).
**Path Params:** `id`.
**Success — 200 OK:** `{ "success": true, "data": {}, "message": "Appointment removed." }`
**Errors:** `403 FORBIDDEN`, `404 NOT_FOUND`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (soft-delete idempotent).

#### `POST /appointments/:id/cancel`
**Purpose:** Cancel a real, active appointment (FR-10) — the correct endpoint for both staff-initiated and (via `POST /ai/tools/cancel`, Section 12) customer-initiated-through-AI cancellations.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF` (scoped).
**Headers:** `Idempotency-Key` **required**.
**Path Params:** `id`. **Request Body:** `{ "reason": "Customer requested via phone." }` (`reason` optional but recommended; always required when called internally by `POST /ai/tools/cancel` so the AI's stated reason is captured).
**Validation Rules:** Appointment must currently be `PENDING` or `CONFIRMED` (cancelling an already-`CANCELLED`/`COMPLETED` appointment returns `409 INVALID_STATUS_TRANSITION`); if `startTime` is within `TenantSettings.cancellationNoticeHours` of `now()`, the cancellation is still **permitted** for a `MANAGER`/`OWNER` (staff override) but returns a `warnings` array in the response noting the late-cancellation policy breach for potential no-show-fee handling in a future phase (PROJECT_REQUIREMENTS.md Section 22, Q11 — cancellation-fee enforcement is explicitly out of scope for MVP, so this is surfaced as metadata only, never blocking).
**Success — 200 OK:** `{ "success": true, "data": AppointmentDTO, "message": "Appointment cancelled." }` — `status` becomes `CANCELLED`, `cancelledAt`/`cancellationReason` set, `AppointmentStatusHistory` row written (`action: CANCELLED`), any pending `AppointmentReminder` rows for this appointment transition to `status: CANCELLED` so they never fire (PRISMA_SCHEMA.md 7.1).
**Errors:** `403 FORBIDDEN`, `404 NOT_FOUND`, `409 INVALID_STATUS_TRANSITION`.
**Rate Limit:** Booking-Critical. **Idempotency:** **Required** — critically important here specifically, since a duplicate cancel call is harmless in effect but a duplicate *reschedule* or *book* call is not; required uniformly across all three for consistency and because the AI orchestration layer (Section 12) may legitimately retry any of the three after a timeout.

#### `POST /appointments/:id/reschedule`
**Purpose:** Move an appointment to a new time/employee (FR-9) — implemented as creating a **new** `Appointment` row linked via `rescheduledFromAppointmentId` and marking the original `RESCHEDULED`, per DATABASE_DESIGN.md Section 9.2's explicit "two linked rows, not an in-place mutation" design.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF` (scoped).
**Headers:** `Idempotency-Key` **required**.
**Path Params:** `id` (the appointment being rescheduled). **Request Body:** `{ "newStartTime": "2026-08-05T10:00:00Z", "newEmployeeId": "uuid | null" }` (`newEmployeeId` optional — omit to keep the same employee).
**Validation Rules:** same availability/eligibility checks as `POST /appointments`, evaluated against the **new** slot; same `cancellationNoticeHours` warning behavior as `POST .../cancel` applied to the **original** appointment's proximity to `now()`; original appointment must be `PENDING`/`CONFIRMED`.
**Success — 200 OK:** `{ "success": true, "data": { "originalAppointment": AppointmentDTO, "newAppointment": AppointmentDTO }, "message": "Appointment rescheduled." }` — original's `status` becomes `RESCHEDULED`, new row created with `rescheduledFromAppointmentId` set, both linked via `AppointmentStatusHistory` (`action: RESCHEDULED`) referencing each other in `newState`/`previousState` JSON.
**Errors:** `403 FORBIDDEN`, `404 NOT_FOUND`, `409 SLOT_NO_LONGER_AVAILABLE`, `409 INVALID_STATUS_TRANSITION`, `422 VALIDATION_ERROR`.
**Rate Limit:** Booking-Critical. **Idempotency:** **Required.**

#### `GET /appointments/availability`
**Purpose:** Compute bookable time slots for a given service (and optionally a specific employee) over a date range — the endpoint both the dashboard's "new booking" UI and (indirectly, via the internal availability-check tool call) the AI use, powering FR-11/the `Availability` module (SYSTEM_ARCHITECTURE.md Section 3.2).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF`.
**Query Params:** `serviceId` (required, uuid), `employeeId` (optional — omit to return slots across all eligible employees), `dateFrom` (required, ISO date), `dateTo` (required, ISO date, max 31-day range per call to bound computation cost).
**Success — 200 OK:** `{ "success": true, "data": AvailabilitySlotDTO[] }` — grouped implicitly by returning one entry per bookable `(employeeId, startTime)` pair; the frontend groups/renders as needed.
**Validation Rules:** `dateTo` must be ≥ `dateFrom` and within the 31-day cap; `serviceId` must belong to the caller's tenant.
**Errors:** `404 SERVICE_NOT_FOUND`, `422 VALIDATION_ERROR` (date-range cap exceeded).
**Rate Limit:** Standard-Authenticated (read-only, not Booking-Critical — this endpoint has no side effect, so the tighter write-path tier doesn't apply; it is, however, the single most latency-sensitive `GET` in the API given its role in the real-time AI conversation loop, SYSTEM_ARCHITECTURE.md 5.5). **Idempotency:** N/A (read-only).
**Example Request:** `GET /api/v1/appointments/availability?serviceId=uuid&dateFrom=2026-08-01&dateTo=2026-08-07`
**Example Response:** `{ "success": true, "data": [ { "employeeId": "uuid", "employeeName": "Ana Silva", "startTime": "2026-08-03T14:00:00Z", "endTime": "2026-08-03T14:45:00Z" }, ... ] }`

---

## 11. WhatsApp Endpoints

Tag: `WhatsApp`. Base paths: `/api/v1/webhooks`, `/api/v1/messages`, `/api/v1/conversations`.

#### `GET /webhooks/whatsapp` *(documented here as the canonical home of the "verify" handshake — see implementation note)*
**Purpose:** Meta's webhook-verification handshake (`hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`), performed once when the WhatsApp integration is first configured (FR-6, SYSTEM_ARCHITECTURE.md 6.9).
**Auth:** Public, verified via `hub.verify_token` matching a pre-shared secret configured at connection time (`WhatsAppAccount` setup, not a bearer token). **Authorization:** None (Meta-initiated only).
**Query Params:** `hub.mode`, `hub.verify_token`, `hub.challenge` (all set by Meta, per their protocol, not this platform's own convention — hence not following this document's usual `filter[]`/camelCase conventions).
**Success — 200 OK:** Raw text body echoing `hub.challenge` (Meta's protocol requires this exact non-enveloped response — the **only** endpoint in this entire API that does not use the standard success envelope from Section 2.2, since the caller is Meta's infrastructure, not this platform's own client).
**Errors:** `403` (plain, non-enveloped) if `hub.verify_token` doesn't match.
**Rate Limit:** Webhook-Ingestion. **Idempotency:** N/A (no side effect).
**Implementation note:** the request explicitly lists `GET /webhooks/verify` as a separate path from `POST /webhooks/whatsapp`; in Meta's actual protocol, both the verification `GET` and the event-delivery `POST` are sent to the **same registered callback URL**. This document therefore specifies `GET` and `POST` as two methods on the **same path**, `/webhooks/whatsapp`, and treats `/webhooks/verify` as a documented alias routed to the identical handler — implemented this way so the platform's Meta App Dashboard configuration only ever needs one registered URL, matching real-world WhatsApp Cloud API integration practice, while still satisfying both literal paths requested.

#### `POST /webhooks/whatsapp`
**Purpose:** Receive inbound WhatsApp events (messages, delivery/read receipts, account status changes) from Meta (SYSTEM_ARCHITECTURE.md 6.1–6.2).
**Auth:** Signature-verified (`X-Hub-Signature-256`), not bearer-token (Section 2.12). **Authorization:** None (trust is the signature).
**Headers:** `X-Hub-Signature-256` (required, verified before any processing).
**Request Body:** Meta's native webhook payload shape (not this platform's own convention — passed through and persisted verbatim to `WebhookEvent.payload`, PRISMA_SCHEMA.md 9).
**Success — 200 OK:** Empty body, returned immediately after signature verification and raw persistence, before async processing (Section 2.12) — **not** the standard envelope, since Meta only checks the HTTP status, never parses a response body.
**Errors:** `401` (plain) on signature-verification failure — payload still logged (Section 2.12).
**Rate Limit:** Webhook-Ingestion. **Idempotency:** Provider-event-ID-based (`whatsappMessageId`), not client-header-based (Section 2.13).

#### `POST /messages/send`
**Purpose:** Manually send a WhatsApp message to a customer — used by staff during a `HUMAN_HANDLING` conversation (FR-13 handoff) or to proactively message a customer outside the AI flow.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF` (scoped to conversations they're assigned to, or any `HUMAN_HANDLING`/`ESCALATED` conversation for `OWNER`/`MANAGER`).
**Headers:** `Idempotency-Key` **required** (a duplicate send is a real, customer-visible error, not a harmless retry).
**Request Body:** `{ "conversationId": "uuid", "content": "Hi Sofia, this is Ana from Bella Salon...", "mediaId": "uuid | null" }`
**Validation Rules:** `conversationId` must belong to caller's tenant; `content` required unless `mediaId` present (a media-only message is valid); message must use a Meta-approved session or template flow depending on the 24-hour customer-service-window state (SYSTEM_ARCHITECTURE.md 6.3) — sending free-text outside the window when no approved template applies returns `422 OUTSIDE_MESSAGING_WINDOW`.
**Success — 202 Accepted:** `{ "success": true, "data": MessageDTO, "message": "Message queued for delivery." }` — `202`, not `201`, because the message is enqueued for async outbound sending (SYSTEM_ARCHITECTURE.md 6.3/6.4) and delivery is not yet confirmed at response time; `MessageDTO.status` starts at `QUEUED`, updated asynchronously via delivery-receipt webhooks (visible on subsequent `GET /messages`).
**Errors:** `404 CONVERSATION_NOT_FOUND`, `422 OUTSIDE_MESSAGING_WINDOW`, `503 UPSTREAM_UNAVAILABLE` (WhatsApp Cloud API down).
**Rate Limit:** Standard-Authenticated. **Idempotency:** **Required.**

#### `GET /messages`
**Purpose:** Retrieve message history — powers the conversation-thread view (SYSTEM_ARCHITECTURE.md `Messages` module).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF` (scoped to conversations they can access, per `GET /conversations` scoping below).
**Query Params:** `filter[conversationId]` (**required** — this endpoint always operates within one conversation, never a tenant-wide message firehose, both for UX relevance and to keep the query within the `(conversationId, createdAt)` index's sweet spot, PRISMA_SCHEMA.md 8), `filter[direction]`, `filter[messageType]`; sortable: `createdAt` (default ascending, matching natural chat-reading order — note this is the one list endpoint in the API whose default sort is ascending rather than descending, called out explicitly since it deviates from every other endpoint's default); pagination: **cursor** (mandatory — Section 2.4.2 explicitly forbids offset pagination on this table).
**Success — 200 OK:** `{ "success": true, "data": MessageDTO[], "meta": { "pagination": {...cursor...} } }`
**Errors:** `400 CONVERSATION_ID_REQUIRED`, `403 FORBIDDEN`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `GET /conversations`
**Purpose:** List conversation threads — powers the human-handoff queue and general inbox view (FR-13).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF`.
**Query Params:** `filter[status][in]` (the handoff-queue view uses `filter[status][in]=ESCALATED,HUMAN_HANDLING`), `filter[assignedUserId]`, `filter[customerId]`; sortable: `lastMessageAt` (default `-lastMessageAt`); pagination: cursor.
**Success — 200 OK:** `{ "success": true, "data": ConversationDTO[], "meta": { "pagination": {...cursor...} } }`
**Errors:** `403 FORBIDDEN`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `GET /conversations/:id`
**Purpose:** Retrieve a single conversation's detail (status, assignment, customer summary) — message history is fetched separately via `GET /messages?filter[conversationId]=:id`, keeping the two concerns (conversation metadata vs. potentially-large message history) independently cacheable/paginated.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`, `STAFF`.
**Path Params:** `id`.
**Success — 200 OK:** `{ "success": true, "data": ConversationDTO }`
**Errors:** `404 NOT_FOUND`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

---

## 12. AI Endpoints

Tag: `AI`. Base path: `/api/v1/ai`.

**Architectural note (read before the endpoints below):** SYSTEM_ARCHITECTURE.md Section 5.3 designs tool execution as **in-process module calls** within the modular monolith (the `AI` module calling `Appointments`/`Availability`/`Services` module services directly) — not real network hops. This section exposes `POST /ai/tools/*` as genuine HTTP endpoints anyway, per this phase's explicit request, for three deliberate reasons: (1) it gives the AI-orchestration loop a **testable, replayable interface** independent of whichever in-process wiring the implementation ultimately uses — a QA engineer or an automated eval suite can call these directly to verify tool behavior without simulating a full WhatsApp round-trip; (2) it preserves the **future-extraction option** flagged in SYSTEM_ARCHITECTURE.md Section 2.2/11.8 — if AI/conversation processing is ever split into its own service, these endpoints are already the correct seam; (3) it gives **observability/audit tooling** a clean, logged HTTP boundary to inspect every tool invocation. **These four `/ai/tools/*` endpoints and `POST /ai/chat` when invoked by the webhook pipeline are not part of the frontend team's contract** — the Angular app never calls them directly (with the one exception noted on `POST /ai/chat` below) — they are documented here for completeness and for the backend team's own internal-service contract clarity.

#### `POST /ai/chat`
**Purpose:** Send a customer message into a conversation and receive the AI's reply — the endpoint the WhatsApp inbound-processing worker calls after persisting a message (SYSTEM_ARCHITECTURE.md 6.2), **and** the endpoint a dashboard "Test my AI" sandbox feature calls (PROJECT_REQUIREMENTS.md 14.1, onboarding step 8) so an Owner can validate AI behavior without sending a real WhatsApp message.
**Auth:** Dual-mode — **internal service credential** (webhook-pipeline-triggered calls) **or** **Bearer JWT** (`OWNER`/`MANAGER` dashboard-test calls, tagged `channel: "dashboard_test"` so responses are never actually delivered over WhatsApp or persisted into a real customer's conversation history). **Authorization:** Internal service, or `OWNER`/`MANAGER` for the dashboard-test mode.
**Request Body:** `{ "conversationId": "uuid | null", "customerPhoneNumber": "+55... (required if conversationId omitted)", "message": "Do you have anything free Saturday for a haircut?", "channel": "whatsapp" | "dashboard_test" }`
**Validation Rules:** exactly one of `conversationId` / `customerPhoneNumber` provided; `message` required, 1–4096 chars.
**Success — 200 OK:** `{ "success": true, "data": { "conversationId": "uuid", "messageId": "uuid", "replyText": "We have a slot with Ana at 2pm...", "toolCallsExecuted": [ { "tool": "checkAvailability", "result": "..." } ], "promptVersion": "v7" } }`
**Errors:** `403 PLAN_MESSAGE_LIMIT_EXCEEDED` (FR-22, monthly usage cap reached), `503 UPSTREAM_UNAVAILABLE` (OpenAI outage — triggers the SYSTEM_ARCHITECTURE.md 5.10 fallback message path instead of surfacing this error to the end customer; the fallback text is what's returned as `replyText` in that case, with `promptVersion: null` and an internal `degraded: true` flag in `meta`, not a hard failure to the caller).
**Rate Limit:** AI-Conversational. **Idempotency:** Not required for `dashboard_test` calls; the webhook pipeline's own call is naturally deduplicated upstream by `Message.whatsappMessageId` idempotency (Section 2.13) before this endpoint is ever invoked twice for the same inbound message.

#### `POST /ai/tools/book`
**Purpose:** Internal tool-execution endpoint the AI orchestration layer calls when OpenAI's tool-calling response resolves to a booking decision (SYSTEM_ARCHITECTURE.md 5.3) — shares the exact same validation and conflict-prevention logic as `POST /appointments` (Section 10), with `createdByType: AI` (or `CUSTOMER`, per DATABASE_DESIGN.md 8.1's actor-type distinction when the AI is merely executing an explicit customer instruction) recorded on the resulting `Appointment`/`AppointmentStatusHistory` rows instead of `USER`.
**Auth:** Internal service credential only. **Authorization:** N/A (not user-role-based).
**Headers:** `Idempotency-Key` **required**.
**Request Body:** Same shape as `POST /appointments`, plus `{ "conversationId": "uuid", "actorType": "AI" | "CUSTOMER" }`.
**Success — 201 Created:** Same shape as `POST /appointments`.
**Errors:** Same as `POST /appointments`, plus `422 GUARDRAIL_REJECTED` (SYSTEM_ARCHITECTURE.md 5.9 — server-side re-validation of the tool-call arguments against real tenant data failed, e.g., a hallucinated `serviceId` that doesn't exist; returned to the AI orchestration layer as a structured failure it relays to the customer gracefully, per SYSTEM_ARCHITECTURE.md 5.10, never as a raw error).
**Rate Limit:** Not separately limited (internal-service-to-service call; the outer `POST /ai/chat` call is what's rate-limited from the outside). **Idempotency:** **Required.**

#### `POST /ai/tools/reschedule`
**Purpose:** Internal tool-execution endpoint mirroring `POST /appointments/:id/reschedule` (Section 10), with AI/customer actor attribution.
**Auth:** Internal service credential only.
**Headers:** `Idempotency-Key` **required**.
**Request Body:** `{ "appointmentId": "uuid", "newStartTime": "...", "newEmployeeId": "uuid | null", "conversationId": "uuid", "actorType": "AI" | "CUSTOMER" }`
**Success — 200 OK:** Same shape as `POST /appointments/:id/reschedule`.
**Errors:** Same as `POST /appointments/:id/reschedule`, plus `422 GUARDRAIL_REJECTED`.
**Rate Limit:** Not separately limited (internal). **Idempotency:** **Required.**

#### `POST /ai/tools/cancel`
**Purpose:** Internal tool-execution endpoint mirroring `POST /appointments/:id/cancel` (Section 10).
**Auth:** Internal service credential only.
**Headers:** `Idempotency-Key` **required**.
**Request Body:** `{ "appointmentId": "uuid", "reason": "Customer requested via WhatsApp.", "conversationId": "uuid", "actorType": "AI" | "CUSTOMER" }`
**Success — 200 OK:** Same shape as `POST /appointments/:id/cancel`.
**Errors:** Same as `POST /appointments/:id/cancel`, plus `422 GUARDRAIL_REJECTED`.
**Rate Limit:** Not separately limited (internal). **Idempotency:** **Required.**

#### `POST /ai/tools/faq`
**Purpose:** Internal, read-only tool endpoint answering a customer FAQ grounded in `TenantSettings`/`Service` catalog data (FR-7) — the one tool endpoint with no side effect, included for symmetry and observability with the other tools rather than being implemented as a plain internal function call.
**Auth:** Internal service credential only.
**Request Body:** `{ "question": "What are your hours on Sunday?", "conversationId": "uuid" }`
**Success — 200 OK:** `{ "success": true, "data": { "answer": "We're open Sundays 10am–4pm.", "groundedOn": ["TenantSettings.businessHours"] } }`
**Errors:** `422 GUARDRAIL_REJECTED` (the rare case where no grounded answer exists — the tool must not fabricate one, per SYSTEM_ARCHITECTURE.md 5.9, and instead signals the orchestration layer to escalate or offer a generic "let me check with the team" fallback).
**Rate Limit:** Not separately limited (internal). **Idempotency:** Not required (read-only, no side effect).

---

## 13. Billing Endpoints

Tag: `Billing`. Base paths: `/api/v1/plans`, `/api/v1/subscriptions`, `/api/v1/invoices`, `/api/v1/stripe`.

#### `GET /plans`
**Purpose:** List available subscription tiers — powers the public pricing page and the in-app "change plan" screen (FR-20).
**Auth:** Public (no account needed to view pricing). **Authorization:** None.
**Query Params:** `filter[isActive]` (defaults to `true` — retired plans, PRISMA_SCHEMA.md 10.1, are hidden by default but retrievable by an authenticated `OWNER` reviewing their own legacy plan via `filter[isActive]=false` if still subscribed to one no longer sold).
**Success — 200 OK:** `{ "success": true, "data": PlanDTO[] }` — no pagination (small, static resource, Section 2.4.2).
**Errors:** None beyond the global set.
**Rate Limit:** Standard-Authenticated tier limit applied per-IP for unauthenticated callers (a public endpoint still needs abuse protection). **Idempotency:** N/A.

#### `POST /subscriptions`
**Purpose:** Create or change the tenant's subscription (initiate a Stripe Checkout session for a new paid plan, or switch plans, FR-20/FR-24).
**Auth:** Required. **Authorization:** `OWNER` only (PROJECT_REQUIREMENTS.md Business Rule 8 — only the Owner manages billing).
**Headers:** `Idempotency-Key` **required** (a duplicate call must never create two Stripe subscriptions or double-charge).
**Request Body:** `{ "planId": "uuid", "couponCode": "string | null" }`
**Validation Rules:** `planId` must reference an active `Plan`; `couponCode` if present must resolve to a valid, non-expired, non-exhausted `Coupon`.
**Success — 200 OK:** `{ "success": true, "data": { "subscription": SubscriptionDTO, "checkoutUrl": "https://checkout.stripe.com/..." } }` — `checkoutUrl` is present when a new payment method is required (first paid conversion from trial); absent (`null`) when switching between two already-payment-method-attached plans, in which case the change applies immediately and `subscription.status` reflects it directly.
**Errors:** `404 PLAN_NOT_FOUND`, `422 INVALID_COUPON`, `409 SUBSCRIPTION_ALREADY_ACTIVE_ON_PLAN`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** **Required.**

#### `GET /subscriptions`
**Purpose:** Retrieve the tenant's current subscription state (billed as a collection endpoint per REST convention/the requested endpoint list, but semantically returns the single active `Subscription` — PRISMA_SCHEMA.md Section 0 consolidation note — since a tenant has exactly one).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Success — 200 OK:** `{ "success": true, "data": SubscriptionDTO }` (a single object, not an array, despite the plural path — documented explicitly here since it's the one deliberate exception to this API's usual collection-returns-array convention).
**Errors:** `404 NO_SUBSCRIPTION` (should not occur in practice — every tenant gets a `TRIALING` subscription at registration, PRISMA_SCHEMA.md 4.1's `Tenant` creation flow — but documented defensively).
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `POST /stripe/webhook`
**Purpose:** Receive Stripe billing events (payment succeeded/failed, subscription updated/cancelled — FR-25, SYSTEM_ARCHITECTURE.md `Billing` module).
**Auth:** Signature-verified (`Stripe-Signature` header), not bearer-token (Section 2.12). **Authorization:** None (trust is the signature).
**Headers:** `Stripe-Signature` (required).
**Request Body:** Stripe's native event payload (persisted verbatim to `WebhookLog.payload`, PRISMA_SCHEMA.md 10).
**Success — 200 OK:** Empty body, returned immediately after signature verification and raw persistence (Section 2.12) — not the standard envelope, for the same reason as `POST /webhooks/whatsapp`.
**Errors:** `401` (plain) on signature-verification failure.
**Rate Limit:** Webhook-Ingestion. **Idempotency:** Provider-event-ID-based (Stripe's own event ID, `(provider, providerEventId)` unique constraint, PRISMA_SCHEMA.md 10.1).

#### `GET /invoices`
**Purpose:** List billing history (FR-23).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Query Params:** `filter[status][in]`; sortable: `issuedAt` (default `-issuedAt`); pagination: offset (bounded — one invoice per billing cycle, DATABASE_DESIGN.md 3.8.3 row-growth note).
**Success — 200 OK:** `{ "success": true, "data": InvoiceDTO[], "meta": { "pagination": {...} } }`
**Errors:** `403 FORBIDDEN`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

---

## 14. Notifications Endpoints

Tag: `Notifications`. Base path: `/api/v1/notifications`. Scoped to the caller's own notifications (`recipientUserId = caller.id`), never another user's — even `OWNER` cannot read a `STAFF` member's notification inbox via this endpoint.

#### `GET /notifications`
**Purpose:** List the caller's own in-app/email notification log entries (e.g., invite accepted, payment failed alerts surfaced in-app).
**Auth:** Required. **Authorization:** Any authenticated role, self-scoped.
**Query Params:** `filter[status]`, `filter[type]`, `filter[unreadOnly]=true`; sortable: `createdAt` (default `-createdAt`); pagination: cursor.
**Success — 200 OK:** `{ "success": true, "data": NotificationDTO[], "meta": { "pagination": {...cursor...}, "unreadCount": 3 } }`
**Errors:** None beyond global set.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `PATCH /notifications/:id/read`
**Purpose:** Mark a notification as read.
**Auth:** Required. **Authorization:** Any authenticated role, self-scoped only (`404`, not `403`, if `:id` belongs to another user — deliberately not revealing that a notification with that ID exists for someone else, Section 2.3.1's rationale applied at the per-user level too, not only cross-tenant).
**Path Params:** `id`. **Request Body:** None.
**Success — 200 OK:** `{ "success": true, "data": NotificationDTO }`
**Errors:** `404 NOT_FOUND`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Not required (marking an already-read notification read again is a safe no-op).

---

## 15. Dashboard Endpoints

Tag: `Dashboard`. Base paths: `/api/v1/dashboard`, `/api/v1/analytics`, `/api/v1/reports`. All three are **read-only, composed/aggregate** endpoints per SYSTEM_ARCHITECTURE.md's `Dashboard` module (Section 3.2) — none owns primary data; each composes from `Appointments`, `Conversations`, `Customers`, `Billing`.

#### `GET /dashboard`
**Purpose:** Today's/this-week's operational snapshot — upcoming appointments, handoff queue count, quick KPIs (PROJECT_REQUIREMENTS.md 14.5).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER` (full view); `STAFF` (a reduced view scoped to their own upcoming appointments and any conversation assigned to them — enforced server-side by branching on role, not a client-side filter).
**Query Params:** `date` (optional, ISO date, defaults to today in the tenant's `timezone`).
**Success — 200 OK:** `{ "success": true, "data": { "upcomingAppointments": AppointmentDTO[], "handoffQueueCount": 2, "todayBookedCount": 14, "todayRevenueCents": 112000 } }` — `STAFF` callers receive the same shape with counts/lists scoped to their own data only.
**Errors:** None beyond global set.
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `GET /analytics`
**Purpose:** Trend-oriented metrics over a date range (booking volume, no-show rate, AI handoff rate, conversation-to-booking conversion — PROJECT_REQUIREMENTS.md Section 18 Success Metrics, tenant-scoped subset).
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER` only (not `STAFF` — this is business-performance data, not operational task data).
**Query Params:** `dateFrom`, `dateTo` (both required, max 12-month range), `granularity` (`day` | `week` | `month`, default `day`).
**Success — 200 OK:** `{ "success": true, "data": { "bookingVolume": [{ "date": "2026-08-01", "count": 12 }], "noShowRate": 0.04, "aiHandoffRate": 0.11, "aiBookingCompletionRate": 0.78 } }`
**Errors:** `422 VALIDATION_ERROR` (range cap exceeded).
**Rate Limit:** Standard-Authenticated. **Idempotency:** N/A.

#### `GET /reports`
**Purpose:** Generate a downloadable, point-in-time export (e.g., a revenue or appointment-history report) — the one `Dashboard`-group endpoint with a real, non-trivial background operation rather than a fast synchronous aggregate query.
**Auth:** Required. **Authorization:** `OWNER`, `MANAGER`.
**Query Params:** `type` (`revenue` | `appointments` | `customers`, required), `dateFrom`, `dateTo`, `format` (`csv` | `pdf`, default `csv`).
**Success — 202 Accepted:** `{ "success": true, "data": { "reportJobId": "uuid", "status": "PROCESSING" }, "message": "Your report is being generated." }` — `202` because report generation is queued as a background job (SYSTEM_ARCHITECTURE.md 11.5), not computed synchronously; the resulting file is delivered via a `Notification` (Section 14) containing a pre-signed `File` download URl once ready, rather than this endpoint itself returning the file — an intentionally async pattern to keep this endpoint's response time bounded regardless of report size.
**Errors:** `422 VALIDATION_ERROR`.
**Rate Limit:** Standard-Authenticated. **Idempotency:** Recommended (optional) — a duplicate report request is wasteful but not harmful (produces two identical downloadable files, cleaned up by the standard `File` retention policy, DATABASE_DESIGN.md 9.6).

---

## 16. Admin Endpoints

Tag: `Admin`. Base path: `/api/v1/admin`. **`SUPER_ADMIN` only, on every endpoint in this section, with no exception** — the one part of the API that is not tenant-scoped by JWT claim (SYSTEM_ARCHITECTURE.md 8.4), and therefore the part of the contract the frontend's `admin` feature module (SYSTEM_ARCHITECTURE.md 4.5) exclusively talks to.

#### `GET /admin/users`
**Purpose:** Cross-tenant user search/listing — support and account-management tooling (SYSTEM_ARCHITECTURE.md `Admin` module).
**Auth:** Required. **Authorization:** `SUPER_ADMIN`.
**Query Params:** `filter[tenantId]`, `filter[email]`, `filter[isActive]`; sortable: `createdAt`, `lastLoginAt` (default `-createdAt`); pagination: offset; `q` searches `email`/`firstName`/`lastName` platform-wide.
**Success — 200 OK:** `{ "success": true, "data": (UserDTO & { tenantName: string })[], "meta": { "pagination": {...} } }` — the `tenantName` extension field exists only in this admin-scoped response shape, never in the tenant-scoped `GET /users` response, since a tenant's own staff never need to see "which tenant" a user belongs to (they already know).
**Errors:** `403 FORBIDDEN` (non-Super-Admin caller).
**Rate Limit:** Admin. **Idempotency:** N/A.

#### `GET /admin/tenants`
**Purpose:** Cross-tenant tenant listing — the primary Super Admin support/oversight screen (FR-26).
**Auth:** Required. **Authorization:** `SUPER_ADMIN`.
**Query Params:** `filter[status][in]`, `filter[planId]`; sortable: `createdAt`, `name` (default `-createdAt`); pagination: offset; `q` searches `name`/`slug`.
**Success — 200 OK:** `{ "success": true, "data": (TenantDTO & { subscriptionStatus: SubscriptionStatus, staffCount: integer })[], "meta": { "pagination": {...} } }`
**Errors:** `403 FORBIDDEN`.
**Rate Limit:** Admin. **Idempotency:** N/A.

#### `GET /admin/system`
**Purpose:** Platform-wide health/usage snapshot — AI/WhatsApp usage volume, error rates, background-job queue depth (FR-27, SYSTEM_ARCHITECTURE.md 10.8).
**Auth:** Required. **Authorization:** `SUPER_ADMIN`.
**Query Params:** None (a live snapshot, not a filtered list).
**Success — 200 OK:** `{ "success": true, "data": { "activeTenants": 340, "messagesLast24h": 12400, "aiErrorRateLast24h": 0.008, "queueDepths": { "whatsappInbound": 3, "whatsappOutbound": 1, "reminders": 0 }, "openAiStatus": "operational", "whatsappStatus": "operational", "stripeStatus": "operational" } }`
**Errors:** None beyond global set.
**Rate Limit:** Admin. **Idempotency:** N/A.

---

## 17. OpenAPI 3.1 Mapping Notes

This document is organized to translate mechanically into a physical `openapi.yaml` in the next implementation phase, without redesign:

| This Document | OpenAPI 3.1 Construct |
|---|---|
| Section 3 (Shared Schemas) | `components.schemas.*` |
| Section 2.3.1 (Error Catalog) | `components.responses.*` (one reusable response object per error code, referenced via `$ref` from every operation's `responses`) |
| Section 2.14 (Auth Model) | `components.securitySchemes.bearerAuth` (`type: http, scheme: bearer, bearerFormat: JWT`) and `components.securitySchemes.internalServiceAuth` (`type: apiKey`) |
| Each domain section (4–16) heading | An OpenAPI `tag` |
| Each `#### METHOD /path` entry | A `paths.<path>.<method>` operation object; "Purpose" → `summary`/`description`; "Path/Query Params" → `parameters`; "Request Body" → `requestBody.content.application/json.schema` (referencing Section 3 schemas); "Success Response" → `responses.<code>.content.application/json.schema`; "Possible Errors" → additional `responses` entries `$ref`-ing Section 2.3.1's reusable responses; "Authorization Required" → an `x-required-roles` vendor extension (OpenAPI has no native RBAC-role field; this project-specific extension keeps the machine-readable contract complete) |
| Section 2.10 (Rate-Limit Tiers) | `x-rate-limit-tier` vendor extension per operation, resolved against a documented tier table maintained alongside the spec |

The `Idempotency-Key` header (Section 2.13) is modeled as a `components.parameters.IdempotencyKey` header parameter, included in the `parameters` array only of the specific operations flagged "Required" above — never globally, so the generated client SDK only prompts for it where it's actually meaningful.

---

## 18. Deliverables & Known Gaps

### 18.1 Endpoint Coverage Summary

65 endpoints across 13 domains, exactly matching the requested list: Authentication (9), Users (5), Tenant (4), Employees (5), Services (5), Customers (5), Appointments (8), WhatsApp (6), AI (5), Billing (5), Notifications (2), Dashboard (3), Admin (3).

### 18.2 Gaps Identified During This Design (Flagged, Not Silently Filled)

These surfaced while designing the endpoints above and are called out explicitly rather than quietly resolved, since they affect scope the requesting stakeholder should confirm before implementation:

1. **File upload.** `TenantDTO.logoUrl`, `Invoice.invoicePdfUrl`, and WhatsApp media all depend on a `File`/`Media` upload mechanism (PRISMA_SCHEMA.md Section 12), but no `POST /files` (pre-signed-URL issuance) endpoint was in the requested list. Needed before `PATCH /tenant`'s `logoFileId` field is usable end-to-end.
2. **`ServiceCategory` CRUD.** `Service.categoryId` is settable, but no dedicated endpoint to create/list/manage categories themselves was requested — likely an oversight worth closing, since a Salon Owner needs some way to create a category before assigning services to it.
3. **`TenantInvitation` acceptance.** `POST /users` creates an invitation (Section 5), but no endpoint for the invitee to *accept* it (typically `POST /auth/accept-invitation` or folded into `POST /auth/register`'s flow when an invitation token is present) was explicitly requested — required to close the staff-onboarding loop from PROJECT_REQUIREMENTS.md Section 14.1.
4. **`AppointmentFeedback` submission.** PRISMA_SCHEMA.md Section 7 models post-visit feedback, but no endpoint to submit it was requested (likely delivered via a WhatsApp-conversational flow rather than a REST call from the customer, who has no account — worth confirming this is AI-tool-mediated only, with no dashboard-facing submission endpoint needed).
5. **Customer merge.** Flagged in Section 9's `PATCH /customers/:id` note — no endpoint exists to merge two customer records that turn out to be the same person under two phone numbers; not urgent for MVP but worth roadmapping.

None of these gaps block approval of the 65 requested endpoints; they are recorded here so they are deliberately scoped into or out of the next phase, not discovered as a surprise mid-implementation.

### 18.3 Key Decisions Requiring Sign-Off

1. **Cursor-based pagination is the default and required strategy**, with offset pagination available only on a named allow-list of small/bounded/admin lists (Section 2.4) — `Messages`, `Conversations`, and `Appointments` must never gain offset pagination in the future.
2. **The four `/ai/tools/*` endpoints plus internal-mode `/ai/chat` are backend-internal, not part of the Angular frontend's contract** (Section 12) — authenticated via a service credential, not user JWT; this should be explicitly communicated to the frontend team so no one builds against them by mistake.
3. **`DELETE /appointments/:id` performs a hard-view-removal (soft-delete) reserved for data-entry corrections; `POST /appointments/:id/cancel` is the only correct endpoint for real cancellations** (Section 10) — a distinction with real audit-trail consequences that both frontend and backend teams must build against consistently.
4. **`Idempotency-Key` is required on exactly eight endpoints** (Section 2.13) — appointment create/cancel/reschedule (both user-facing and AI-internal variants), message send, and subscription create — not applied blanket-wide, to avoid needless client-side complexity on endpoints where it adds no safety value.

**Recommended next step:** Proceed to **Frontend Architecture** — Angular feature-module breakdown, routing table, state-management (signal store) design per feature, and API-layer service mapping onto this document's 65 endpoints — once this document is approved.

**Awaiting your approval before proceeding.**

