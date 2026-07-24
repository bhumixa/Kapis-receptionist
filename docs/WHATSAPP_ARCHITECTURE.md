# WHATSAPP_ARCHITECTURE.md

## WhatsApp Cloud API Integration — Implementation Reference (Milestone 7)

Decision record: [docs/adr/ADR-010-whatsapp-platform.md](adr/ADR-010-whatsapp-platform.md). Companion doc for the conversation/message domain and frontend inbox: [docs/MESSAGING_ARCHITECTURE.md](MESSAGING_ARCHITECTURE.md).

This document covers the *transport layer*: connecting a tenant's WhatsApp Business number, verifying and ingesting Meta's webhooks, the background job queues, and the security mechanisms (signature verification, access-token encryption). What happens to a message once it's inside the platform (conversations, the inbox UI) is MESSAGING_ARCHITECTURE.md's scope.

---

## 1. What Exists Now

- `WhatsAppAccount` connect/disconnect flow (`POST/GET/DELETE /whatsapp/account`), credential-verified against Meta before being persisted as `CONNECTED`.
- `GET/POST /webhooks/whatsapp` — Meta's one-time verification handshake and the ongoing inbound event receiver, signature-verified via `X-Hub-Signature-256`.
- A global, append-only `WebhookEvent` ingestion log, written before any processing.
- Two BullMQ queues (`whatsapp-inbound`, `whatsapp-outbound`) with exponential-backoff retry.
- AES-256-GCM encryption at rest for the tenant's WhatsApp access token.
- Outbound text-message sending via the Cloud API's `/messages` endpoint, with retry classification (transient vs. permanent failure).

Not built: `TemplateMessage` registry, actual media file download/S3 storage, AI/conversation-summary features, billing. See ADR-010 and §8 below for the full deferral list.

---

## 2. Data Model

### `WhatsAppAccount` (1:1 with `Tenant`)

```
id, tenantId (unique), phoneNumber, whatsappPhoneNumberId (unique — the
webhook tenant-resolution key), whatsappBusinessAccountId,
accessTokenEncrypted (AES-256-GCM, see §5), connectionStatus
(PENDING/CONNECTED/DISCONNECTED/ERROR), connectedAt, disconnectedAt,
lastHealthCheckAt, createdAt, updatedAt
```

### `WebhookEvent` (global, not tenant-owned at write time)

```
id, tenantId (nullable — resolved asynchronously), whatsappMessageId
(nullable), eventType, payload (Json, the raw Meta payload),
signatureValid (Boolean), processingStatus
(PENDING/PROCESSED/FAILED/IGNORED), processedAt, errorMessage, createdAt
```

Written synchronously by `WebhookIngestionService.ingest()` — before enqueueing, before any business logic, and regardless of whether the signature check passed. A `signatureValid: false` row is forensic evidence, not noise; nothing with an invalid signature is ever processed.

See [DATABASE_DESIGN.md](DATABASE_DESIGN.md) and [PRISMA_SCHEMA.md](PRISMA_SCHEMA.md) for `Conversation`/`Message` (owned by the messaging domain, documented in MESSAGING_ARCHITECTURE.md).

---

## 3. Webhook Verification Handshake

`GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...` — a one-time setup call from Meta's App Dashboard when the webhook URL is registered. `WebhookIngestionService.handleVerification` checks `mode === 'subscribe'` and `token === WHATSAPP_VERIFY_TOKEN`; on match, echoes `hub.challenge` back as **raw text** (not the JSON success envelope — this is the one endpoint in the whole API that breaks that convention, alongside the inbound receiver below). A mismatch throws `InvalidVerifyTokenException` (`401 INVALID_VERIFY_TOKEN`).

---

## 4. Inbound Webhook Flow

```
Meta → POST /webhooks/whatsapp
  → verifyWhatsAppSignature(appSecret, rawBody, X-Hub-Signature-256)
  → WebhookEvent row persisted (signatureValid: true/false)
  → if invalid: 401, no further processing
  → if valid: enqueue { webhookEventId } onto `whatsapp-inbound`, return 200 immediately
  → (async, BullMQ worker) InboundMessageProcessorService.process(webhookEventId):
      → load WebhookEvent, parse entry[].changes[].value
      → resolve WhatsAppAccount via metadata.phone_number_id → tenantId
      → for each inbound message:
          → Redis dedup check (dedup:whatsapp:{whatsappMessageId}, SET NX, 48h TTL)
          → DB dedup backstop (findByWhatsappMessageId)
          → CustomerService.findOrCreateByPhoneForTenant (contact sync,
            using the WhatsApp profile display name as a firstName
            fallback on first contact only)
          → ConversationsService.findOrCreateOpenConversation
          → Message row created (INBOUND, senderType=CUSTOMER)
          → Conversation.lastMessageAt / lastInboundMessageAt updated
      → for each status update (statuses[]): Message.status updated by whatsappMessageId
      → WebhookEvent marked PROCESSED (or FAILED, with errorMessage, and rethrown so BullMQ retries)
```

**Signature verification** (`infrastructure/whatsapp-signature.util.ts`): HMAC-SHA256 of the *raw* request body (hence `rawBody: true` in `main.ts` — re-serializing the parsed JSON would not reliably reproduce Meta's exact byte sequence), keyed by `WHATSAPP_APP_SECRET`, compared via `timingSafeEqual`. A pure function, unit-tested directly against synthetic payloads (missing header, wrong secret, tampered body, wrong-length signature).

**Tenant resolution is the one deliberate exception to `TenantContextService`** being the sole resolver in this codebase (ADR-010) — a webhook carries no JWT, so tenant comes from `WhatsAppAccount.whatsappPhoneNumberId`, resolved inside the async worker, not at the HTTP boundary. An unresolvable `phone_number_id` (no matching account) causes that change to be dropped with a warning log; the `WebhookEvent` is still marked `PROCESSED` (the webhook itself was handled, even though no tenant claimed it) rather than `FAILED`.

**Media**: inbound media messages (`image`/`video`/`audio`/`document`/`sticker`) carry their metadata (`id`, `mime_type`, `sha256`, `filename` where applicable) directly in the webhook payload — no separate call to Meta's media-download endpoint is made this milestone. These are persisted as plain columns on `Message` (see MESSAGING_ARCHITECTURE.md §2).

---

## 5. Security

### Access-token encryption (`core/security/encryption.service.ts`)

AES-256-GCM. Ciphertext format is a single base64 string: `iv (12 bytes) || authTag (16 bytes) || ciphertext`. The key (`WHATSAPP_TOKEN_ENCRYPTION_KEY`, 32 bytes base64) is validated for length at `onModuleInit` — a malformed key fails at boot (`InvalidEncryptionKeyException`), not at the first encrypt/decrypt call. The plaintext token is decrypted only immediately before an outbound Cloud API call (`WhatsAppAccountService.getSendableAccount`) and never appears in any response DTO (`WhatsAppAccountResponseDto` has no token field at all).

This is the first *decryptable* secret this codebase stores — every other stored secret (`passwordHash`, `refreshTokenHash`, email-verification/password-reset `tokenHash`) is one-way hashed. `EncryptionService` is deliberately generic (not WhatsApp-specific), reusable by any future decryptable-secret need.

### Webhook signature verification

Covered in §4. Rejection is `401`, not `200`-with-silent-drop — an invalid signature is a real authentication failure, and Meta does not depend on receiving `200` for requests it didn't actually send.

### Environment variables

| Variable | Purpose |
|---|---|
| `WHATSAPP_APP_SECRET` | Signs/verifies Meta's `X-Hub-Signature-256` header. Per-Meta-App, shared across all tenants. |
| `WHATSAPP_VERIFY_TOKEN` | Shared secret for the one-time `GET` verification handshake. |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | AES-256-GCM key encrypting each tenant's access token at rest. `openssl rand -base64 32`. |
| `WHATSAPP_GRAPH_API_BASE_URL` | Defaults to `https://graph.facebook.com/v21.0`; overridable for API-version pinning or test doubles. |

All four validated at bootstrap (`env.validation.ts`), following the existing fail-fast convention for `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`.

---

## 6. Queues & Retry

First BullMQ consumer in this codebase (`src/queues/` was previously an empty, reserved placeholder). `queues/bullmq-root.module.ts` owns a dedicated `ioredis` connection (`maxRetriesPerRequest: null`, required by BullMQ) — distinct from the shared `RedisService` connection used for caching, `BookingLockService`, and the idempotency interceptor.

| Queue | Job | Retry |
|---|---|---|
| `whatsapp-inbound` | `process-webhook-event` — parses one `WebhookEvent`, persists messages/status updates | 5 attempts, exponential backoff (2s base) |
| `whatsapp-outbound` | `send-message` — sends one queued `Message` via the Cloud API | 5 attempts, exponential backoff (2s base) |

Outbound retry classification (`WhatsAppCloudApiError.isTransient`): 5xx/429 responses are rethrown and retried by BullMQ; 4xx responses are terminal — the message is marked `FAILED` immediately, audit-logged, and never retried. If a transient failure exhausts all 5 attempts, the outbound processor's `@OnWorkerEvent('failed')` handler marks the message `FAILED` so it doesn't sit `QUEUED` forever.

Both processors (`WhatsAppInboundProcessor`/`WhatsAppOutboundProcessor`) are thin adapters over `InboundMessageProcessorService`/`OutboundMessageService` respectively — the actual logic is unit-testable without a running queue.

---

## 7. Files

```
backend/src/core/security/
  encryption.service.ts, encryption.module.ts

backend/src/queues/
  bullmq-root.module.ts

backend/src/modules/whatsapp/
  domain/entities/{whatsapp-account,conversation,message,webhook-event}.entity.ts
  domain/ports/{whatsapp-account,conversation,message,webhook-event}-repository.port.ts
  application/{whatsapp-account,conversations,messages,webhook-ingestion,
    inbound-message-processor,outbound-message}.service.ts
  application/exceptions/whatsapp.exceptions.ts
  infrastructure/prisma-{whatsapp-account,conversation,message,webhook-event}.repository.ts
  infrastructure/whatsapp-cloud-api.client.ts
  infrastructure/whatsapp-signature.util.ts
  infrastructure/mappers/prisma-whatsapp.mappers.ts
  interface/{webhooks,whatsapp-account,conversations,messages}.controller.ts
  interface/dto/*.dto.ts
  interface/mappers/whatsapp-response.mapper.ts
  queues/{whatsapp-inbound,whatsapp-outbound}.processor.ts
  queues/whatsapp-queue.module.ts
  queues/whatsapp-queue.constants.ts
  whatsapp.module.ts
```

---

## 8. Deferred / Known Gaps (Not Forgotten)

- **`TemplateMessage` registry** — not built. Outbound replies past the 24-hour customer-service window are rejected (`422 OUTSIDE_MESSAGING_WINDOW`), not template-routed.
- **Media file download/S3 storage** — metadata only (`mediaWhatsappId`/`mediaMimeType`/`mediaSha256`/`mediaFilename`/`mediaSizeBytes`). The `Files`/S3 module remains unbuilt (carried forward from Milestone 5).
- **Real Meta App verification / live number cutover** — this milestone's code is verified against Meta's documented API contract and (for outbound/connect) against Meta's real API using intentionally-invalid test credentials (confirming correct error translation). Registering a public HTTPS webhook callback URL in Meta's App Dashboard for live inbound delivery is an operational step outside this codebase.
- **Per-tenant health checks** — `WhatsAppAccount.lastHealthCheckAt` exists in the schema but nothing populates it yet; a periodic health-check job is a natural future addition to `queues/`.
- **AI/conversation-summary hooks** — Milestone 8's territory entirely; nothing in this module assumes or blocks it.
