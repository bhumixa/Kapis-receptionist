# FRONTEND_ARCHITECTURE.md

## AI-Powered WhatsApp Appointment Booking SaaS for Salons
### Frontend Architecture Document

**Document Status:** Draft for Approval
**Version:** 1.0
**Depends on:** PROJECT_REQUIREMENTS.md, SYSTEM_ARCHITECTURE.md, DATABASE_DESIGN.md, PRISMA_SCHEMA.md, API_SPECIFICATION.md (v1.0 each)
**Scope:** Frontend architecture only. No Angular code, no component implementations. Section 11 defines the design system's *categories and approach* at an architectural level only — the full token specification (exact palette, type scale, spacing scale) is deliberately deferred to the dedicated UI/UX Design System & Design Tokens document, per instruction, which follows this one.

---

## 1. Frontend Philosophy

### 1.1 Why Angular

- **A single, opinionated framework for a long-lived, multi-team SaaS.** SYSTEM_ARCHITECTURE.md fixed Angular 20 as the stack; this section explains why that fit is right, not just given. Angular's batteries-included nature (router, forms, HTTP client, DI, CLI, testing harness, all first-party and versioned together) means the frontend team spends its time on salon-specific screens, not assembling and reconciling a router + state library + forms library + build tool from separate ecosystems — a meaningful advantage for a small team building a production system, not a prototype.
- **Structure that scales with the org, not just the codebase.** Angular's module/dependency-injection model maps naturally onto the feature-first, domain-aligned organization this document adopts (Section 2), which in turn mirrors SYSTEM_ARCHITECTURE.md's backend module boundaries (Auth, Appointments, Conversations, Billing, etc.) — a frontend engineer who understands the backend's domain boundaries already understands where frontend code for that domain lives.
- **First-party, stable upgrade path.** A SaaS expected to run for years (PROJECT_REQUIREMENTS.md's "production, not MVP" framing) benefits from Angular's long-term-support release cadence and official migration tooling (`ng update`) far more than from a faster-moving, less structured alternative — predictability over novelty is the right tradeoff for this project's risk profile.

### 1.2 Why Signals

- **Signals are the framework's native, fine-grained reactivity primitive as of Angular 20** — using them as the default state mechanism (rather than layering a third-party state library on top) keeps the mental model singular: a component's template re-renders exactly when the signals it reads change, with no separate change-detection strategy to reason about on top of a separate state-management abstraction.
- **Fine-grained reactivity is a genuine performance win for this specific application.** The dashboard's busiest screens — the booking calendar (Section 6), the WhatsApp inbox, the conversation thread — are exactly the kind of frequently-updating, list-heavy UI where signal-based fine-grained updates (only the DOM node bound to a changed signal re-renders, not a whole component subtree) outperform the older default (zone.js-triggered, component-subtree) change detection.
- **Signals reduce boilerplate for the common case without giving up type safety or testability** — a `signal<Appointment[]>([])` plus a couple of `computed()` derivations replaces what would otherwise be a NgRx-style action/reducer/selector triad for the same simple "fetch a list, derive a filtered/sorted view" pattern that dominates this application's screens (SYSTEM_ARCHITECTURE.md Section 4.7 already made this call for the same reasons; this document operationalizes it).

### 1.3 When to Use RxJS

Signals are the default; RxJS is used deliberately, not by habit, in exactly these cases:

- **The `HttpClient` boundary itself.** Every HTTP call returns an `Observable` — this is Angular's native HTTP contract and is not fought; the API layer (Section 10) converts the `Observable` into a signal at the edge (via `toSignal()`) as soon as it crosses into component/store state, so RxJS never leaks past the service layer into template-facing code.
- **Genuinely asynchronous *event streams* with time-based operators** — debounced search-as-you-type (`GET /customers?q=`, `GET /services?q=` per API_SPECIFICATION.md Section 2.7), typeahead, WebSocket-style live updates if/when introduced, or combining multiple independent async sources (e.g., "refetch the availability grid whenever either the selected date or the selected service changes") where `combineLatest`/`switchMap`/`debounceTime` express the logic far more clearly than an equivalent hand-rolled signal-effect chain.
- **Not used for simple local component state, form field state, or plain derived values** — those are signals/`computed()` by default. The rule of thumb documented here for the team: *reach for RxJS when you need an operator (`debounceTime`, `switchMap`, `merge`, `retry`), reach for signals when you need a value.*

### 1.4 Smart vs. Dumb Components

- **Smart (container) components** own state and side effects: they inject API services/stores, hold signals, handle route data resolution, and pass data + callbacks down. One smart component typically corresponds to one routed page (Section 3/6).
- **Dumb (presentational) components** — the entire component library in Section 7 — accept `input()`s, emit `output()`s, hold no injected business-logic services, and know nothing about *which* API endpoint produced the data they render. A `<app-table>` renders rows; it has no idea whether those rows came from `GET /appointments` or `GET /customers`.
- **Enforcement, not just convention:** presentational components are built and reviewed as if they will ship in a separate, publishable library — no `HttpClient`, no store injection, no route-aware logic permitted inside `shared/components/*` (Section 2), a boundary enforced by code review and, where practical, lint rules restricting importable providers within that folder.

### 1.5 Feature-First Architecture

The application is organized primarily by **business domain** (`appointments`, `customers`, `employees`, `conversations`, `billing`, …), not by technical layer (there is no top-level `services/` or `components/` folder holding the entire app's services/components undifferentiated) — each feature folder is a vertical slice containing its own routed pages, feature-specific components, feature-specific state, and feature-specific API service, mirroring the same domain boundaries SYSTEM_ARCHITECTURE.md drew on the backend (Section 3) and this document's routing table draws again (Section 3). Only what is **genuinely reused across ≥2 features** graduates to `shared/` or `core/` (Section 2) — the default assumption for new code is "this belongs inside its feature" until proven otherwise, preventing the premature, over-abstracted `shared/` folder that becomes a dumping ground.

### 1.6 Reusable Components

Reusability is scoped deliberately into two tiers, not conflated:
- **Tier 1 — Design-system primitives** (Section 7): framework-agnostic-in-spirit, zero business knowledge, used across every feature (`Button`, `Modal`, `Table`, `Badge`, …).
- **Tier 2 — Domain-shared components**: components with light domain awareness reused across *multiple but not all* features — e.g., a `<app-customer-picker>` combobox used by both `appointments` (booking a customer in) and `conversations` (linking a thread to a customer). These live in `shared/components/domain/` (Section 2), distinct from Tier 1, so a reviewer instantly knows whether a component is safe to reuse with zero domain coupling or carries some.

### 1.7 Separation of Concerns

Four consistently-applied layers, front to back: **Presentation** (dumb components, Section 1.4) → **Page/Container** (smart components, route-bound) → **State** (signal stores, Section 9) → **API/Data** (typed API services, Section 10). A component never calls `HttpClient` directly; a store never renders a template; an API service never holds UI state. This is the same layering discipline SYSTEM_ARCHITECTURE.md Section 2 applied to the backend's Clean Architecture layers, mirrored here so the two codebases share a mental model even though Angular's idioms (services + DI + signals, not ports/adapters) are different in mechanics.

---

## 2. Folder Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── core/                       # Singleton, app-wide, loaded once
│   │   │   ├── api/                    # ApiClient base + per-domain typed API services
│   │   │   ├── auth/                   # AuthStateService, token handling, session bootstrap
│   │   │   ├── config/                 # Runtime config (environment-derived, feature flags)
│   │   │   ├── error/                  # Global ErrorHandler, error-normalization service
│   │   │   ├── guards/                 # AuthGuard, RoleGuard, TenantActiveGuard, UnsavedChangesGuard
│   │   │   ├── interceptors/           # Auth, error, loading, tenant-context interceptors
│   │   │   ├── logging/                # Client-side logging/telemetry wrapper
│   │   │   └── core.providers.ts       # Bootstrap-time provider registration
│   │   ├── shared/                     # Reused across ≥2 features; zero route-awareness
│   │   │   ├── components/
│   │   │   │   ├── primitives/         # Tier 1 — Button, Input, Modal, Table, Badge, … (Section 7)
│   │   │   │   └── domain/             # Tier 2 — CustomerPicker, ServicePicker, StatusChip, …
│   │   │   ├── directives/             # ClickOutside, TrapFocus, Tooltip, LazyImage, …
│   │   │   ├── pipes/                  # CurrencyCents, RelativeTime, TenantTimezoneDate, …
│   │   │   ├── validators/             # phoneNumber, futureDate, matchField, e164, …
│   │   │   ├── models/                 # Shared TS types/interfaces mirroring API_SPECIFICATION DTOs
│   │   │   └── utils/                  # Pure helper functions (no Angular dependency)
│   │   ├── layouts/                    # Shell composition (Section 4)
│   │   │   ├── auth-layout/
│   │   │   ├── dashboard-layout/
│   │   │   ├── admin-layout/
│   │   │   ├── public-layout/
│   │   │   └── maintenance-layout/
│   │   ├── features/                   # Feature-first vertical slices (Section 1.5), lazy-loaded
│   │   │   ├── auth/
│   │   │   ├── onboarding/
│   │   │   ├── dashboard-home/
│   │   │   ├── appointments/
│   │   │   ├── customers/
│   │   │   ├── employees/
│   │   │   ├── services/
│   │   │   ├── conversations/          # WhatsApp inbox + AI conversation views
│   │   │   ├── billing/
│   │   │   ├── notifications/
│   │   │   ├── settings/
│   │   │   ├── profile/
│   │   │   ├── analytics/
│   │   │   └── admin/                  # Super Admin console
│   │   │       └── [each feature folder internally structured as below]
│   │   ├── app.routes.ts               # Top-level route table (Section 3)
│   │   └── app.config.ts               # Application bootstrap configuration
│   ├── assets/                         # Static images, fonts, locale files (Section 16)
│   ├── styles/                         # Tailwind entry point, design tokens (Section 11), global CSS
│   └── environments/                   # environment.ts / environment.staging.ts / environment.prod.ts
├── angular.json
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

### 2.1 Per-Feature Internal Structure

Every folder under `features/*` follows the same internal shape, so moving between domains carries zero re-orientation cost:

```
features/appointments/
├── pages/               # Routed, smart/container components (one per route)
│   ├── appointment-list-page/
│   ├── appointment-detail-page/
│   └── appointment-calendar-page/
├── components/          # Feature-local dumb components, not reused outside this feature
│   ├── appointment-form/
│   ├── appointment-card/
│   └── availability-grid/
├── services/            # AppointmentsApiService (Section 10), feature-local helpers
├── state/               # AppointmentsStore (Section 9)
├── models/              # Feature-specific view-model types (beyond the shared DTOs)
└── appointments.routes.ts
```

### 2.2 Folder Purpose Reference

| Folder | Purpose |
|---|---|
| `core/` | Instantiated once for the app's lifetime; anything here is a singleton by convention (`providedIn: 'root'` or bootstrap-registered). If a service holds state that should reset per-feature-navigation, it does not belong here. |
| `shared/components/primitives` | The design-system component library (Section 7) — zero business/domain knowledge, safe to reuse anywhere, reviewed as if publishable standalone. |
| `shared/components/domain` | Lightly domain-aware components shared across 2+ (not all) features (Section 1.6) — the deliberate middle tier between primitives and feature-local components. |
| `shared/directives` / `shared/pipes` | Stateless, reusable template helpers with no business logic beyond pure formatting/behavior. |
| `shared/validators` | Reusable Reactive Forms validator functions (Section 8), decoupled from any single feature's form. |
| `shared/models` | TypeScript interfaces mirroring API_SPECIFICATION.md Section 3's DTOs — the frontend's copy of the contract, kept in sync manually at this phase (Section 10 flags codegen as a future improvement). |
| `layouts/` | Shell components composing navigation chrome around routed content (Section 4) — never contain business logic, only chrome + `<router-outlet>`. |
| `features/*/pages` | Smart, routed components — the only place `ActivatedRoute`, feature stores, and feature API services are injected together. |
| `features/*/components` | Dumb, feature-local components not reused elsewhere — if a second feature needs one, it graduates to `shared/components/domain`, never gets duplicated. |
| `features/*/state` | The feature's signal store(s) (Section 9). |
| `assets/` | Static, non-code files — images, fonts, per-locale translation JSON (Section 16). |
| `styles/` | Tailwind configuration entry and design-token CSS custom properties (Section 11) — global, but strictly presentation, never logic. |
| `environments/` | Build-time environment configuration (API base URL, feature flags) — never secrets (SYSTEM_ARCHITECTURE.md 9.5's "frontend never holds secrets" rule applies identically here). |

---

## 3. Routing Architecture

### 3.1 Guard Composition Model

Every protected route composes guards (SYSTEM_ARCHITECTURE.md 4.10) in a fixed order, evaluated left to right, short-circuiting on the first failure: **`AuthGuard`** (is there a valid session at all?) → **`TenantActiveGuard`** (is the tenant's subscription in good standing? — skipped entirely on `/admin/*`, since Super Admins have no tenant) → **`RoleGuard`** (does the caller's role satisfy this route's declared minimum?). This mirrors the backend's own layered check order (tenant context resolved before authorization, SYSTEM_ARCHITECTURE.md 8.4) so the two systems fail in the same order for the same reason, which matters when correlating a frontend redirect with a backend `402`/`403` in support debugging.

### 3.2 Full Route Table

| Path | Layout | Guards | Roles Allowed | Page (Section 6) |
|---|---|---|---|---|
| `/` | `PublicLayout` | none | Public | Marketing landing (redirects to `/app/dashboard` if already authenticated) |
| `/pricing` | `PublicLayout` | none | Public | Pricing page, sourced from `GET /plans` |
| `/auth/login` | `AuthLayout` | `GuestOnlyGuard` | Public | Login |
| `/auth/register` | `AuthLayout` | `GuestOnlyGuard` | Public | Register |
| `/auth/forgot-password` | `AuthLayout` | `GuestOnlyGuard` | Public | Forgot Password |
| `/auth/reset-password/:token` | `AuthLayout` | `GuestOnlyGuard` | Public | Reset Password |
| `/auth/verify-email/:token` | `AuthLayout` | none | Public | Verify Email (works whether or not currently logged in) |
| `/auth/google/callback` | `AuthLayout` | none | Public | Google OAuth redirect handler |
| `/auth/accept-invitation/:token` | `AuthLayout` | `GuestOnlyGuard` | Public | Accept staff invitation (API_SPECIFICATION.md Section 18.2 gap — routed here in anticipation of that endpoint landing) |
| `/app/onboarding` | `DashboardLayout` (minimal chrome) | `AuthGuard` | `OWNER` | Onboarding wizard (PROJECT_REQUIREMENTS.md 14.1) — shown once, redirected away from after completion |
| `/app/dashboard` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` | Dashboard home |
| `/app/appointments` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` | Appointments (calendar/list) |
| `/app/appointments/new` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` | New Appointment |
| `/app/appointments/:id` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` (scoped, API_SPECIFICATION.md Section 10) | Appointment Detail |
| `/app/customers` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` | Customers List |
| `/app/customers/:id` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` | Customer Detail |
| `/app/employees` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` (read); mutations gated in-page | Employees List |
| `/app/employees/:id` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` | Employee Detail |
| `/app/services` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` | Services List |
| `/app/services/:id` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` | Service Detail |
| `/app/conversations` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` | WhatsApp Inbox / AI Conversations |
| `/app/conversations/:id` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard` | `OWNER`, `MANAGER`, `STAFF` | Conversation Thread |
| `/app/notifications` | `DashboardLayout` | `AuthGuard` | `OWNER`, `MANAGER`, `STAFF` | Notifications |
| `/app/profile` | `DashboardLayout` | `AuthGuard` | `OWNER`, `MANAGER`, `STAFF` | Profile |
| `/app/analytics` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard`, `RoleGuard` | `OWNER`, `MANAGER` | Analytics |
| `/app/billing` | `DashboardLayout` | `AuthGuard`, `RoleGuard` | `OWNER` (view: `OWNER`,`MANAGER`; mutate: `OWNER` only, in-page) | Billing — deliberately **not** gated by `TenantActiveGuard`, since a suspended tenant must still reach this page to fix payment (Section 3.3) |
| `/app/settings` | `DashboardLayout` | `AuthGuard`, `TenantActiveGuard`, `RoleGuard` | `OWNER`, `MANAGER` | Settings |
| `/admin/tenants` | `AdminLayout` | `AuthGuard`, `RoleGuard` | `SUPER_ADMIN` | Admin: Tenants |
| `/admin/tenants/:id` | `AdminLayout` | `AuthGuard`, `RoleGuard` | `SUPER_ADMIN` | Admin: Tenant Detail |
| `/admin/users` | `AdminLayout` | `AuthGuard`, `RoleGuard` | `SUPER_ADMIN` | Admin: Users |
| `/admin/system` | `AdminLayout` | `AuthGuard`, `RoleGuard` | `SUPER_ADMIN` | Admin: System Health |
| `/403` | `PublicLayout` | none | Any | Unauthorized |
| `/maintenance` | `PublicLayout` | none | Any | Maintenance mode |
| `/404` / `**` | `PublicLayout` | none | Any | Not Found (wildcard catch-all) |

### 3.3 Notable Routing Rules

- **`GuestOnlyGuard`** is the mirror image of `AuthGuard` — it redirects an *already-authenticated* user away from `/auth/*` screens back to `/app/dashboard`, preventing a logged-in Owner from accidentally landing on the login screen via a stale bookmark.
- **`TenantActiveGuard`'s exemption for `/app/billing`** (SYSTEM_ARCHITECTURE.md 4.10) is the single most important routing edge case in the app: a `PAST_DUE`/`SUSPENDED` tenant is redirected to `/app/billing` from *every other* `/app/*` route, but `/app/billing` itself must remain reachable, or the tenant would be permanently locked out of the one screen that lets them resolve the block.
- **Role mismatches resolve to `/403`, not `/404`** — deliberately distinct from the backend's cross-tenant `404`-for-privacy behavior (API_SPECIFICATION.md Section 2.3.1); on the frontend, the route structure itself is not secret (a `STAFF` user knows `/app/billing` exists, they're just not allowed in), so a clear "you don't have access" page is better UX than a misleading "this page doesn't exist."
- **`/app/onboarding` is a one-time gate, not a permanent route** — `AuthGuard` additionally checks `tenant.hasCompletedOnboarding` (a derived flag from whether `WhatsAppAccount` + at least one `Service` + at least one `Employee` exist) and force-redirects a fresh `OWNER` there immediately after registration; once complete, the route remains technically reachable (e.g., to re-run the WhatsApp connection step) but is never the default landing page again.
- **Lazy loading boundary = feature folder boundary** (Section 2.1) — every top-level segment under `/app/*` and `/admin/*` maps to exactly one lazily-loaded feature route config, so no feature's code is downloaded until a user actually navigates there (Section 14.1).

---

## 4. Layout System

Four **distinct layout components**, plus one **responsive mode** (not a fifth component — see 4.5) — mapped 1:1 to the layout column in Section 3.2's route table.

### 4.1 Auth Layout

Centered single-column card (login, register, password reset, email verification, invitation acceptance) over a minimal branded background — no navigation chrome at all, since there is nothing to navigate to yet. Contains: logo, the routed form content, and a footer with links (terms, support). Responsive behavior is trivial (a centered card degrades to full-width padding on narrow viewports) since there's no sidebar/nav to reflow.

### 4.2 Dashboard Layout

The primary authenticated shell — sidebar navigation (left, collapsible) + top bar (tenant name/switcher-free since MVP is single-tenant-per-login, search, notifications bell, user menu) + main content region (`<router-outlet>`). Navigation items are **rendered conditionally per role** (Section 5.4) — a `STAFF` user's sidebar never even renders a `Billing` or `Settings` link, rather than rendering it disabled, since a visibly-disabled-but-present link invites confusion about *why* it's disabled when the honest answer is simply "not your role." The top bar's notification bell reflects `GET /notifications`'s `meta.unreadCount` (API_SPECIFICATION.md Section 14) as a live badge.

### 4.3 Admin Layout

Structurally similar to the Dashboard Layout (sidebar + top bar + content) but **visually and chromatically distinct** (a different accent color and a persistent "Platform Admin" badge in the top bar, Section 11) — a deliberate SYSTEM_ARCHITECTURE.md Section 4.4 requirement restated here at the UI level: a Super Admin must never be able to mistake the admin console for a tenant's own dashboard, since the two have entirely different data scopes (cross-tenant vs. single-tenant) and an accidental context confusion here is a real risk, not just a cosmetic concern. Navigation is limited to the three admin sections (Tenants, Users, System) plus a "Return to my account" link if the Super Admin also holds a tenant-scoped session (an edge case worth designing for even if rare).

### 4.4 Public Layout

Marketing/pricing/error-page shell — top nav (logo, pricing link, login/register CTA) + footer, no sidebar. Used for `/`, `/pricing`, `/403`, `/404`, `/maintenance` — pages that must render correctly for a visitor with **no session at all**, so this layout injects nothing from `AuthStateService` beyond an optional "is a session present, show 'Go to Dashboard' instead of 'Log In'" check.

### 4.5 Mobile Layout (Responsive Mode, Not a Separate Component)

There is deliberately **no fifth, separate `MobileLayout` component** — "mobile" is a responsive state of the existing four layouts (Section 13), not a parallel navigation structure to build and maintain twice. Concretely, at the `sm`/`md` breakpoint (Section 13.4): the Dashboard/Admin Layout's sidebar collapses into a slide-over drawer (Angular CDK `Overlay`, Section 7) triggered by a hamburger icon in the top bar, and the top bar itself becomes sticky to preserve access to search/notifications without permanent sidebar real estate. This is a deliberate architectural choice: maintaining one layout component with responsive CSS is a smaller, less error-prone surface than maintaining a structurally-different mobile layout tree that can drift out of sync with the desktop one.

### 4.6 Navigation Summary

Primary navigation (Dashboard Layout sidebar, role-filtered): Dashboard, Appointments, Customers, Employees, Services, Conversations, Analytics *(Owner/Manager)*, Billing *(Owner)*, Settings *(Owner/Manager)*. Secondary/utility navigation (top bar): Notifications, Profile, Logout. Admin Layout sidebar: Tenants, Users, System. Breadcrumbs are rendered on every detail page (`Appointments > #A-4821`) via a route-data-driven breadcrumb component (Angular Router's `data` property per route, resolved into `shared/components/primitives`'s `Breadcrumb`, Section 7).

---

## 5. Authentication Flow

Every flow below maps directly to its API_SPECIFICATION.md Section 4 endpoint; this section defines the *frontend* orchestration around each call — form, validation, redirect, and error-display behavior — not the API contract itself.

### 5.1 Login

`features/auth/pages/login-page` — Reactive Form (email, password), submits to `AuthApiService.login()` (`POST /auth/login`). On success: `AuthStateService` is hydrated with `user`/`tenant`/`accessToken` signals, the httpOnly refresh cookie is already set by the browser from the response (no frontend action needed), and the router navigates to `/app/onboarding` or `/app/dashboard` depending on `tenant.hasCompletedOnboarding` (Section 3.3). On `401 INVALID_CREDENTIALS`: a single, generic inline error ("Incorrect email or password") — deliberately not distinguishing "wrong email" from "wrong password" in the UI, mirroring the backend's own enumeration-resistant design (API_SPECIFICATION.md Section 4's `/auth/forgot-password` note applies the same principle here). On `403 EMAIL_NOT_VERIFIED`: a distinct inline message with a "resend verification email" action.

### 5.2 Register

`features/auth/pages/register-page` — Reactive Form (email, password, confirm password, first/last name, salon name, timezone — the last auto-detected from the browser via `Intl.DateTimeFormat().resolvedOptions().timeZone` and presented as an editable default, not silently assumed). Client-side validation mirrors API_SPECIFICATION.md Section 4's server-side rules exactly (password strength, required fields) so the user sees the same constraints before submitting, not just after a round-trip. On success (`201`): redirect straight to `/app/onboarding` with a persistent banner ("Check your email to verify your account") rather than blocking access — the onboarding wizard itself is usable pre-verification (email verification gates WhatsApp go-live, not dashboard exploration, an intentionally low-friction sequencing choice).

### 5.3 Forgot Password / Reset Password

`features/auth/pages/forgot-password-page`: single email field, submits to `POST /auth/forgot-password`, **always** shows the same success message regardless of whether the email exists (mirroring the backend's deliberate non-enumeration behavior, API_SPECIFICATION.md Section 4) — the frontend must never "helpfully" reveal existence by, e.g., branching its own message based on a response difference that doesn't exist. `features/auth/pages/reset-password-page`: reads `:token` from the route, new-password + confirm-password fields, submits to `POST /auth/reset-password`; on `400 INVALID_OR_EXPIRED_TOKEN`, shows a clear "this link has expired, request a new one" state with a direct link back to Forgot Password, not a generic form error.

### 5.4 Verify Email

`features/auth/pages/verify-email-page` — no form; reads `:token` from the route on page load, immediately calls `POST /auth/verify-email`, shows a success/failure state with a "Continue to Dashboard" CTA. Reachable whether or not the user currently has an active session (Section 3.2), since the link is delivered via email and may be opened on a different device/browser than the one currently logged in.

### 5.5 Google Login

The Login and Register pages both render a "Continue with Google" button (shared `GoogleAuthButton` domain component, Section 1.6) that redirects to Google's OAuth consent screen; Google redirects back to `/auth/google/callback`, a route with no visible UI — it extracts the `code` query parameter, calls `POST /auth/google`, and on success proceeds exactly like Section 5.1's post-login redirect. On `403 NO_MATCHING_ACCOUNT` (API_SPECIFICATION.md Section 4), the callback page shows a clear message that this Google account isn't linked to any salon and offers a link to `/auth/register` — Google login never silently creates a new tenant (API_SPECIFICATION.md's explicit rule).

### 5.6 Session Management

`AuthStateService` (`core/auth/`) is the single source of truth for client-side session state: `currentUser` (signal), `currentTenant` (signal), `accessToken` (signal, held in memory only — never `localStorage`, SYSTEM_ARCHITECTURE.md 7.1/9.9), and `isAuthenticated` (computed signal). On app bootstrap (`app.config.ts` `APP_INITIALIZER`-equivalent provider), the app attempts a silent `POST /auth/refresh` before rendering any protected route, so a returning user with a still-valid refresh cookie never sees a login flash — a failed silent refresh simply leaves `isAuthenticated` false and guards redirect normally.

### 5.7 Refresh Tokens

Entirely handled by `AuthInterceptor` (`core/interceptors/`, Section 10.6) — on any API response `401`, the interceptor pauses the failing request, calls `POST /auth/refresh` exactly once (subsequent concurrent `401`s queue behind the same in-flight refresh call rather than each triggering their own, preventing a refresh-storm), retries the original request with the new access token on success, and on refresh failure clears `AuthStateService` and redirects to `/auth/login` with the originally-intended URL preserved as a `returnUrl` query param for post-login redirect.

### 5.8 Route Guards

`AuthGuard`, `TenantActiveGuard`, `RoleGuard`, `GuestOnlyGuard` (Section 3.1/3.3) — implemented as Angular functional guards (`CanActivateFn`), composed per-route via the router's array syntax, each reading exclusively from `AuthStateService`'s signals (never making a fresh API call itself — session state is always already resolved by the time a guard runs, per Section 5.6's bootstrap sequencing).

### 5.9 Permission Guards

Beyond coarse route-level `RoleGuard`, finer-grained **in-page** permission checks (SYSTEM_ARCHITECTURE.md 7.4's named-permission model, e.g. `billing:manage`, `staff:invite`) are exposed via a `PermissionService.can(permission: string): Signal<boolean>` used directly in templates (`@if (permissionService.can('staff:invite')()) { <app-button>Invite Staff</app-button> }`) to conditionally render individual actions/buttons within a page that's otherwise reachable by a broader role set — e.g., both `OWNER` and `MANAGER` reach `/app/settings`, but only `OWNER` sees the "Delete Account" action within it. This is a **UX convenience layer only**, never a security boundary (Section 17.4) — the backend independently re-validates every permission on every request regardless of what the frontend chose to render.

---

## 6. Dashboard Design

Each page below names its route (Section 3.2), primary API dependency (API_SPECIFICATION.md), and key components (Section 7).

### 6.1 Dashboard (Home)
`/app/dashboard` → `GET /dashboard`. A KPI-card row (Metrics Cards: today's bookings, revenue, handoff queue count) + an "Upcoming Appointments" list (today/next few, `AppointmentCard`) + a "Needs Attention" panel surfacing the AI handoff queue count with a direct link into `/app/conversations?status=ESCALATED`. `STAFF` sees an identical layout scoped to their own bookings/assignments only (API_SPECIFICATION.md Section 15's server-side role branching — the page component itself doesn't need to know it's rendering a reduced view; the data it receives already is).

### 6.2 Appointments
`/app/appointments` → `GET /appointments`, `GET /appointments/availability`. Two view modes toggled by a `Tabs`/segmented control: **Calendar** (a week/day grid, the `Calendar` component, Section 7, colored by `EmployeeDTO.colorTag`) and **List** (a `Table` with status `Badge`, sortable by `startTime`, filterable by employee/status/date-range per API_SPECIFICATION.md Section 10's filter allow-list). A persistent "New Appointment" button opens the `AppointmentForm` in a `Drawer` (not a route navigation — booking is a frequent, fast action that shouldn't lose the calendar's scroll position). Detail (`/app/appointments/:id`) shows the full `AppointmentDTO` including service line-items, status history timeline, and the three action buttons (Cancel, Reschedule, mirrored from `POST .../cancel` and `POST .../reschedule`) gated by the same status-transition rules the API enforces (API_SPECIFICATION.md Section 10) — a `CANCELLED` appointment's action buttons simply don't render, rather than rendering disabled with no explanation.

### 6.3 Customers
`/app/customers` → `GET /customers`. A searchable (`SearchBar`, debounced `q` param, Section 1.3), tag-filterable `Table`/`DataGrid` (name, phone, tags, last visit). Detail (`/app/customers/:id`) is a two-column layout: profile + tags + notes on the left, appointment history (`GET /appointments?filter[customerId]=`) and conversation history (`GET /conversations?filter[customerId]=`) as tabbed lists on the right — giving staff the full relationship context in one screen, directly serving PROJECT_REQUIREMENTS.md's "staff need full context" persona goal (Section 6.2, "Ana").

### 6.4 Employees
`/app/employees` → `GET /employees`. Card-grid or table (toggleable) showing avatar/`colorTag`, name, status `Badge`, service-eligibility count. Detail/edit (`/app/employees/:id`) includes a `WorkingHours` weekly-schedule editor (a custom `components/domain` component built from `TimePicker` rows per day) and a multi-select `ServicePicker` for `EmployeeService` eligibility (API_SPECIFICATION.md Section 7). The `EMPLOYEE_HAS_UPCOMING_APPOINTMENTS` API error (Section 7's `PATCH`/`DELETE` guardrail) surfaces as an inline warning listing the conflicting appointments with direct links, not a raw error toast — a case worth designing explicitly since it's the one error on this page a user needs to *act* on, not just dismiss.

### 6.5 Services
`/app/services` → `GET /services`. A category-grouped list/table (name, duration, price formatted via the `CurrencyCents` pipe, active `Badge`) with inline quick-toggle for `isActive`. Create/edit uses a `Modal` (lighter-weight than the Appointments `Drawer`, since a service edit is a short, single-purpose form) with a multi-select `ServicePicker`-adjacent `EmployeePicker` for eligibility.

### 6.6 WhatsApp Inbox / AI Conversations
`/app/conversations` → `GET /conversations`, `/app/conversations/:id` → `GET /messages?filter[conversationId]=`. A classic two-pane inbox layout: conversation list (left, filterable by status — the `ESCALATED`/`HUMAN_HANDLING` filter is the default view for staff actively working the handoff queue, FR-13) and message thread (right, chat-bubble style, `MessageDTO.senderType` driving bubble alignment/color: customer left, AI/staff right with a distinct AI-vs-staff visual marker so a reviewer can always tell who said what). A composer at the bottom of the thread posts to `POST /messages/send`, disabled with an explanatory banner when the conversation is outside the 24-hour messaging window and no approved template applies (API_SPECIFICATION.md Section 11's `OUTSIDE_MESSAGING_WINDOW` case). An "AI Context" side-panel (collapsible) surfaces `AIContext`-derived state (current intent, last tool call) for staff debugging/trust-building — directly supporting SYSTEM_ARCHITECTURE.md Section 5.9's transparency goal at the UI layer.

### 6.7 Analytics
`/app/analytics` → `GET /analytics`. Date-range picker (default last 30 days) driving a set of `Charts` (booking volume over time, no-show rate trend, AI handoff rate, AI booking-completion rate — PROJECT_REQUIREMENTS.md Section 18's Success Metrics, tenant-scoped subset) plus summary `Metrics Cards` above the fold.

### 6.8 Billing
`/app/billing` → `GET /subscriptions`, `GET /plans`, `GET /invoices`, `POST /subscriptions`. Current-plan summary card (status `Badge` reflecting `SubscriptionStatus`, usage bar for `messagesUsedCurrentPeriod` against `Plan.maxMessagesPerMonth`) + a plan-comparison grid for upgrading/downgrading (each plan a `Card` with a "Select" CTA triggering `POST /subscriptions`, redirecting to `checkoutUrl` when present per API_SPECIFICATION.md Section 13) + an invoice history `Table`. A **persistent, dismissible-only-by-resolution banner** renders at the top of every `/app/*` page (not just this one) when `SubscriptionStatus` is `PAST_DUE`, linking here — the one piece of billing UI that intentionally escapes this page's boundaries, since a payment problem needs to be visible everywhere until fixed (mirrors the `TenantActiveGuard` routing behavior, Section 3.3).

### 6.9 Settings
`/app/settings` → `GET/PATCH /tenant`, `GET/PATCH /tenant/settings`. Tabbed sections: **Salon Profile** (name, address, timezone, logo upload), **AI Behavior** (greeting message, tone select, escalation instructions — a `Textarea`-heavy form directly mapping to `TenantSettingsDTO`, with a live preview panel showing how the greeting will appear as a WhatsApp bubble, a small but high-value UX touch for a non-technical Owner persona), **Booking Policy** (cancellation notice hours, booking buffer, reminder timing — `Input[type=number]` with unit suffixes), **Team** (embeds the Users list/invite flow from API_SPECIFICATION.md Section 5, since staff management is conceptually a settings sub-area even though it's a distinct API resource).

### 6.10 Profile
`/app/profile` → `GET /auth/me`, `PATCH /users/:id` (self). Personal info form (name — email change intentionally **not** self-service at MVP, shown as read-only with a "contact support to change" note, since email is the login identity and unique-constraint-sensitive per PRISMA_SCHEMA.md Section 3.1.1) + a "Change Password" sub-form (old password + new password, a distinct flow from the unauthenticated Reset Password, Section 5.3) + session info (last login).

### 6.11 Notifications
`/app/notifications` → `GET /notifications`, `PATCH /notifications/:id/read`. A simple reverse-chronological list (icon per `NotificationType`, unread items visually distinguished via a left accent bar rather than a separate "unread" section, keeping chronological order intact) with a "Mark all as read" bulk action and infinite-scroll pagination (cursor-based, matching the API's pagination strategy, Section 9.5).

---

## 7. Component Library

All 24 requested components live in `shared/components/primitives` (Section 2, Tier 1) unless noted — built on Angular CDK primitives (`Overlay`, `FocusTrap`, `A11yModule`, `Portal`) for behavior, styled with Tailwind, iconed with Lucide (per the fixed UI stack). Every component uses Angular's `input()`/`output()` signal-based APIs (not legacy `@Input()`/`@Output()` decorators), consistent with Section 1.2's signals-first philosophy. Full visual specification (exact colors, spacing scale, elevation values) is deferred to the dedicated Design System document (Section 11 note); this section fixes each component's **behavioral contract** — the part the design system doesn't own.

### 7.1 Core Primitives

**Button**
- *Purpose:* the single interactive-action primitive used everywhere; no feature builds its own button.
- *Inputs:* `variant` (`primary`\|`secondary`\|`outline`\|`ghost`\|`destructive`), `size` (`sm`\|`md`\|`lg`), `disabled`, `loading`, `iconLeft`/`iconRight` (Lucide icon name), `fullWidth`, `ariaLabel` (required when icon-only).
- *Outputs:* native `click` (no custom output wrapper needed).
- *States:* default, hover, focus-visible, active, disabled, loading (inline spinner replaces `iconLeft`, interaction blocked).
- *Accessibility:* renders a native `<button>` (never a styled `<div>`); `aria-busy="true"` while loading; `disabled` uses the native attribute (removes from tab order correctly, no `tabindex` hack); icon-only usage without `ariaLabel` fails review/lint.

**Input**
- *Purpose:* single-line text/number/email/password entry, the base of every Reactive Form (Section 8).
- *Inputs:* `type`, `label`, `placeholder`, `errorMessage` (signal, string \| null), `hint`, `disabled`, `required`, `prefixIcon`/`suffixIcon`, implements `ControlValueAccessor` for `formControlName` binding.
- *Outputs:* standard `ControlValueAccessor` change/touch callbacks; no custom outputs.
- *States:* default, focus, filled, error (red border + `errorMessage` shown below), disabled, read-only.
- *Accessibility:* `<label>` programmatically associated via `for`/`id`; `aria-invalid="true"` and `aria-describedby` pointing at the error message when in error state; error text uses `role="alert"` region so screen readers announce it on appearance, not just on next full page read.

**Textarea**
- *Purpose:* multi-line text entry (AI greeting message, notes, escalation instructions — Section 6.9).
- *Inputs:* `label`, `placeholder`, `errorMessage`, `rows` (default 4), `maxLength` (with live character-count display), `disabled`, `required`.
- *Outputs:* `ControlValueAccessor` standard.
- *States:* same as `Input`, plus an "approaching limit" visual state on the character counter at 90% of `maxLength`.
- *Accessibility:* identical labeling pattern to `Input`; character-count region marked `aria-live="polite"` so it doesn't interrupt typing but stays available to screen-reader users.

**Card**
- *Purpose:* generic content-grouping surface — the base every `MetricsCard`, plan-comparison tile, and dashboard panel composes from.
- *Inputs:* `padding` (`sm`\|`md`\|`lg`), `elevated` (boolean, applies shadow per Section 11's elevation scale), `interactive` (boolean — adds hover/focus affordance when the card itself is clickable, e.g. a plan-selection card).
- *Outputs:* `click` (only meaningful/bound when `interactive`).
- *States:* default, hover/focus (interactive only), selected (interactive only, e.g. currently-active plan).
- *Accessibility:* renders as `<button>`/`role="button"` with `tabindex="0"` only when `interactive`; otherwise a plain `<div>` with no spurious interactive semantics (a common accessibility anti-pattern — a non-interactive card must never carry `role="button"`).

**Avatar**
- *Purpose:* user/customer/employee identity representation (initials fallback, `colorTag`-driven background for employees per Section 6.4).
- *Inputs:* `src` (image URL, optional), `name` (for initials fallback + `alt` text), `size` (`xs`\|`sm`\|`md`\|`lg`), `colorSeed` (optional, drives fallback background color).
- *Outputs:* none.
- *States:* image-loaded, initials-fallback (image absent or failed to load), loading (skeleton shimmer while image loads).
- *Accessibility:* `alt` always set to `name`, never empty, since an avatar is meaningful content, not decoration; initials fallback rendered as text, not an image, so it's natively screen-reader-readable.

**Badge**
- *Purpose:* compact status/label indicator — every enum from PRISMA_SCHEMA.md Section 2 that surfaces in the UI (`AppointmentStatus`, `ConversationStatus`, `SubscriptionStatus`, …) renders through this one component with a centrally-maintained status→color mapping (Section 11), so a status color is never redefined ad hoc per feature.
- *Inputs:* `label`, `variant` (`neutral`\|`success`\|`warning`\|`danger`\|`info`), `size` (`sm`\|`md`).
- *Outputs:* none (purely presentational, non-interactive).
- *States:* static (no interactive states).
- *Accessibility:* text-based, not color-only (Section 12.5's WCAG contrast/color-independence rule applies here directly — a colorblind user must be able to distinguish `CONFIRMED` from `CANCELLED` from the label text alone).

**Dropdown**
- *Purpose:* single-select or action-menu overlay (user menu, row actions, filter selects).
- *Inputs:* `options` (label/value pairs, or arbitrary menu-item content via content projection for action menus), `selectedValue`, `placeholder`, `disabled`.
- *Outputs:* `selectionChange` (emits selected value), `opened`/`closed`.
- *States:* closed, open, item-highlighted (keyboard/hover), disabled.
- *Accessibility:* built on CDK `Overlay` + `A11yModule`'s `FocusTrap`/`ListKeyManager`; trigger carries `aria-haspopup="listbox"`/`aria-expanded`; the panel uses `role="listbox"`/`role="option"` with full arrow-key navigation and `Escape`-to-close returning focus to the trigger (never leaving focus stranded inside a closed overlay).

**Pagination**
- *Purpose:* the offset-pagination control (API_SPECIFICATION.md Section 2.4.2's allow-listed endpoints only — `Employees`, `Services`, `Plans`, Admin lists); cursor-paginated lists (Section 7.2's `Table`/inbox views) use a "Load more"/infinite-scroll pattern instead, a **different component**, not this one, since the two pagination strategies have genuinely different UI needs (page-jump vs. incremental-load).
- *Inputs:* `currentPage`, `totalPages`, `totalItems`.
- *Outputs:* `pageChange` (emits requested page number).
- *States:* default, first-page (previous disabled), last-page (next disabled), single-page (entire control hidden — no pagination UI clutter when everything fits on one page).
- *Accessibility:* `<nav aria-label="Pagination">`; current page marked `aria-current="page"`; previous/next buttons carry explicit `ariaLabel`s ("Previous page"), never icon-only with no label.

**Search Bar**
- *Purpose:* the `q` free-text search input (API_SPECIFICATION.md Section 2.7), debounced.
- *Inputs:* `placeholder`, `debounceMs` (default 300), `initialValue`.
- *Outputs:* `searchChange` (emits the debounced query string — the *only* place in the component library RxJS appears inside a component's internals, per Section 1.3's rule, using `debounceTime`+`distinctUntilChanged` on the raw input `Observable` before converting to a signal-friendly output).
- *States:* empty, typing (debounce pending — subtle loading indicator in the suffix), has-value (shows a clear/×icon button).
- *Accessibility:* `role="searchbox"`, `aria-label` required input; clear button carries its own `ariaLabel` ("Clear search").

**Loading Spinner**
- *Purpose:* inline or full-region loading indicator, driven by the global `LoadingInterceptor` (Section 10.8) for page-level loads and by local component state for scoped async actions (e.g., a single button's `loading` input, which internally renders this).
- *Inputs:* `size` (`sm`\|`md`\|`lg`), `label` (visually-hidden text describing what's loading, e.g. "Loading appointments").
- *Outputs:* none.
- *States:* spinning only (no other state — a spinner that could be "done" is a `Skeleton` or a resolved view instead, not this component with a flag).
- *Accessibility:* `role="status"` + `aria-live="polite"` wrapping a visually-hidden `label` — a spinner with no accessible label is a common and easily-avoided failure this component structurally prevents by requiring the input.

**Skeleton**
- *Purpose:* content-shaped loading placeholder (table rows, cards) shown during initial data fetch, preferred over a bare spinner for list/detail views since it previews layout and reduces perceived load time (a deliberate UX choice, not just decoration).
- *Inputs:* `variant` (`text`\|`avatar`\|`card`\|`table-row`), `count` (repeat count for list contexts), `width`/`height` (for custom shapes).
- *Outputs:* none.
- *States:* shimmering only.
- *Accessibility:* `aria-hidden="true"` on the skeleton elements themselves (they carry no real content) with a single, separate visually-hidden "Loading [content]" status region wrapping the whole skeleton group — screen-reader users hear one loading announcement, not N repeated ones for N skeleton rows.

### 7.2 Overlay, Data, and Feedback Components

**Modal**
- *Purpose:* focused, blocking dialog for short, single-purpose tasks (confirmations, the Services quick-edit form, Section 6.5) — reserved for content that doesn't need the Drawer's persistent-context benefit below.
- *Inputs:* `open` (signal-bound), `title`, `size` (`sm`\|`md`\|`lg`), `dismissible` (whether backdrop-click/`Escape` closes it — `false` for destructive-confirmation modals to force an explicit choice).
- *Outputs:* `closed`, `confirmed` (for the common confirm/cancel variant).
- *States:* closed, opening (enter transition), open, closing (exit transition).
- *Accessibility:* CDK `Dialog`-based; `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the title; focus is trapped inside while open (CDK `FocusTrap`) and restored to the triggering element on close — the single most commonly-broken accessibility behavior in hand-rolled modals, structurally guaranteed here by building on CDK rather than a custom implementation.

**Drawer**
- *Purpose:* side-anchored panel for longer-running or context-preserving tasks (the Appointments booking form, Section 6.2 — chosen over a Modal specifically so the calendar remains visible/scrollable behind it) and the mobile sidebar navigation (Section 4.5).
- *Inputs:* `open`, `side` (`left`\|`right`), `size` (`sm`\|`md`\|`lg`\|`full` — `full` used for the mobile nav drawer), `dismissible`.
- *Outputs:* `closed`.
- *States:* same lifecycle as `Modal` (closed/opening/open/closing).
- *Accessibility:* same CDK-`Dialog`-based foundation and focus-trap/restore guarantee as `Modal` — the two components share an underlying accessibility implementation, differing only in visual presentation (centered overlay vs. edge-anchored panel).

**Table**
- *Purpose:* the standard tabular list view (Appointments list, Customers, Invoices) — cursor-pagination-aware (renders a "Load more" affordance, not page numbers, when bound to a cursor-paginated API_SPECIFICATION.md endpoint, Section 2.4.1).
- *Inputs:* `columns` (config array: key, label, sortable, width, custom cell template via content projection), `rows` (data array), `loading`, `sortState`, `emptyStateConfig` (delegates to `EmptyState` below when `rows` is empty).
- *Outputs:* `sortChange`, `rowClick`, `loadMore` (cursor mode).
- *States:* loading (renders `Skeleton` `table-row` variant), populated, empty (renders `EmptyState`), error (renders `ErrorState`).
- *Accessibility:* semantic `<table>`/`<thead>`/`<tbody>` (never a `<div>`-grid impersonating a table for the base `Table`, reserving that pattern only for `DataGrid` below where virtualization requires it); sortable column headers are real `<button>`s inside `<th>` with `aria-sort` reflecting current state.

**Data Grid**
- *Purpose:* the **virtualized** variant of `Table` for genuinely large, densely-interactive datasets — at MVP, this is specifically the Analytics-adjacent raw data views and any future export-preview screens; the day-to-day Appointments/Customers lists use the plain `Table` above, since their per-tenant row counts stay small (DATABASE_DESIGN.md Section 12's tenant-scoped-query-cost-decoupling point applies to frontend rendering cost too — most tenants never need virtualization).
- *Inputs:* superset of `Table`'s inputs plus `rowHeight` (fixed, required for CDK virtual scroll), `virtualScrollEnabled`.
- *Outputs:* same as `Table`.
- *States:* same as `Table`.
- *Accessibility:* uses CDK `Virtual Scroll Viewport` with `role="grid"`/`role="row"`/`role="gridcell"` (the ARIA grid pattern, since a `<div>`-based virtualized structure cannot use native `<table>` semantics) and explicit `aria-rowcount`/`aria-rowindex` so screen-reader users retain positional context despite only a window of rows being in the DOM at once — the specific, necessary accessibility tradeoff virtualization requires, called out explicitly since it's the one component in this library where full native semantics aren't achievable.

**Tabs**
- *Purpose:* segmented content switching within a page (Appointments' Calendar/List toggle, Section 6.2; Settings' section tabs, Section 6.9).
- *Inputs:* `tabs` (id/label pairs), `activeTabId`.
- *Outputs:* `tabChange`.
- *States:* per-tab: active, inactive, disabled.
- *Accessibility:* full ARIA Tabs pattern — `role="tablist"`/`role="tab"`/`role="tabpanel"`, `aria-selected`, arrow-key navigation between tabs (CDK's `ListKeyManager`), only the active tab's content in the accessibility tree's natural flow (inactive panels `hidden`, not just visually collapsed).

**Calendar**
- *Purpose:* the Appointments week/day grid view (Section 6.2) — a domain-flavored component (arguably Tier 2, but included in the primitives library since its calendar-grid *rendering mechanics* are domain-agnostic even though its typical usage isn't) showing time slots and positioned appointment blocks.
- *Inputs:* `viewMode` (`day`\|`week`), `date`, `events` (positioned blocks: start/end/label/color), `startHour`/`endHour` (business-hours-driven bounds), `loading`.
- *Outputs:* `dateChange`, `eventClick`, `slotClick` (empty-slot click for quick-booking entry).
- *States:* loading (skeleton grid), populated, empty-day (no events, still renders the grid with an unobtrusive "No appointments today" note, not a full `EmptyState` takeover, since the grid itself remains useful/interactive).
- *Accessibility:* grid cells navigable via arrow keys (CDK `ListKeyManager`-driven 2D navigation); each event block carries a full `aria-label` summarizing time/customer/service (not relying on visual position alone) since a screen-reader user cannot perceive a 2D spatial layout the way a sighted user scans it.

**Date Picker**
- *Purpose:* single-date selection (appointment date-range filters, `dateFrom`/`dateTo` on Analytics/Reports, Section 6.7).
- *Inputs:* `selectedDate`, `minDate`/`maxDate`, `disabled`, implements `ControlValueAccessor`.
- *Outputs:* `dateChange` (in addition to standard CVA callbacks).
- *States:* closed, open (calendar popover), date-selected, out-of-range (visually disabled dates within the popover).
- *Accessibility:* built on CDK `Overlay` + a `role="dialog"`/`aria-label="Choose date"` popover containing a `role="grid"` month view (the standard ARIA date-picker pattern) with arrow-key day navigation and `Page Up`/`Page Down` for month stepping.

**Time Picker**
- *Purpose:* time-of-day selection (`WorkingHours` start/end editors, Section 6.4).
- *Inputs:* `selectedTime`, `minuteStep` (default 15, matching typical salon slot granularity), `minTime`/`maxTime`, implements `ControlValueAccessor`.
- *Outputs:* `timeChange`.
- *States:* closed, open (scrollable time-list popover), selected.
- *Accessibility:* same overlay/focus-trap foundation as `Dropdown`; time options are a `role="listbox"` with typeahead (typing "2" jumps toward 2:00-hour entries).

**Toast**
- *Purpose:* transient, non-blocking global notification (success/error confirmations after an action, e.g. "Appointment booked") — driven by a singleton `ToastService` (`core/`, not `shared/`, since it's an app-wide singleton rather than a reusable presentational unit consumed per-instance) that any feature can inject and call `.success()/.error()/.info()` on.
- *Inputs (on the underlying toast item, not typically hand-authored per use):* `variant` (`success`\|`error`\|`info`\|`warning`), `message`, `duration` (auto-dismiss ms, `0` = manual dismiss only), `action` (optional label + callback, e.g. "Undo").
- *Outputs:* `dismissed`.
- *States:* entering, visible, exiting (auto or manual dismiss), paused (hover/focus pauses the auto-dismiss timer — a small but important detail for a slow reader or an assistive-tech user).
- *Accessibility:* the toast region is `aria-live="polite"` (`assertive` for `error` variant, so failures interrupt appropriately) and `role="status"`/`role="alert"` respectively; hovering or focusing a toast pauses its dismiss timer, since a fixed-duration auto-dismiss with no pause is a known WCAG 2.2 timing-adjustable failure mode this component structurally avoids.

**Empty State**
- *Purpose:* the "no data yet" view for any list/table (no appointments today, no customers yet, no conversations) — deliberately distinct from `ErrorState` (below), since "correctly loaded, zero results" and "failed to load" require different messaging and different recovery actions.
- *Inputs:* `icon` (Lucide icon), `title`, `description`, `actionLabel`/`actionCallback` (e.g., "Create your first service" CTA on a brand-new tenant's empty Services list — an important first-run UX moment, not just a generic "nothing here").
- *Outputs:* `actionClicked`.
- *States:* static presentation, single variant per usage context (configured via inputs, not internal state).
- *Accessibility:* the action button is a real `Button` (Section 7.1, inheriting its accessibility guarantees); the illustrative icon is `aria-hidden="true"` (decorative), with the actual meaning carried by `title`/`description` text.

**Error State**
- *Purpose:* the "failed to load" view for any page/section whose data fetch errored — maps API_SPECIFICATION.md Section 2.3.1's error codes to a small set of user-facing message templates (e.g., `UPSTREAM_UNAVAILABLE` → "We're having trouble connecting right now," `FORBIDDEN` → routes to `/403` instead of rendering inline, `NOT_FOUND` → routes to `/404`) rather than surfacing raw `error.message` strings to end users.
- *Inputs:* `errorCode` (drives the message template), `retryCallback` (renders a "Try again" `Button` when provided).
- *Outputs:* `retryClicked`.
- *States:* static per `errorCode`.
- *Accessibility:* the error message region is `role="alert"` so it's announced immediately when it replaces a loading state; the retry button follows standard `Button` accessibility.

**Charts**
- *Purpose:* the Analytics page's (Section 6.7) trend visualizations (line charts for booking volume over time, simple bar/donut for rate breakdowns) — a thin wrapper around a charting library (selection deferred to the implementation phase; this document fixes the *component contract*, not the underlying library) so every chart on the platform shares one consistent API, color mapping (Section 11), and accessibility treatment rather than each feature reaching for the charting library directly.
- *Inputs:* `type` (`line`\|`bar`\|`donut`), `data` (series array), `xAxisLabel`/`yAxisLabel`, `loading`.
- *Outputs:* `pointHover`/`pointClick` (for future drill-down interactions).
- *States:* loading (skeleton chart-shaped placeholder), populated, empty (no data in range — renders `EmptyState`, not a blank chart canvas).
- *Accessibility:* every chart renders an adjacent, visually-hidden **data table** of the same series (the standard, robust accessible-charting pattern — a purely visual canvas/SVG chart is not reliably screen-reader-consumable regardless of ARIA attributes added to it) so the same information is available in a structurally accessible form.

**Metrics Cards**
- *Purpose:* the KPI summary tiles atop Dashboard (Section 6.1) and Analytics (Section 6.7) — a specialized `Card` composition (Section 7.1), not a separate primitive built from scratch.
- *Inputs:* `label`, `value` (formatted string — currency/percentage/count formatting is the *caller's* responsibility via the shared pipes, Section 2, keeping this component free of domain-specific formatting logic), `trend` (optional: direction + percentage, e.g. "+12% vs last week"), `icon`, `loading`.
- *Outputs:* none (purely presentational; if a metric needs to be clickable/navigable, the whole tile is wrapped in a `Card[interactive]` at the call site, not built into this component).
- *States:* loading (`Skeleton` `card` variant), populated.
- *Accessibility:* `trend` direction is conveyed by an icon **and** text ("+12%"), never by color/arrow-direction alone (Section 12.5); the whole tile's numeric content is structured so a screen reader reads label → value → trend in a sensible order, not scattered `aria-label` fragments.

---

## 8. Forms Strategy

### 8.1 Reactive Forms

**Reactive Forms exclusively — Template-Driven Forms are not used anywhere in this codebase.** Every form (Sections 5, 6) is built with `FormGroup`/`FormControl`/`FormArray`, constructed in the smart/container page component (Section 1.4) and passed down to presentational field components (Section 7.1) via `ControlValueAccessor`. This is a deliberate, single-strategy choice: Template-Driven Forms' two-way `[(ngModel)]` binding is harder to unit-test in isolation from the DOM and doesn't compose well with this application's smart/dumb component split, where validation logic needs to live in TypeScript (testable) rather than template markup.

### 8.2 Validation

- **Synchronous validators** mirror API_SPECIFICATION.md's documented "Validation Rules" per endpoint field-for-field (Section 4–16 of that document) — e.g., the Register form's password validator enforces the exact same min-length/uppercase/number rule the backend enforces, so a user never submits a form that's guaranteed to fail server-side. This client/server rule duplication is intentional and accepted: the backend remains the authoritative enforcement point (never trust client validation alone, SYSTEM_ARCHITECTURE.md 9.3), while the frontend copy exists purely for immediate UX feedback.
- **Cross-field validators** (e.g., "confirm password must match password," "reschedule new time must be in the future") are registered at the `FormGroup` level, not on individual controls, and surface their error against whichever field makes sense for the user to look at first (confirm-password field gets the "doesn't match" message, not the original password field).
- **Server-side validation errors** (API_SPECIFICATION.md Section 2.3's `error.details: [{ field, issue }]` array) are mapped back onto the matching `FormControl` by field name after a failed submission, via a shared `applyServerErrors(form, details)` utility (`shared/utils/`) — so a validation failure the client-side rules didn't catch (a race-condition duplicate email, a business-rule check only the backend can perform) still displays inline on the correct field, not as a generic top-of-form banner.

### 8.3 Error Handling

Three-tier error display, applied consistently across every form in the app: **(1) inline field errors** (below each `Input`/`Textarea`/etc., Section 7.1's `errorMessage` input) for both client- and server-validation failures on that specific field; **(2) a form-level banner** for errors that don't map to any single field (e.g., `409 SLOT_NO_LONGER_AVAILABLE` on the Appointment form, API_SPECIFICATION.md Section 10 — the whole booking attempt failed for a reason no single input caused); **(3) a `Toast`** for transient, action-level confirmation/failure that isn't really "form error" territory (e.g., a successful save). A form is never left in a state where an error occurred but nothing visible changed — every failed submission produces at least one of the three.

### 8.4 Async Validation

Used sparingly, for the one genuinely async-validation-worthy case in this app's forms: **customer phone-number uniqueness** on the manual Customer-creation form (Section 6.3) — an `AsyncValidatorFn` debounced against `GET /customers?filter[phoneNumber]=` (or, more precisely, attempting the create and handling `409 PHONE_NUMBER_ALREADY_EXISTS` inline per API_SPECIFICATION.md Section 9's documented conflict response, which is the pattern actually used here rather than a separate pre-check endpoint, since the API doesn't expose one and adding one solely for this would duplicate logic already available via the conflict error's `existingCustomerId` detail). This is called out as the sole async-validator case specifically so the team doesn't reach for the pattern more broadly than needed — most "does this already exist" checks in this app are better served by handling the create endpoint's `409`, which is simpler and avoids a race condition between check and submit.

### 8.5 Reusable Validators

`shared/validators/` (Section 2) — pure functions, framework-standard `ValidatorFn`/`AsyncValidatorFn` signatures, unit-tested independent of any form: `phoneNumberE164`, `futureDateTime` (used by both the Appointment and Reschedule forms), `matchField` (generic cross-field equality, powers "confirm password"), `ianaTimezone`, `hexColor` (Employee `colorTag`), `withinRange(min, max)` (generic numeric bound, reused for `cancellationNoticeHours`/`bookingBufferMinutes`/`durationMinutes` — one validator, multiple call sites, rather than a bespoke validator per numeric field).

---

## 9. State Management

### 9.1 Signals as the Default

Per Section 1.2, every feature's state is a **signal store** — a plain injectable class (not a heavyweight framework construct) exposing `signal()`s for raw state, `computed()`s for derived view state, and plain methods that call the feature's API service and update the signals on response. There is no NgRx, no Akita, no third-party state library in this stack — SYSTEM_ARCHITECTURE.md Section 4.7's decision (D4, Section 12) restated and operationalized here.

### 9.2 RxJS's Role in State

Exactly as scoped in Section 1.3: a store's methods that call the API layer (Section 10) receive an `Observable` back, and convert it to a signal update either via `toSignal()` (for a simple "hold the latest emission" case) or via an explicit `.subscribe()` inside the store method when the response needs to trigger a multi-signal update (e.g., a successful booking updates both the `appointments` list signal and a `lastCreatedAppointment` signal for a subsequent "view your booking" confirmation).

### 9.3 Global State

Deliberately minimal — only truly app-wide, cross-feature state lives at root-provided (`providedIn: 'root'`) singletons: `AuthStateService` (Section 5.6), `ToastService` (Section 7.2), `PermissionService` (Section 5.9), and a small `UiStateService` holding sidebar-collapsed/theme-preference (Section 11's dark/light mode) state that genuinely needs to persist across every route. **Nothing feature-specific is ever hoisted to global state "just in case"** — the default is feature-scoped (9.4) until a second, unrelated feature demonstrably needs the same state.

### 9.4 Feature State

Each feature's store (`features/*/state/`, Section 2.1) is provided at the **feature route's injector level** (via the lazy-loaded route config's `providers`), not root — so an `AppointmentsStore` instance is created when a user first navigates into `/app/appointments` and destroyed when they navigate away to an unrelated feature, naturally resetting stale state rather than requiring manual reset logic. A feature revisited later gets a fresh store and re-fetches, which is the correct default for this app's data (appointment/customer/conversation data is exactly the kind of thing that can have changed — e.g., a new WhatsApp booking arrived — while the user was elsewhere).

### 9.5 Caching

- **In-memory, signal-store-level caching** is the primary mechanism: a store that has already fetched `GET /services` this session doesn't necessarily refetch on every re-navigation within the same session **if** the data is of a low-volatility type (Services, Employees — small, slow-changing catalogs) — governed by a simple `staleAfterMs` policy per store, not a general-purpose HTTP cache layer.
- **High-volatility data is never client-cached across navigations** — Appointments, Conversations/Messages, Notifications always refetch on entering their feature (Section 9.4's natural store-recreation already achieves this; no additional cache-bypass logic is needed, it's simply the absence of a `staleAfterMs` policy for these stores).
- **No service-worker/HTTP-cache-layer caching of API responses** is used at MVP (Section 2.11's `Cache-Control: no-store` on every API response, API_SPECIFICATION.md Section 2.11, structurally prevents the browser from doing this even accidentally) — all caching, where it exists, is the explicit, deliberate, in-memory signal-store kind described above, never an implicit HTTP-layer one that could serve stale tenant data.

### 9.6 HTTP State

Per-request loading/error state is tracked **locally within the store method that issued the call** (a `loading` signal and an `error` signal scoped to that store, not a single app-wide "is anything loading" flag) — so a slow Analytics chart load doesn't spuriously show a loading spinner on an unrelated part of the page. The one *global* HTTP-state signal is `UiStateService.hasPendingRequests` (driven by the `LoadingInterceptor`, Section 10.8), used exclusively for the top-of-page thin progress-bar affordance (a common, low-intrusion pattern), never for blocking the whole UI.

### 9.7 Optimistic Updates

Used selectively, only where the failure mode is cheap to reconcile and the UX payoff is meaningful — concretely: `PATCH /notifications/:id/read` (Section 6.11 — the notification list updates its read/unread visual state immediately on click, before the API call resolves, since a failure here is inconsequential and easily silently retried) and toggling `Service.isActive` from the Services list's inline quick-toggle (Section 6.5). **Not used** for anything booking-related (`POST /appointments`, `.../cancel`, `.../reschedule`) — those always wait for the server's authoritative response before updating UI state, because the whole point of the backend's conflict-prevention design (DATABASE_DESIGN.md Section 10.4, PRISMA_SCHEMA.md Section 14.4) is that the *client cannot know* whether a booking will succeed until the server has actually checked, making an optimistic update here actively misleading rather than a harmless UX nicety.

---

## 10. API Layer

### 10.1 API Services (One Per Domain)

One typed API service per API_SPECIFICATION.md domain tag (`AuthApiService`, `AppointmentsApiService`, `CustomersApiService`, `ConversationsApiService`, `BillingApiService`, …), each living in its owning feature's `services/` folder (Section 2.1) except for cross-cutting ones (`AuthApiService`) which live in `core/api/`. Every method on these services corresponds 1:1 to one API_SPECIFICATION.md endpoint, typed against the shared DTOs (`shared/models/`, Section 2 — the frontend's hand-maintained copy of API_SPECIFICATION.md Section 3's schemas), and returns the unwrapped `data` payload as an `Observable<T>` — the `{ success, data, meta, message, requestId }` envelope (API_SPECIFICATION.md Section 2.2) is unwrapped once, centrally, by the shared `ApiClient` (10.2), so no individual API service method or calling component ever touches `.data` manually.

### 10.2 Repository Pattern

The `ApiClient` (`core/api/api-client.ts`) is the single low-level HTTP wrapper every domain API service is built on — it is, functionally, the repository-pattern seam for this frontend: it owns base-URL resolution (from `environments/`), envelope unwrapping, pagination `meta` extraction, and typed-error conversion (10.3), so a domain API service method body is typically a one-line call like `this.apiClient.get<AppointmentDTO[]>('/appointments', { params })`. This keeps the *data-access mechanics* (headers, envelope shape, error normalization) in exactly one place, while each domain service still owns its own *domain-specific* method names and request/response typing — the same separation of "generic data access" from "domain meaning" the repository pattern is meant to achieve, expressed via Angular's DI/service composition rather than a formal `Repository<T>` interface (which would be unusual, not idiomatic Angular, for a REST-consuming SPA).

### 10.3 Error Handling

`ApiClient` catches every `HttpErrorResponse`, maps API_SPECIFICATION.md Section 2.3's error envelope into a typed `ApiError` class (`{ code, message, details, requestId, httpStatus }`), and re-throws that typed error — so every calling store/component catches a consistent, typed shape regardless of which endpoint failed, never a raw `HttpErrorResponse`. A small number of error codes are handled **globally**, inside `ApiClient`/`ErrorInterceptor` (10.6), rather than by each individual caller: `401` triggers the refresh flow (Section 5.7) before the caller ever sees an error; `402 TENANT_SUSPENDED` triggers a redirect to `/app/billing` (Section 3.3) app-wide; `403 FORBIDDEN` on a route-level navigation triggers a redirect to `/403`. Every other error code is left for the calling feature to handle contextually (Section 8.3, Section 15).

### 10.4 Retry Strategy

- **Idempotent `GET` requests**: a single automatic retry on network-level failure only (connection dropped, DNS blip — not on any `4xx`/`5xx` HTTP response, which represents a real server answer, not a transport failure), via RxJS's `retry({ count: 1, delay: 500 })` applied inside `ApiClient`'s base `get()` method — invisible to callers.
- **Non-idempotent `POST`/`PATCH`/`DELETE` requests are never automatically retried by the frontend** — this is a deliberate, important rule, not an oversight: automatic retry of a write request is exactly the failure mode API_SPECIFICATION.md Section 2.13's `Idempotency-Key` mechanism exists to make *safe*, but safety at the server doesn't mean the frontend should casually retry — a retried write still needs the *same* `Idempotency-Key` to be safe, and blanket automatic-retry logic in the generic HTTP layer is the wrong place to guarantee that (the responsibility belongs to the specific store method that generated the key in the first place, if it chooses to offer a manual "Retry" action at all — see `ErrorState`'s `retryCallback`, Section 7.2, which is user-initiated, not automatic).
- **`503 UPSTREAM_UNAVAILABLE`** is the one response code where a **user-facing retry affordance** (not an automatic one) is always surfaced, via `ErrorState`, since it specifically signals a transient third-party outage (API_SPECIFICATION.md Section 2.3.1) worth trying again shortly.

### 10.5 Caching

Covered in depth in Section 9.5 (state-management caching) — the API layer itself is **stateless and uncached**; every `ApiClient` call hits the network every time it's invoked. Caching, where it exists, is a decision made one layer up, in the signal store, never inside the API/data-access layer — keeping `ApiClient`'s contract simple ("call this URL, get this typed data or this typed error") and avoiding two competing cache mechanisms at different layers.

### 10.6 Request Interceptors

Registered in a fixed, documented order (order matters — each interceptor assumes the ones before it have already run):
1. **`AuthInterceptor`** — attaches `Authorization: Bearer <accessToken>` from `AuthStateService`; on a `401` response, triggers the refresh-and-retry flow (Section 5.7).
2. **`RequestIdInterceptor`** — generates and attaches an `X-Request-Id` header per API_SPECIFICATION.md Section 2.9 (enabling a support engineer to correlate a specific frontend action with backend logs via a single ID visible in the browser's network tab).
3. **`IdempotencyKeyInterceptor`** — for the specific, documented set of endpoints requiring one (API_SPECIFICATION.md Section 2.13), generates a UUID and attaches `Idempotency-Key` **once per logical user action** (not once per HTTP attempt — a manual "Retry" click after a failure reuses the same key, a fresh form submission generates a new one; this distinction is the interceptor's core responsibility and the reason it isn't simply a static header attached at the `ApiClient` level).
4. **`LoadingInterceptor`** — increments/decrements `UiStateService.hasPendingRequests` (Section 9.6).

### 10.7 Response Interceptors

Angular's `HttpInterceptorFn` model handles both request and response phases in one function (there is no separate "response interceptor" registration point as in some other HTTP client designs) — the *response-side* behavior of the above interceptors: `AuthInterceptor` inspects the response for `401` (retry trigger); `ErrorInterceptor` (a fifth, response-focused interceptor) normalizes every non-2xx response into the typed `ApiError` (10.3) before it reaches `ApiClient`'s subscriber, and separately triggers `ToastService.error()` for any error **not** already handled by a more specific mechanism (10.3's global-handling list) — ensuring no API failure is ever silently swallowed with zero user-visible feedback, even from a code path the implementing engineer forgot to add explicit error UI to.

### 10.8 Loading Indicators

Two tiers, matching Section 9.6: **(1) global** — the thin top-of-page progress bar driven by `LoadingInterceptor`/`UiStateService.hasPendingRequests`, giving constant, low-intrusion feedback that *something* is happening, on every request without exception; **(2) local** — each `Button`'s `loading` input (Section 7.1) and each list view's `Skeleton` state (Section 7.1), driven by the specific store method's own `loading` signal (Section 9.6), giving precise, contextual feedback about *what* is loading. The global indicator is never the *only* feedback for a user-initiated action (e.g., clicking "Save" always also disables/loading-states that specific button) — it exists purely as an ambient signal, not a substitute for local feedback.

---

## 11. UI Design System (Architectural Overview Only)

**Scope note:** per instruction, the full token specification — exact color values, type scale, spacing scale — is the subject of the dedicated **UI/UX Design System & Design Tokens** document that follows this one. This section fixes only the *categories* and the *mechanism* by which the design system will plug into this architecture, so that document has a defined seam to fill rather than needing to also redesign how tokens reach components.

| Category | Architectural Approach (mechanism, not values) |
|---|---|
| **Color Palette** | Defined as CSS custom properties (`--color-*`) in `styles/tokens.css`, consumed by Tailwind via `tailwind.config.js`'s `theme.extend.colors` referencing those variables (never raw hex codes hardcoded in component templates) — this indirection is what makes Dark Mode (below) and any future rebrand a token-file change, not a component-by-component find-and-replace. |
| **Typography** | A type-scale of CSS custom properties (`--font-size-*`, `--font-weight-*`, `--line-height-*`) mapped into Tailwind's `theme.extend.fontSize`; one webfont family for UI text, loaded via `assets/fonts/` with `font-display: swap` (Section 14.3). |
| **Spacing** | Tailwind's default `4px`-base spacing scale is adopted as-is (not overridden) — deliberately not reinventing a spacing scale Tailwind already provides well, reserving custom-token effort for genuinely brand-specific decisions (color, type). |
| **Grid System** | CSS Grid/Flexbox via Tailwind utility classes exclusively — no custom grid framework; the Dashboard Layout's sidebar+content structure (Section 4.2) is itself a CSS Grid with named areas for exactly this reason. |
| **Breakpoints** | Tailwind's default breakpoint set (`sm`/`md`/`lg`/`xl`/`2xl`), used consistently as the single source of responsive truth referenced throughout Section 13 — no separate, competing breakpoint definitions in component-local CSS. |
| **Border Radius** | A small token set (`--radius-sm/md/lg/full`) mapped into Tailwind's `borderRadius` theme, applied consistently by the component library (Section 7) rather than each component choosing its own radius value. |
| **Elevation** | A shadow-token scale (`--elevation-1` through `--elevation-4`) mapped into Tailwind's `boxShadow` theme, used by `Card[elevated]`, `Modal`, `Drawer`, `Dropdown`/`DatePicker`/`TimePicker` overlays (Section 7) — overlay components always use the *same* elevation step, so layering depth reads consistently across the whole app. |
| **Animation** | A small set of shared transition tokens (`--transition-fast/base/slow` durations + a standard easing curve) consumed by every component with enter/exit states (`Modal`, `Drawer`, `Toast`, `Dropdown`) — and respecting `prefers-reduced-motion` globally (Section 12.1), a single media-query override in `styles/tokens.css` that disables/shortens every transition token at once rather than requiring per-component handling. |
| **Dark Mode / Light Mode** | Implemented via a `data-theme="dark"`/`"light"` attribute on `<html>`, toggled by `UiStateService` (Section 9.3, persisted to a first-party cookie or the backend's future user-preference field — not `localStorage` alone, to survive across devices once a preference-sync endpoint exists) — every color token in `styles/tokens.css` is defined twice, once per `data-theme` value, so components never contain their own dark-mode conditional logic; they simply reference the token, and the token resolves differently per theme. Default follows the OS-level `prefers-color-scheme` on first visit, then respects an explicit user override thereafter. |
| **Icons** | Lucide Icons exclusively (fixed by the stack) via a single shared `IconComponent` wrapper (`shared/components/primitives/icon`) that resolves an icon-name string to the corresponding Lucide SVG — so icons are referenced by name (`iconLeft="calendar"`) from every other component's inputs (Section 7) rather than each feature importing raw SVGs individually, keeping icon usage auditable and tree-shakeable. |

---

## 12. Accessibility

### 12.1 WCAG 2.2 AA — Target and Baseline

**WCAG 2.2 Level AA is the platform's accessibility target for every screen**, not an aspiration reserved for a later pass — Section 7's per-component accessibility notes are the concrete, component-level expression of this commitment, and this section states the cross-cutting rules that apply *above* the component level. This target was chosen (over AAA, which includes several criteria impractical for a data-dense SaaS dashboard, e.g., enhanced contrast ratios that conflict with a usable dense-table design) as the right, industry-standard bar for a B2B SaaS product, consistent with PROJECT_REQUIREMENTS.md Section 9's NFR target.

### 12.2 Keyboard Navigation

Every interactive element in the component library (Section 7) is reachable and operable via keyboard alone, with no exceptions — this is why so many of Section 7's components are explicitly built on Angular CDK's `A11yModule`/`ListKeyManager`/`FocusTrap` primitives rather than hand-rolled: those primitives are what make full keyboard-operability (arrow-key list navigation, `Escape`-to-close, `Tab`-order correctness) a structural property of the shared library rather than something re-verified per feature. Global keyboard shortcuts are deliberately **not** introduced at MVP (a common source of conflicts with screen-reader/browser shortcuts if done carelessly) — standard `Tab`/`Shift+Tab`/`Enter`/`Space`/`Escape`/arrow-key conventions are the full extent of this app's keyboard model.

### 12.3 Focus States

Every focusable element has a **visible** focus indicator (`:focus-visible`, not `:focus`, so mouse clicks don't show a distracting ring while keyboard focus still does) styled via a shared `--focus-ring` token (Section 11) applied consistently by the component library — never `outline: none` without a replacement, a common and explicitly disallowed anti-pattern in this codebase. Focus is programmatically managed (not just visually styled) at every point content appears/disappears dynamically: overlay open → focus moves into it (Section 7.2's `Modal`/`Drawer`/`Dropdown` focus-trap guarantee); overlay close → focus returns to the triggering element; route navigation → focus moves to the new page's primary heading (`h1`, via a shared `RouteFocusService` that all `pages/` components use), so a keyboard/screen-reader user's focus never gets silently lost or stranded on route change, a common SPA accessibility failure this architecture addresses structurally.

### 12.4 ARIA Labels

Applied per Section 7's per-component notes — icon-only buttons always carry `ariaLabel` (enforced), form fields always have programmatically-associated labels (never placeholder-as-label, a common but non-compliant pattern), and every custom interactive widget (Dropdown, Tabs, Calendar, Date/Time Picker) implements the correct ARIA design pattern for its widget type rather than an ad hoc approximation. `aria-label`/`aria-labelledby`/`aria-describedby` usage is reviewed as part of the same code-review checklist that covers the smart/dumb component boundary (Section 1.4) — accessibility review is not a separate, later pass but part of the same PR review every component change goes through.

### 12.5 Screen Reader Support

Beyond the per-component `aria-live` regions already specified (`Toast`, `SearchBar`'s debounce indicator, `Skeleton`'s loading announcement, `ErrorState`, `Input`'s error message — Section 7), two cross-cutting rules: **(1) status changes are always announced, never conveyed by visual change alone** (a `Badge` color change from `PENDING` to `CONFIRMED` is always accompanied by an `aria-live="polite"` announcement at the point of the action that caused it, e.g., "Appointment confirmed," not just a silently-recolored badge); **(2) route changes announce the new page title** via the same `RouteFocusService` (12.3) that manages focus — a screen-reader user navigating this SPA gets an experience structurally equivalent to a traditional multi-page site's natural "new page, new title announced" behavior, which SPAs notoriously break by default if not deliberately engineered.

### 12.6 Contrast Ratios

Every text/background color pairing in the design system (Section 11) is verified against **WCAG AA's 4.5:1 (normal text) / 3:1 (large text, ≥18pt or ≥14pt bold) minimums** at the token-definition stage — this verification is a deliverable of the upcoming Design System document (Section 11's scope note), not re-derived per component here; this architecture's obligation is ensuring components **consume** tokens rather than introducing ad hoc colors that could bypass that verification (Section 11's "never raw hex codes hardcoded in component templates" rule is the structural enforcement mechanism). `Badge`'s label-plus-color (never color-alone) requirement (Section 7.1) and `Charts`'s data-table fallback (Section 7.2) are the two component-level features most directly motivated by contrast/color-independence concerns specifically.

---

## 13. Responsive Design

### 13.1 Design Priority

**Desktop-primary, not desktop-only.** The dashboard's core users (Salon Owner/Manager/Staff, PROJECT_REQUIREMENTS.md Section 6) predominantly work from a desktop or tablet at the front desk, per that document's personas — but a Staff member checking today's schedule from a phone between clients, or an Owner reviewing analytics on a train, are realistic scenarios this architecture designs for from the start, not retrofits. The design priority order is therefore **Desktop → Tablet → Mobile**, the reverse of a typical consumer-app "mobile-first" approach, and a deliberate choice justified by who actually uses this product and how (contrasted explicitly with the fully mobile-first posture that would suit, e.g., the end-customer-facing WhatsApp experience — which has no web UI at all, per SYSTEM_ARCHITECTURE.md's channel design).

### 13.2 Desktop (`lg`/`xl`/`2xl`, ≥1024px)

Full Dashboard Layout (Section 4.2): persistent, expanded sidebar; multi-column detail pages (e.g., Customer Detail's two-column profile+history layout, Section 6.3); `Table` components show their full column set; the Appointments Calendar (Section 6.2) defaults to week view, which needs the horizontal room only a desktop viewport comfortably provides.

### 13.3 Tablet (`md`, 768–1023px)

Sidebar defaults to its **collapsed (icon-only) state** rather than the mobile drawer pattern — tablet width is enough to keep the sidebar persistently visible and useful as quick-navigation, just not enough to afford its fully-labeled expanded width alongside content; a single tap/click expands it temporarily (overlay, not push) when needed. Multi-column detail pages collapse to a single column with the secondary content (e.g., Customer Detail's history tabs) moved below the primary content rather than beside it. The Calendar defaults to day view instead of week.

### 13.4 Mobile (`sm` and below, <768px)

Sidebar becomes the slide-over `Drawer` described in Section 4.5, triggered by a hamburger icon; the top bar becomes the primary, persistently-visible navigation surface. `Table`-based list views (Appointments list, Customers, Invoices) switch to a **stacked-card representation** at this breakpoint — not a horizontally-scrolling table, which is a common but poor mobile pattern this architecture explicitly avoids — each row's key fields re-rendered as a compact `Card` (Section 7.1) via the same `Table` component's responsive internal template switch (a `@if` on breakpoint inside `Table`'s own template, not a second, separately-maintained mobile table component — keeping the sort/filter/pagination *logic* single-sourced even as its *presentation* adapts). The Calendar defaults to a single-day agenda-list view rather than a grid, since a true calendar grid is not usably dense at phone width. Forms stack to single-column full-width fields; the Appointments booking `Drawer` becomes `size="full"` (effectively a full-screen sheet) on mobile rather than a partial side panel.

### 13.5 Sidebar Behavior Summary

| Breakpoint | Sidebar State | Trigger to Change |
|---|---|---|
| Desktop | Persistent, expanded | Manual user toggle to collapsed (preference persisted via `UiStateService`) |
| Tablet | Persistent, collapsed (icon-only) | Manual tap-to-expand (temporary overlay) |
| Mobile | Hidden, drawer-on-demand | Hamburger icon tap |

### 13.6 Navigation Summary Across Breakpoints

Desktop/Tablet: sidebar is the primary navigation surface, top bar is secondary (search/notifications/profile). Mobile: top bar becomes primary (hamburger + page title + notification bell), sidebar drawer is invoked, not persistent — this inversion is intentional, matching how each device class is actually held/used (a phone's limited width makes a persistent nav rail wasteful; a desktop's width makes a persistent nav rail valuable).

### 13.7 Tables at Each Breakpoint

Already detailed in 13.2–13.4: full multi-column table (desktop) → same table, potentially with lower-priority columns hidden via a per-column `hideBelow` config on `Table`'s `columns` input (tablet) → stacked-card representation (mobile). This three-step degradation is a documented, deliberate part of every `Table` usage, not left to each feature to improvise independently.

### 13.8 Cards at Each Breakpoint

`Card`-based layouts (Dashboard KPIs, Employees grid view, Billing plan comparison) reflow via a responsive CSS Grid column count (`grid-cols-4` desktop → `grid-cols-2` tablet → `grid-cols-1` mobile, standard Tailwind responsive utility classes, Section 11) — no component-level breakpoint logic needed for this case, since `Card` itself has no opinion about how many columns its container arranges it into; that responsibility stays with the page-level layout, keeping `Card` simple and reusable in any grid density.

---

## 14. Performance

### 14.1 Lazy Loading

Every feature module (Section 2.1/3.2) is lazy-loaded via the router's `loadChildren`/`loadComponent`, exactly as SYSTEM_ARCHITECTURE.md Section 4.5 first specified — restated here as a hard architectural rule, not a suggestion: **no feature's code is included in the initial bundle**, only `core/`, `shared/` (the parts actually used by the shell — layouts and the small set of always-visible components like `Toast`), and whichever single feature the user's first route resolves to. A `STAFF` user who never visits `/app/billing` or `/admin/*` never downloads that code at all.

### 14.2 Code Splitting

Beyond feature-level route splitting (14.1), two additional split points: **(1) the `Charts` component (Section 7.2)** and its underlying charting library are split into their own lazy chunk, loaded only when `/app/analytics` (or any future chart usage) actually mounts — a charting library is one of the heavier third-party dependencies a dashboard-style app typically pulls in, and most sessions (a Staff member managing bookings all day) never need it; **(2) the `Admin` feature** is split not just as a lazy route but is verified to share zero eagerly-loaded code with the tenant-facing `Dashboard` feature, since the two are used by disjoint sets of users (a tenant user's bundle should never include Admin-console code, and vice versa).

### 14.3 Image Optimization

Salon logo uploads and any future customer/employee photo support (Section 7.1's `Avatar`) are served via the backend's S3-compatible storage with pre-signed URLs (SYSTEM_ARCHITECTURE.md Section 1.3) already sized/transformed server-side where possible; the frontend additionally uses the native `loading="lazy"` attribute on any below-the-fold image, `srcset`/responsive sizing for the salon logo across layout contexts (top bar vs. Settings preview, Section 6.9), and a shared `LazyImage` directive (`shared/directives/`, Section 2) that renders `Skeleton`'s `avatar`/`card` variant (Section 7.1) as a placeholder until the image resolves, avoiding layout shift.

### 14.4 Signals Optimization

Fine-grained reactivity (Section 1.2) is itself a performance strategy, but two additional disciplines keep it effective at scale: **(1) `computed()` signals are kept pure and cheap** — expensive derivations (e.g., re-sorting a large customer list) are memoized inside the `computed()` naturally (signals only recompute when a dependency actually changes, not on every change-detection tick, unlike a method call in a template) rather than recalculated ad hoc in the template; **(2) large, frequently-updating collections (the Messages thread, Section 6.6) use signal-based fine-grained list updates** (`Array` replaced immutably on each new message, with Angular's `@for` track-by-`id` ensuring only the new row actually renders, not the whole list) rather than a naive full-list re-render pattern.

### 14.5 Change Detection Strategy

**`OnPush` is the default change-detection strategy for every component in this application, without exception** — a natural and necessary pairing with the signals-first approach (Section 1.2): signal reads inside a template automatically and correctly participate in `OnPush`'s narrower change-detection model, so this isn't an extra constraint fighting the framework, it's the framework's own recommended, native pairing as of Angular 20. Any component that finds itself needing default (non-`OnPush`) change detection is treated as a signal that it's holding state incorrectly (likely mutating an object/array in place rather than replacing it immutably) and is refactored, not exempted.

### 14.6 Virtual Scrolling

Applied via Angular CDK's `Virtual Scroll Viewport`, used specifically by `DataGrid` (Section 7.2, the virtualized `Table` variant) and the WhatsApp conversation thread (Section 6.6) once a thread's message count grows large (a threshold, e.g., >100 messages in the currently-loaded window, past which the thread view switches from rendering every loaded message to virtualizing them) — **not** applied to `Table` or the Appointments/Customers list views by default, consistent with Section 7.2's `DataGrid` note that most tenant-scoped lists stay small enough that virtualization would be unnecessary complexity for no real benefit (DATABASE_DESIGN.md Section 12's tenant-scoped-cost-decoupling principle, again, applied to frontend rendering cost).

### 14.7 Bundle Optimization

Angular's default production build (ahead-of-time compilation, tree-shaking, minification) is the baseline; on top of that: (1) the third-party dependency list is kept deliberately small and reviewed per addition (a new npm dependency for a single, narrow use case is weighed against building the small amount of logic directly, consistent with Section 1.6's "don't over-abstract" philosophy applied to external code too); (2) Lucide Icons are imported per-icon-by-name (Section 11's `IconComponent`), never as a bulk icon-font/full-library import, so unused icons are tree-shaken; (3) bundle-size budgets are configured in `angular.json` per the CLI's built-in budget-warning mechanism, catching an accidental large-dependency addition at build time rather than after it ships.

---

## 15. Error Handling UX

### 15.1 404 (Not Found)

Rendered by the `PublicLayout`-hosted Not Found page (Section 3.2's wildcard route) for genuinely unmatched routes, **and** re-used as the target of a router-level redirect when the backend returns `404 NOT_FOUND` for a detail-page resource that doesn't exist or belongs to another tenant (API_SPECIFICATION.md Section 2.3.1's identical-response-for-privacy behavior) — the frontend deliberately does not try to distinguish "this route pattern doesn't exist" from "this specific resource ID doesn't exist" in its messaging, mirroring the backend's own privacy-motivated ambiguity rather than undermining it with a more specific frontend message.

### 15.2 500 / Unexpected Errors

A global `ErrorHandler` (`core/error/`, Angular's framework-level uncaught-exception hook, distinct from the HTTP-specific `ErrorInterceptor`, Section 10.7) catches any uncaught client-side exception, logs it (Section 15.6-adjacent telemetry), and renders a full-page fallback ("Something went wrong on our end") with the current `requestId`-equivalent client-side error reference and a "Reload" action — this is the last-resort safety net, not the primary error-handling path (Sections 10.3/10.7/15.3 handle the overwhelming majority of real-world error cases before they'd ever reach this global handler).

### 15.3 API Errors

Handled per the three-tier model already specified in Section 8.3 for forms, extended to non-form contexts: a failed `GET` for a list/detail view renders `ErrorState` (Section 7.2) in place of the content, with `errorCode`-driven messaging (Section 7.2) and a retry action for recoverable cases (`503`); a failed action (button click, e.g., "Cancel Appointment") surfaces via `Toast` (Section 7.2) plus, where relevant, an inline explanation (e.g., `409 INVALID_STATUS_TRANSITION` reverts the optimistic-looking UI state, if any was shown, and explains why in the toast body — "This appointment was already cancelled by someone else").

### 15.4 Offline Mode

The app does not attempt full offline functionality (no service-worker-based offline data access at MVP — consistent with Section 9.5's explicit no-HTTP-caching-layer decision) — but it **does** detect connectivity loss via the browser's `navigator.onLine`/`online`/`offline` events, surfaced as a persistent, dismissable-only-when-reconnected banner ("You're offline — some actions won't work until you're back online") rendered at the `DashboardLayout`/`AdminLayout` level (Section 4), so a user mid-session on a spotty connection gets an honest, ambient signal rather than a confusing scatter of individual failed-request errors with no unifying explanation. Any in-flight write request that fails specifically due to a network error (not a server error) is flagged distinctly in its `Toast` ("Couldn't reach the server — check your connection") rather than using the generic error message.

### 15.5 Validation Errors

Covered fully in Section 8.2/8.3 — restated here only to note the one UX-specific rule: a validation error is **never** presented via `Toast` alone (a toast auto-dismisses, which is inappropriate for something the user needs to act on to proceed) — it is always inline (field-level or form-banner-level, Section 8.3), with `Toast` reserved for transient confirmations and non-actionable failures only.

### 15.6 Empty States

Covered fully in Section 7.2's `EmptyState` component — restated here as a UX principle: **every list/table view in this application has a designed empty state**, not a default "no rows" blank table — with special attention to **first-run empty states** (a brand-new tenant's first visit to Services/Employees/Customers, Section 6.5's example) which carry a direct call-to-action rather than the more neutral "nothing here yet" copy used for a list that's simply been filtered to zero results (e.g., a date-range filter with no matching appointments) — the same component, different `title`/`description`/`actionLabel` configuration per context, per Section 7.2's inputs.

### 15.7 Loading States

Covered fully in Sections 7.1 (`Skeleton`, `LoadingSpinner`) and 10.8 — restated here as the governing UX rule: **every async data fetch has an explicit loading representation**, and the specific choice between `Skeleton` (list/detail views, where previewing layout reduces perceived wait) and `LoadingSpinner` (button actions, small scoped async operations where there's no meaningful layout to preview) is a documented per-context decision (Section 7.1's respective "Purpose" notes), not left to individual engineer preference — keeping the loading vocabulary consistent across the whole app.

---

## 16. Internationalization

The MVP ships in a single language per PROJECT_REQUIREMENTS.md Section 12 (multi-language flagged Medium priority, deferrable), but this architecture is built so adding a language is a **content/config change, not a re-architecture**:

### 16.1 Multiple Languages

Angular's built-in `@angular/localize` i18n pipeline is **not** the chosen mechanism (its compile-time, per-locale-build model is a poor fit for a SaaS where language is a *runtime*, per-tenant/per-user preference, not a build-time deployment target) — instead, a lightweight **runtime translation service** (`core/i18n/`) loads a flat key-value JSON file per locale from `assets/i18n/{locale}.json`, exposed via a `translate(key, params?)` function used in templates through a shared `TranslatePipe` (`shared/pipes/`, Section 2). Every user-facing string in every component (Section 7's component library included) is written as a translation-key lookup from day one, even while only `en` exists — so enabling a second language is purely "add `assets/i18n/pt.json` and a locale switcher," never a retrofit hunting down hardcoded strings across the codebase. The active locale is driven by `Tenant.defaultLocale`/`Customer.preferredLanguage`-equivalent user preference (`User` has no locale field yet at PRISMA_SCHEMA.md's current schema — flagged here as a small, additive future migration, not a blocker) falling back to browser locale, falling back to `en`.

### 16.2 Timezone Support

Every timestamp received from the API is UTC (DATABASE_DESIGN.md Section 1.9's storage rule) — the frontend's single `TenantTimezoneDate` pipe (`shared/pipes/`, Section 2) is the **only** place timezone conversion happens, converting a UTC ISO string to the current tenant's `Tenant.timezone` (Section 6's `TenantDTO.timezone`) for display, using the native `Intl.DateTimeFormat` API (no third-party date-timezone library needed for this scope). No component ever performs its own timezone arithmetic — every date/time displayed anywhere in the app goes through this one pipe, making a future bug in timezone handling a one-file fix, not a codebase-wide hunt.

### 16.3 Currency Formatting

A shared `CurrencyCents` pipe (`shared/pipes/`, Section 2, already referenced in Section 6.5) converts a `priceCents`/`amountCents`-style integer (API_SPECIFICATION.md's minor-units convention, mirroring DATABASE_DESIGN.md Section 1.11's money-storage rule) plus a `currency` ISO-4217 code into a locale-correct display string via `Intl.NumberFormat(locale, { style: 'currency', currency })` — never manual string concatenation of a currency symbol, which breaks for RTL currencies, multi-symbol currencies, or locale-specific placement/grouping conventions.

### 16.4 Date Formatting

A shared `TenantDateFormat` pipe family (short date, long date, date+time, relative time — "2 hours ago" via a `RelativeTime` pipe already referenced in Section 2's folder structure) built on `Intl.DateTimeFormat`/`Intl.RelativeTimeFormat`, parameterized by the active locale (16.1) — so a future non-English locale automatically gets correct date-format conventions (day/month order, month-name localization) without any per-locale custom formatting code.

---

## 17. Security

### 17.1 XSS Prevention

Angular's default output-sanitization (SYSTEM_ARCHITECTURE.md Section 9.9) is relied upon as the primary defense — every binding in this application uses standard interpolation/property binding, which Angular auto-sanitizes; `[innerHTML]` and the `bypassSecurityTrust*` APIs are **prohibited without an explicit, reviewed exception**, and no current screen in Sections 6/7 requires one (there is no rich-text/HTML-rendering feature in this application's MVP scope — AI/customer message content, Section 6.6, is always rendered as plain text via interpolation, never as HTML, which is itself a deliberate security choice given that message content ultimately originates from an external, untrusted party — the WhatsApp customer). The Content-Security-Policy header (API_SPECIFICATION.md Section 2.11, `default-src 'none'` on the API; the frontend's own CSP, served by Nginx per SYSTEM_ARCHITECTURE.md Section 10.3, is a separate, appropriately-scoped policy allowing the app's own script/style/connect sources) is the second layer of defense.

### 17.2 Secure Storage

The access token lives **only** in an in-memory signal (`AuthStateService`, Section 5.6) — never `localStorage`, never `sessionStorage`, never a non-httpOnly cookie — eliminating the primary XSS-token-theft vector for the short-lived credential; the long-lived refresh token lives exclusively in the httpOnly, `SameSite=strict` cookie set and read entirely server-side (SYSTEM_ARCHITECTURE.md Section 7.2), meaning **no frontend JavaScript ever has access to the refresh token's value at all** — not a storage-location choice so much as a complete absence of frontend-side access, the strongest possible posture against theft of the long-lived credential. No other sensitive value (passwords, payment details — the latter never touch this frontend at all, per Stripe Checkout's hosted-flow redirect model, API_SPECIFICATION.md Section 13) is ever persisted client-side beyond the lifetime of the form field holding it.

### 17.3 Route Protection

Fully specified in Sections 3.1/5.8 — restated here as the governing security principle: **every route guard is a UX convenience, and the backend is the actual authority** (API_SPECIFICATION.md Section 2.14's identical principle, mirrored here) — a route guard prevents an honest user from wandering somewhere confusing, it does not and cannot prevent a determined attacker from calling the API directly, which is why every guarded route's underlying API calls are independently, redundantly authorized server-side regardless of what the frontend router decided to render.

### 17.4 Permission-Based UI

Fully specified in Section 5.9 (`PermissionService`) — restated here with the same caveat as 17.3: hiding a button a user's role can't use is good UX (it prevents a confusing "why did that fail" moment), and is explicitly **not** a substitute for backend authorization, which independently re-checks every permission on every request. The frontend's permission-based rendering and the backend's permission enforcement are required to stay in sync (the same named-permission strings, SYSTEM_ARCHITECTURE.md Section 7.4, used on both sides) but are two separate, redundant implementations by design — a UX layer and a security layer, never conflated into one.

### 17.5 Sensitive Data Handling

Beyond tokens (17.2): customer phone numbers and any PII rendered in the UI (Customers, Conversations, Appointments — Section 6) are never logged to the browser console in production builds (a lint rule/build-step strips `console.log` statements from production bundles); the client-side error-telemetry mechanism (15.2) is configured to redact known-PII-shaped fields (phone numbers, email addresses) from any automatically-captured error context before it's ever transmitted, consistent with PROJECT_REQUIREMENTS.md Section 20's data-privacy compliance posture extended down to the frontend's own error-reporting pipeline, which is otherwise an easy, commonly-overlooked place for PII to leak into a third-party logging/monitoring tool.

---

## 18. Deliverables

### 18.1 Complete Page List (28 Pages)

**Public (4):** Landing, Pricing, 403, 404/Maintenance-adjacent status pages.
**Auth (7):** Login, Register, Forgot Password, Reset Password, Verify Email, Google OAuth Callback, Accept Invitation.
**Onboarding (1):** Onboarding Wizard.
**Dashboard-scoped (14):** Dashboard Home, Appointments (Calendar/List), Appointment Detail, New Appointment, Customers List, Customer Detail, Employees List, Employee Detail, Services List, Service Detail, Conversations Inbox, Conversation Thread, Analytics, Billing, Settings, Profile, Notifications. *(counted as 14 distinct routed pages per Section 3.2's table, with Appointments' two view modes counted as one page per Section 6.2.)*
**Admin (3):** Tenants List, Tenant Detail, Users, System Health. *(4 admin pages)*

Total: **28 distinct routed pages**, exactly matching Section 3.2's route table (excluding the wildcard/redirect-only entries).

### 18.2 Component Hierarchy (Summary)

```
AppComponent
├── PublicLayout          → Landing, Pricing, 403, 404, Maintenance pages
├── AuthLayout             → Login, Register, Forgot/Reset Password, Verify Email, Google Callback, Accept Invitation
├── DashboardLayout
│   ├── Sidebar (role-filtered nav, Section 4.6)
│   ├── TopBar (search, notifications bell, user menu)
│   └── <router-outlet>   → Dashboard Home, Appointments, Customers, Employees,
│                            Services, Conversations, Analytics, Billing,
│                            Settings, Profile, Notifications, Onboarding
└── AdminLayout
    ├── Sidebar (Tenants / Users / System)
    ├── TopBar ("Platform Admin" badge)
    └── <router-outlet>   → Admin: Tenants, Tenant Detail, Users, System

Every page (smart component) composes:
Page
├── Feature-local components (Section 2.1, e.g. AppointmentForm, AvailabilityGrid)
│   └── Shared domain components (Tier 2, e.g. CustomerPicker, ServicePicker, StatusChip)
│       └── Shared primitives (Tier 1, Section 7 — Button, Input, Table, Modal, …)
```

### 18.3 Navigation Map

```
/  ──────────────────────────────► Landing (public)
/pricing ────────────────────────► Pricing (public)
/auth/* ─────────────────────────► Login, Register, Forgot/Reset Password, Verify Email, Google Callback, Accept Invitation
/app/onboarding ─────────────────► Onboarding Wizard (Owner, first-run gate)
/app/dashboard ──────────────────► Dashboard Home (Owner, Manager, Staff)
/app/appointments[...] ──────────► Appointments (Owner, Manager, Staff — scoped)
/app/customers[...] ─────────────► Customers (Owner, Manager, Staff)
/app/employees[...] ─────────────► Employees (Owner, Manager, Staff — read; mutate: Owner/Manager)
/app/services[...] ──────────────► Services (Owner, Manager, Staff — read; mutate: Owner/Manager)
/app/conversations[...] ─────────► Conversations / WhatsApp Inbox (Owner, Manager, Staff)
/app/analytics ──────────────────► Analytics (Owner, Manager)
/app/billing ────────────────────► Billing (Owner — view: + Manager; exempt from TenantActiveGuard, Section 3.3)
/app/settings ───────────────────► Settings (Owner, Manager)
/app/profile ────────────────────► Profile (any authenticated role)
/app/notifications ──────────────► Notifications (any authenticated role)
/admin/* ────────────────────────► Tenants, Users, System (Super Admin only, disjoint from /app/*)
/403, /404, /maintenance ────────► Status pages (public)
```

### 18.4 Recommended Folder Structure

Fully specified in Section 2 — summarized: `core/` (singletons) → `shared/` (primitives, domain components, directives, pipes, validators, models — Section 1.6's two-tier reuse model) → `layouts/` (4 shell components, Section 4) → `features/` (13 feature-first vertical slices, Section 1.5, each internally structured per Section 2.1's `pages/components/services/state/models` pattern).

### 18.5 Feature Modules (Lazy-Loaded)

`auth`, `onboarding`, `dashboard-home`, `appointments`, `customers`, `employees`, `services`, `conversations`, `billing`, `notifications`, `settings`, `profile`, `analytics`, `admin` — **14 lazy-loaded feature route configs**, each mapping to exactly one SYSTEM_ARCHITECTURE.md backend module boundary (Section 3) or a close frontend-specific grouping (`onboarding`, `dashboard-home`, `profile` have no 1:1 backend module but compose from several — Section 6).

### 18.6 Shared Modules

Not literal NgModules (Angular 20's standalone-component model makes traditional `SharedModule` re-export barrels unnecessary and actively discouraged, SYSTEM_ARCHITECTURE.md Section 4.3) — "shared modules" here means the `shared/` folder's four importable groups: **primitives** (Section 7, Tier 1), **domain components** (Section 1.6, Tier 2), **pipes/directives/validators** (Sections 8.5, 16), and **models** (Section 2, the DTO type mirror of API_SPECIFICATION.md Section 3). Each is imported directly, component-by-component, where needed — never as a single monolithic barrel import.

### 18.7 Known Gaps Carried Forward

Mirroring API_SPECIFICATION.md Section 18.2's own gap list, since each has a direct frontend consequence: (1) no `POST /files` upload endpoint yet specified — blocks the Settings logo-upload flow (Section 6.9) and `Avatar` image-upload paths from being fully implementable as designed; (2) no `ServiceCategory` CRUD endpoints — the Services page's category grouping (Section 6.5) can display but not manage categories until this lands; (3) invitation-acceptance endpoint — the `/auth/accept-invitation/:token` route (Section 3.2, 18.1) is speculatively designed against an endpoint that doesn't yet exist in API_SPECIFICATION.md and needs to be confirmed before this page's implementation begins. None of these block approval of this document's architecture, which is designed to accommodate each once resolved, but all three should be closed before the corresponding page enters development.

---

## Document Status & Next Steps

This document defines **frontend architecture only** — no Angular code, no component implementations, and (per instruction) no finalized design-token values have been produced.

**Key decisions made in this phase requiring explicit sign-off before proceeding:**
1. Signals-first state management with RxJS scoped strictly to the `HttpClient` boundary and genuine async event-stream cases (Section 1.3/9) — no NgRx/Akita.
2. Feature-first folder structure with a two-tier shared-component model (Tier 1 primitives / Tier 2 domain components, Section 1.6) — mirrors the backend's own module boundaries.
3. Cursor-vs-offset pagination UI handled by two genuinely different components (`Pagination` vs. cursor "Load more," Section 7.1) rather than one component pretending to unify both.
4. Desktop-primary responsive priority (Section 13.1) — a deliberate departure from mobile-first, justified by the actual user personas.
5. `OnPush` change detection everywhere, paired with signals, as a non-negotiable default (Section 14.5).
6. Runtime (not compile-time) i18n via a custom translation service, chosen specifically because language is a per-tenant runtime preference, not a build-time target (Section 16.1).
7. Three known API gaps (file upload, ServiceCategory CRUD, invitation acceptance) are designed-around but flagged as blockers for their respective pages' actual implementation (Section 18.7).

**Recommended next step:** Proceed to the **UI/UX Design System & Design Tokens** document — finalized color palette, type scale, spacing scale, component visual specifications, and Figma-equivalent source of truth — once this document is approved, filling in the mechanism Section 11 defined here.

**Awaiting your approval before proceeding.**

