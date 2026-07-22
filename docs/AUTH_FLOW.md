# AUTH_FLOW.md

## Core Authentication — Sequence Diagrams

Companion to docs/AUTHENTICATION.md — that document explains *why* each decision was made; this one shows *what happens, in order* for each flow. All diagrams reflect the as-built implementation (Milestone 2, Core Authentication sprint).

---

## 1. Register

```mermaid
sequenceDiagram
    participant U as Browser (RegisterPage)
    participant A as AuthController
    participant S as AuthService
    participant P as PasswordService
    participant R as PrismaRegistrationRepository
    participant DB as Postgres

    U->>A: POST /auth/register {email, password, firstName, lastName, tenantName, timezone}
    A->>S: register(dto)
    S->>DB: findByEmail(email)
    alt email already taken
        DB-->>S: existing User
        S-->>A: 409 EMAIL_ALREADY_EXISTS
        A-->>U: 409
    else email available
        S->>P: hash(password)
        P-->>S: argon2id hash
        S->>R: registerTenantOwner({email, passwordHash, ...})
        R->>DB: BEGIN TRANSACTION
        R->>DB: INSERT Tenant (slug collision-safe retry)
        R->>DB: INSERT User (tenantId, passwordHash)
        R->>DB: INSERT UserRole (OWNER)
        R->>DB: COMMIT
        DB-->>R: {user, tenant}
        R-->>S: {user, tenant}
        S-->>A: {user, tenant}
        A-->>U: 201 {user, tenant} — no session issued
    end
    Note over U: Frontend redirects to /auth/login?registered=true
```

No `TenantSettings`/`Subscription` rows are created — those tables don't exist until Milestone 3/8 (ADR-002, ADR-003).

---

## 2. Login

```mermaid
sequenceDiagram
    participant U as Browser (LoginPage)
    participant A as AuthController
    participant S as AuthService
    participant P as PasswordService
    participant Sess as SessionService
    participant DB as Postgres

    U->>A: POST /auth/login {email, password}
    A->>S: login(dto, {ip, userAgent})
    S->>DB: findByEmail(email)
    alt no such user OR wrong password
        S-->>A: 401 INVALID_CREDENTIALS (identical response either way)
        A-->>U: 401
    else deactivated account
        S-->>A: 401 ACCOUNT_DEACTIVATED
        A-->>U: 401
    else valid credentials, active account
        S->>DB: updateLastLoginAt(user.id)
        S->>S: sign access token (JWT, 15m, HS256)
        S->>Sess: issueSession(user.id, meta)
        Sess->>DB: INSERT RefreshToken (opaque token, HMAC-hashed)
        Sess-->>S: rawRefreshToken
        S-->>A: {user, tenant, accessToken, expiresIn}
        A-->>U: 200 {user, tenant, accessToken, expiresIn} + Set-Cookie refresh_token (httpOnly, SameSite=Strict, Path=/api/v1/auth)
    end
    Note over U: AuthStateService.setSession(user, tenant, accessToken) — router navigates to /app/dashboard
```

---

## 3. Refresh (Rotation — Happy Path)

```mermaid
sequenceDiagram
    participant U as Browser (cookie sent automatically)
    participant A as AuthController
    participant Sess as SessionService
    participant DB as Postgres

    U->>A: POST /auth/refresh (Cookie: refresh_token=<old raw token>)
    A->>Sess: rotate(rawToken, meta)
    Sess->>DB: findByHash(HMAC(rawToken))
    DB-->>Sess: RefreshToken row (revokedAt = null, not expired)
    Sess->>DB: INSERT new RefreshToken (new raw token, new 30d expiry)
    Sess->>DB: UPDATE old row SET revokedAt = now(), replacedBySessionId = new.id
    Sess-->>A: {rawRefreshToken: new, userId}
    A->>A: sign new access token for userId
    A-->>U: 200 {accessToken, expiresIn} + Set-Cookie refresh_token=<new raw token>
```

---

## 4. Refresh Reuse Detection (Token Theft Response)

```mermaid
sequenceDiagram
    participant Attacker as Attacker (replays captured old token)
    participant Legit as Legitimate client (already rotated, has new token)
    participant A as AuthController
    participant Sess as SessionService
    participant DB as Postgres

    Note over Legit: Already completed a legitimate rotation (Section 3) at some earlier point.
    Attacker->>A: POST /auth/refresh (Cookie: refresh_token=<OLD, already-rotated raw token>)
    A->>Sess: rotate(oldRawToken, meta)
    Sess->>DB: findByHash(HMAC(oldRawToken))
    DB-->>Sess: RefreshToken row (revokedAt SET, replacedBySessionId SET)
    Note over Sess: replacedBySessionId being set (not just revokedAt)<br/>is what proves this is rotation-reuse, not a stale post-logout replay.
    Sess->>DB: UPDATE RefreshToken SET revokedAt = now()<br/>WHERE userId = ? AND revokedAt IS NULL (ALL active sessions)
    Sess->>Sess: SecurityEventService.record(REFRESH_TOKEN_REUSE_DETECTED)
    Sess-->>A: throw RefreshTokenReuseDetectedException
    A-->>Attacker: 401 REFRESH_TOKEN_REUSE_DETECTED
    Note over Legit: Legit client's own (rotated) session is ALSO now revoked<br/>by the mass-revocation above — an intentional, conservative<br/>trade-off: we cannot know which sessions are compromised,<br/>so all are killed and the user must log in again everywhere.
```

---

## 5. Logout (Single Device) — and Why It Does *Not* Trigger Reuse Detection

```mermaid
sequenceDiagram
    participant U as Browser
    participant A as AuthController
    participant Sess as SessionService
    participant DB as Postgres

    U->>A: POST /auth/logout (Authorization: Bearer <accessToken>, Cookie: refresh_token=<raw>)
    A->>Sess: revoke(rawToken)
    Sess->>DB: findByHash(HMAC(rawToken))
    DB-->>Sess: RefreshToken row (active)
    Sess->>DB: UPDATE RefreshToken SET revokedAt = now() (replacedBySessionId left NULL)
    Sess-->>A: done
    A-->>U: 200 {message: "Logged out."} + Set-Cookie refresh_token=; Max-Age=0 (cleared)

    Note over U,DB: If this SAME cookie is replayed later (e.g. a stale tab),<br/>rotate() finds revokedAt SET but replacedBySessionId NULL —<br/>classified as plain INVALID_OR_EXPIRED_REFRESH_TOKEN,<br/>NOT reuse. Other active sessions for this user are untouched.<br/>This is the fix verified by test/integration/auth/logout.integration-spec.ts.
```

---

## 6. Frontend Silent Refresh on App Bootstrap

```mermaid
sequenceDiagram
    participant App as Angular app bootstrap
    participant Sess as SessionService (frontend)
    participant API as Backend /auth/refresh + /auth/me
    participant State as AuthStateService

    App->>Sess: provideAppInitializer -> bootstrap()
    Sess->>API: POST /auth/refresh (relies on browser auto-sending the httpOnly cookie)
    alt valid refresh cookie present
        API-->>Sess: {accessToken}
        Sess->>API: GET /auth/me (Authorization: Bearer accessToken)
        API-->>Sess: {user, tenant}
        Sess->>State: setSession(user, tenant, accessToken)
        Note over App: Protected routes render normally, no login flash.
    else no/expired cookie
        API-->>Sess: 401
        Sess->>State: clear()
        Note over App: Guards redirect to /auth/login as normal — no error surfaced to the user.
    end
```

---

## 7. Frontend 401 Interceptor (Mid-Session Token Expiry)

```mermaid
sequenceDiagram
    participant C1 as Component A (request 1)
    participant C2 as Component B (request 2, concurrent)
    participant I as AuthInterceptor
    participant Sess as SessionService (frontend)
    participant API as Backend

    C1->>I: any authenticated request
    I->>API: request (expired accessToken)
    API-->>I: 401
    I->>Sess: refreshAccessToken()
    par concurrent second request
        C2->>I: any authenticated request
        I->>API: request (same expired accessToken)
        API-->>I: 401
        I->>Sess: refreshAccessToken()
        Note over Sess: Second call reuses the SAME in-flight Observable<br/>(shareReplay) — only ONE actual HTTP call to /auth/refresh fires.
    end
    Sess->>API: POST /auth/refresh (single call)
    API-->>Sess: {accessToken: new}
    Sess-->>I: new token (delivered to both waiting callers)
    I->>API: retry original request 1 (new token)
    I->>API: retry original request 2 (new token)
    API-->>I: 200 / 200
    I-->>C1: success
    I-->>C2: success
```
