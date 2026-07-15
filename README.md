# gigkaar-server

REST API for the GigKaar mobile app. Implements every endpoint in
`../src/lib/api/endpoints.js`, matching the request/response shapes the mobile
app's old TS DTOs used to define (`src/types/` was removed when the whole
project was converted from TypeScript to plain JavaScript) — so the mobile app
can point at this backend instead of its mock adapter without any client
changes.

Stack: Node.js + Express + MongoDB (Mongoose) + Socket.IO, plain JavaScript
(CommonJS, no build step — runs directly via `node`).

## Setup

```bash
cd server
npm install
cp .env.example .env      # edit MONGODB_URI etc. if not using local defaults
npm run seed               # loads categories + employee verification codes
npm run dev                # starts on http://localhost:4000
```

Requires a MongoDB instance reachable at `MONGODB_URI` (defaults to
`mongodb://127.0.0.1:27017/gigkaar`). Install MongoDB locally, use Docker
(`docker run -d -p 27017:27017 mongo`), or point at a free MongoDB Atlas
cluster.

## Point the mobile app at it

In `gigkaar-mobile/.env` (or `.env.staging` / `.env.production`):

```
EXPO_PUBLIC_USE_MOCKS=false
EXPO_PUBLIC_API_URL=http://localhost:4000
```

On a physical device / Android emulator, `localhost` won't resolve to your
dev machine — use your machine's LAN IP or `10.0.2.2` (Android emulator)
instead.

## Auth in dev

There's no SMS gateway wired up. `POST /auth/otp/request` logs the generated
code to the server console. You can also always use the code in
`DEV_OTP_CODE` (`.env`, defaults to `123456`) regardless of what was
generated — handy for scripted testing.

## What's implemented

- **Auth**: OTP request/verify, JWT access + refresh tokens (refresh tokens
  are rotated and revocation-tracked in Mongo), `/me` profile + roles + push
  token.
- **Catalog**: categories, vendor search (category/area/text/geo-sort),
  vendor detail, vendor reviews.
- **Bookings**: create/list/detail, accept/decline/complete, post-completion
  review. Basic-plan service quota is enforced on accept.
- **Vendor self-service**: register, profile get/patch, availability,
  analytics (computed from real booking data).
- **Agent**: register, dashboard, onboard a vendor, list onboardings.
  Onboarding cashback (249 coins) credits when the *referred vendor actually
  completes their own registration* — a real event, not a fixed timer like
  the mock server used.
- **Employee**: verification-code check, register, dashboard, date-filtered
  stats, referral-users list. Referral attribution is recorded whenever a
  customer/vendor/agent registers with an employee's referral code.
- **Wallet**: summary, ledger, bank accounts, withdraw (agent-scoped, matching
  the current API contract — there's no `/wallet/customer` endpoint yet).
- **Payments**: Razorpay order creation for vendor registration/add-service
  and agent membership. Falls back to mock order ids when `RAZORPAY_KEY_ID`/
  `RAZORPAY_KEY_SECRET` aren't set.
- **Chat**: per-booking message history + send, broadcast over Socket.IO.
- **Realtime**: Socket.IO server, JWT-authenticated handshake, per-user and
  per-booking rooms. Emits `booking.status`, `wallet.credited`,
  `chat.message`.

## Known gaps / before production

- **Razorpay payment confirmation isn't verified.** `/payments/*` creates
  orders but nothing verifies the signature after checkout completes — the
  mobile app's rule that "payment success is confirmed by backend
  (webhook/socket), never a client SDK callback" isn't fully honored yet.
  Add a `POST /webhooks/razorpay` handler that verifies
  `x-razorpay-signature` before marking a vendor/agent as paid.
- **Customer wallet isn't persisted server-side.** The mobile app's
  referral welcome-coin bonus is a client-only Zustand store today (no
  `/wallet/customer` endpoint exists in the contract) — this backend doesn't
  invent one. Add it if that becomes a real requirement.
- **`appInstalls`/`downloads` only count real registrations.** There's no
  referral-link click-tracking endpoint, so this backend reports installs
  equal to registrations rather than the mock's synthetic multiplier — an
  honest number, but lower than what the mock showed.
- **No automated tests yet.**
