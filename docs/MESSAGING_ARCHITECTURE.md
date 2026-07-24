# MESSAGING_ARCHITECTURE.md

## Conversations, Messages & the Inbox — Implementation Reference (Milestone 7)

Decision record: [docs/adr/ADR-010-whatsapp-platform.md](adr/ADR-010-whatsapp-platform.md). Companion doc for the WhatsApp Cloud API transport layer (webhook verification, queues, encryption): [docs/WHATSAPP_ARCHITECTURE.md](WHATSAPP_ARCHITECTURE.md).

This document covers what happens to a message once it's inside the platform: the `Conversation`/`Message` domain model, contact synchronization, the manual-reply flow and its 24-hour-window rule, the REST surface, and the frontend inbox.

---

## 1. What Exists Now

- `Conversation`: one thread per (tenant, customer, WhatsApp account) — no forced one-open-conversation-per-customer constraint; "the current thread" is an application-layer query (most recent `OPEN` conversation), not a database uniqueness rule.
- `Message`: every inbound/outbound message, immutable except `status` (delivery tracking) and `failureReason`.
- Contact synchronization: an inbound message from an unknown phone number creates a `Customer` record automatically, using the WhatsApp profile display name as a one-time `firstName` fallback.
- `GET/PATCH /conversations[/:id]`, `GET /messages`, `POST /messages/send`.
- A two-pane frontend inbox (`/app/conversations[/:id]`): conversation list, message thread, contact panel, composer.

Not built: AI-driven auto-response, conversation escalation/hand-off states, `TemplateMessage`-backed outbound past the 24h window. See ADR-010.

---

## 2. Data Model

### `Conversation`

```
id, tenantId, customerId, whatsappAccountId, status (OPEN/RESOLVED/CLOSED),
assignedUserId (nullable), lastMessageAt (any direction — inbox sort order),
lastInboundMessageAt (inbound only — drives the 24h-window check),
resolvedAt, closedAt, createdAt, updatedAt
```

`customerId`/`whatsappAccountId` use the composite-FK cross-tenant pattern (`(tenantId, id)` compound unique + compound FK) established since Milestone 5 — the database itself rejects linking a customer or WhatsApp account belonging to a different tenant.

`ConversationStatus` is intentionally narrow: `OPEN`/`RESOLVED`/`CLOSED` only. No `ESCALATED`/`HUMAN_HANDLING` — those describe an AI hand-off to a human, and there's no AI auto-responder yet (Milestone 8). Every conversation this milestone defaults to `OPEN` and is monitored by staff directly.

### `Message`

```
id, tenantId, conversationId, direction (INBOUND/OUTBOUND),
senderType (ActorType: USER/SYSTEM/CUSTOMER — AI reserved for Milestone 8),
senderId (nullable, → User, when senderType=USER),
messageType (TEXT/IMAGE/AUDIO/VIDEO/DOCUMENT/STICKER/LOCATION/INTERACTIVE/UNSUPPORTED),
content (text body or caption), mediaWhatsappId/mediaMimeType/mediaSha256/
mediaFilename/mediaSizeBytes (metadata only, see WHATSAPP_ARCHITECTURE.md §4),
whatsappMessageId (partial-unique — the idempotency guard),
status (QUEUED/SENT/DELIVERED/READ/FAILED), failureReason,
sourceWebhookEventId (nullable, → WebhookEvent, traceability for inbound
messages), createdAt, updatedAt
```

`senderType` reuses the platform-wide `ActorType` enum rather than a bespoke `MessageSenderType` — see ADR-010's rationale.

---

## 3. Contact Synchronization

`CustomerService.findOrCreateByPhoneForTenant(tenantId, phoneNumber, whatsappProfileName?)` — a new public method on the existing (Milestone 6) `Customers` module, not a new module. Looks up by phone number within the tenant; if found, returns it unchanged (a WhatsApp profile name is a hint at *creation* time only, never an ongoing sync source — an existing customer's name is never silently overwritten by whatever their WhatsApp profile currently says). If not found, creates a new `Customer` with `firstName` set from the WhatsApp profile display name (or `null` if none given), with the same race-condition safety net (`P2002` re-check) `createCustomer` already has.

---

## 4. Manual Reply & the 24-Hour Window

`POST /messages/send` — staff manual reply. `MessagesService.sendMessage`:

1. Loads the target `Conversation` (`404` if not found/wrong tenant).
2. Checks `conversation.lastInboundMessageAt` — if null or more than 24 hours old, throws `OutsideMessagingWindowException` (`422 OUTSIDE_MESSAGING_WINDOW`). No `TemplateMessage` fallback exists this milestone (ADR-010); the reply is simply rejected, with the frontend composer proactively hiding itself and explaining why once the window has passed (see §5).
3. Creates a `Message` row (`OUTBOUND`, `senderType: USER`, `status: QUEUED`).
4. Enqueues a `send-message` job onto the `whatsapp-outbound` BullMQ queue (WHATSAPP_ARCHITECTURE.md §6) and returns immediately — `202 Accepted`, not `201`, since the send is asynchronous and not yet confirmed delivered.

`Idempotency-Key` is required (reusing the existing generic `IdempotencyInterceptor` from Milestone 6, not a bespoke mechanism) — a retried identical request replays the exact prior response rather than sending a second message.

---

## 5. Frontend Inbox

`/app/conversations[/:id]` (`ConversationsInboxPage`) — a single two-pane page component, not separate list/detail routes, since selecting a conversation is a within-page interaction:

- **Left pane**: conversation list (customer name/phone, status badge, last-message timestamp), fetched as a single generous-limit page (same "no cursor-pagination UI yet" precedent `CustomersApiService`/`AppointmentsApiService` established).
- **Center pane**: message thread (inbound left-aligned, outbound right-aligned with delivery-status label), a composer that hides itself with an explanatory note once the 24-hour window has closed (computed client-side from `lastInboundMessageAt`, mirroring the backend's own check — the backend remains the actual enforcement point regardless of what the UI shows).
- **Right pane**: contact panel (customer name/phone/email) and conversation status controls (mark resolved / close / reopen, calling `PATCH /conversations/:id`).

`ConversationsApiService` (`core/api/conversations-api.service.ts`) covers conversations, messages, and WhatsApp account connect/disconnect in one service, matching `AppointmentsApiService`'s precedent of one API service per feature domain rather than per-endpoint-group.

---

## 6. Endpoints Reference

| Method & Path | Auth | Notes |
|---|---|---|
| `GET /conversations` | STAFF | Cursor-paginated (`common/utils/cursor-pagination.util.ts`), `filter[status]` via comma-separated `status` query param, sorted by `lastMessageAt` descending by default. |
| `GET /conversations/:id` | STAFF | `404` (never `403`) for a cross-tenant or missing id. |
| `PATCH /conversations/:id` | STAFF | Body: `{ status }`. Requires `TenantActiveGuard` (mutating). |
| `GET /messages` | STAFF | `conversationId` query param **required** — never a tenant-wide firehose. Ascending `createdAt` (the one list endpoint whose natural order is oldest-first). |
| `POST /messages/send` | STAFF | `Idempotency-Key` required. `202 Accepted`. `422 OUTSIDE_MESSAGING_WINDOW` past 24h. Requires `TenantActiveGuard`. |
| `GET /whatsapp/account` | STAFF | Returns `null` if nothing connected (not `404`). |
| `POST /whatsapp/account` | OWNER/MANAGER, `whatsapp:manage` | Verifies credentials against Meta before persisting. `409 ACCOUNT_ALREADY_CONNECTED` / `409 PHONE_NUMBER_ID_ALREADY_IN_USE` / `400 INVALID_WHATSAPP_CREDENTIALS`. |
| `DELETE /whatsapp/account` | OWNER/MANAGER, `whatsapp:manage` | `400 ACCOUNT_NOT_CONNECTED` if nothing to disconnect. |

All conversation/message reads and replies are `STAFF`-broad — replying to a customer is normal front-desk work, the same authorization shape as `appointments`/`customers`. Only the account-level connect/disconnect action is gated behind `whatsapp:manage`.

---

## 7. Deferred / Known Gaps (Not Forgotten)

- **AI auto-response and hand-off** — Milestone 8. `ConversationStatus` has no escalation states yet (§2).
- **Live delivery-status polling in the UI** — `Message.status` updates server-side as Meta's delivery-receipt webhooks arrive, but the frontend does not currently poll/subscribe for live updates after a message is sent; a page refresh reflects the latest state. Real-time UI updates (WebSocket/SSE) are a future enhancement, not required by this milestone's brief.
- **`TemplateMessage` registry** — see WHATSAPP_ARCHITECTURE.md §8.
- **Conversation assignment UI** — `Conversation.assignedUserId` and `ConversationsService.assignUser` exist at the service layer; no frontend control surfaces it yet (not requested this pass).

## 8. Files

Backend: see WHATSAPP_ARCHITECTURE.md §7 (the `Conversation`/`Message`/contact-sync pieces live in the same `modules/whatsapp` tree; `CustomerService.findOrCreateByPhoneForTenant` is the one addition to `modules/customers`).

Frontend:
```
frontend/src/app/core/api/conversations-api.service.ts
frontend/src/app/shared/models/whatsapp.model.ts
frontend/src/app/features/conversations/pages/conversations-inbox-page/
  conversations-inbox-page.ts
  conversations-inbox-page.html
frontend/src/app/features/settings/pages/settings-page/  (WhatsApp connect section added)
```
