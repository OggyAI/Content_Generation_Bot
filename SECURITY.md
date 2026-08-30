# Security Self-Audit

This is a deliberate review of this project's own security posture, written by its author. Nothing here was reported by a third party — these are findings from auditing my own code, and they are documented rather than quietly fixed because the reasoning is more useful than the appearance of a clean bill of health.

**Scope:** this is a single-user, locally-run prototype. It is not deployed, has no users other than me, and serves no traffic. That context lowers the practical severity of everything below, but it does not make any of it correct. Each finding is rated for what it would mean *if this were deployed as-is*, because that is the honest bar.

---

## 1. Unauthenticated local HTTP endpoints

**Finding.** `src/server/index.ts` (144 lines) exposes:

| Route | Effect |
|---|---|
| `GET /jobs` | Lists all jobs |
| `GET /jobs/:id` | Full job state |
| `GET /jobs/:id/gates` | Pending approval gates |
| `POST /jobs/:id/gates/:gateId` | **Approves or rejects an approval gate** |
| `POST /jobs/run` | **Starts a new pipeline run, which spends real money** |
| `GET /assets/*` | Serves the entire output directory as static files |

There is no authentication, no API key, no session, no CORS policy and no rate limiting on any of them. It binds locally, but that is the only thing protecting it — it is unauthenticated by omission, not by design.

**Risk.** Any process on the host, any other user on the machine, or anything that reaches the port through a misconfigured bind address, a container port mapping, or an SSRF chain in another local service can start unbounded paid jobs (`POST /jobs/run` — a single run has cost up to $34), silently approve the human gates that exist specifically to prevent unreviewed spend, and read every generated asset and job state file. The gate-approval endpoint is the sharpest edge: it defeats the pipeline's only cost control.

**Severity if deployed:** Critical. **Actual, as a local-only prototype:** Low-to-moderate.

**Fix.** In order of what I would actually do:
1. Bind explicitly to `127.0.0.1` rather than relying on the default, so it can never accidentally listen on `0.0.0.0`.
2. Require a bearer token from the environment on every mutating route, and reject on mismatch with a constant-time compare.
3. Drop the static `/assets` mount, or scope it to a single job directory rather than the whole storage root.
4. Add a small request limiter on `POST /jobs/run` — one in-flight run at a time is the real invariant, and the code should enforce it rather than assume it.

---

## 2. Plaintext credentials, no secrets manager

**Finding.** All seven credential sets — Anthropic, ElevenLabs, Replicate, Shotstack, Stability AI, Runway, and Cloudflare R2 (access key + secret) — live in a plaintext `.env` read via `dotenv`. There is no secrets manager, no encryption at rest, and no rotation mechanism or schedule.

What is done correctly: nothing is hardcoded in source, `.env` is gitignored (including all `.env.*` variants), and `.env.example` ships placeholders as documentation.

**Risk.** Plaintext on disk means any process running as my user can read all seven. There is no revocation path shorter than manually visiting seven dashboards, and no way to tell whether a key has been read. Compromise is silent and total — an attacker with the R2 secret can write to the asset bucket; with the paid-API keys they can bill my accounts.

This was not hypothetical. During development these keys were pasted into chat sessions in full, which is exactly the kind of casual exposure plaintext `.env` files invite. **All seven were rotated before this repository was published.** That incident is why this section exists.

**Severity:** High.

**Fix.** Move to a managed secret store rather than a file — cloud provider secrets manager if this is ever deployed, OS keychain for local use. Scope each key to the minimum permission it needs, particularly the R2 credential, which currently has more than read-and-write-one-bucket. Set a rotation schedule instead of rotating only after an incident. Add a pre-commit secret scanner so a future `.env` variant cannot be committed by accident.

---

## 3. No schema validation — `zod` installed but never imported

**Finding.** `zod ^3.23.8` is declared in `package.json`. It is imported nowhere in the 5,755 lines of `src/`. Verified: no `from 'zod'` or `require('zod')` anywhere in the tree.

LLM responses are handled by `JSON.parse` inside a try/catch, after which individual fields are defensively defaulted one by one. That is error tolerance — it stops a malformed response from throwing. It is not validation: nothing asserts that a field is the expected type, within an expected range, or present at all before its value flows into the next stage.

**Risk.** Model output is untrusted input, and it crosses a trust boundary here. A malformed or adversarially-shaped response propagates silently: wrong types reach the render spec, absurd durations reach the timeline, unexpected strings reach prompts that are sent back to paid APIs. Failures surface late — at render time, after money has been spent — instead of at the parse boundary. The defaulting also masks genuine upstream problems, because a missing field looks identical to a legitimately empty one.

**Severity:** Medium. Correctness and cost risk more than a direct attack vector, given the single-user context.

**Fix.** Actually use the dependency that is already installed. Define a schema per LLM response shape, parse at the module boundary in `src/modules/claude/`, and fail loudly on mismatch rather than defaulting. The same schemas should validate `topic-input.json` and any request body reaching the Express server. This is the lowest-effort, highest-value item on this list — the library is already in the lockfile.

---

## 4. Public-read R2 asset bucket

**Finding.** Generated images and audio are uploaded to Cloudflare R2 and served from a public base URL. Anyone with a URL can fetch them without credentials.

This one is a genuine trade-off rather than an oversight: Shotstack renders in the cloud and must fetch each asset over public HTTP. Something has to be reachable.

**Risk.** Every asset ever generated is permanently readable by anyone who learns or guesses a URL. Object keys are the only thing standing between the bucket and the open internet, which makes this security-by-obscurity. Nothing expires, so the exposure is cumulative and grows with every run. If a future run generates anything personal or licensed, it is published by default. Rotating the R2 API credential does **not** retract any of this — rotation protects writes, not the reads already made possible.

**Severity:** Medium, and rising over time.

**Fix.** Replace public-read with time-limited presigned URLs scoped to the single render that needs them — this is directly supported by the `@aws-sdk/client-s3` client already in use, so it is a change to how URLs are minted, not a new dependency. Add a lifecycle rule to expire render assets after the job completes. Keep the bucket itself private.

---

## 5. No rate limiting of our own

**Finding.** The system reacts to other services' HTTP 429s via a retry wrapper. It implements no limiter, token bucket, or queue of its own, and its backoff is **linear** (`delay × attempt`), not exponential, despite a code comment claiming otherwise.

**Risk.** Outbound, linear backoff under sustained rate limiting means retrying too fast for too long — it pushes against a limit rather than backing off from it, risking longer throttling or account-level penalties, and burns budget on attempts that were never going to succeed. Inbound, the Express server has no limiter at all, so `POST /jobs/run` can be called in a loop with no ceiling on spend (see finding 1). The only real budget control is a soft per-run cap that warns rather than hard-stops.

**Severity:** Medium — primarily a financial control gap.

**Fix.** Make the backoff genuinely exponential with jitter, and correct the misleading comment. Honour the `Retry-After` header when a service sends one instead of using a fixed schedule. Add a client-side concurrency cap on image generation, which is the burstiest caller. Make the budget cap a hard stop with an explicit override flag rather than a warning.

---

## 6. No dependency scanning, SAST, or CI

**Finding.** No CI pipeline, no `npm audit` in any workflow, no SAST, no Dependabot or equivalent, no pre-commit hooks. Until this repository was created there was no version control at all, so there is also no code review trail for any of the 5,755 lines.

**Risk.** 11 production dependencies and their transitive tree are unmonitored — a published CVE in any of them would go unnoticed indefinitely, since nothing is watching and `package-lock.json` pins versions that will otherwise never move. There is no automated gate between writing code and running it against paid, credential-bearing APIs. `tsc --noEmit` exists as a script but nothing enforces that it passes.

**Severity:** Medium.

**Fix.** Enable Dependabot on this repository — it is a config file and costs nothing. Add a GitHub Actions workflow running `npm audit`, `tsc --noEmit` and `npm run lint` on every push, which also makes the type-check enforced rather than optional. Add a secret-scanning pre-commit hook, which directly backstops finding 2. Enable GitHub's own secret scanning and push protection before this repository is made public.

---

## 7. No audit logging

**Finding.** `src/utils/logger.ts` provides console logging for operator visibility. There is no structured, tamper-evident, or persisted audit log.

**Risk.** Gate approvals are the security-relevant events in this system — they authorise irreversible spend — and there is no durable record of who approved what or when. If the unauthenticated endpoint in finding 1 were ever exploited, there would be no way to reconstruct what happened. Console output is lost when the terminal closes.

**Severity:** Low in a single-user context, but it is what makes every other finding harder to investigate.

**Fix.** Append gate decisions, job starts, and cost events to a structured JSONL file alongside the job state, with a timestamp and the actor. This is a small change that meaningfully improves the answer to "what happened?" for every other item here.

---

## Remediation order

If I were fixing these rather than documenting them, this is the order and the reasoning:

1. **Schema validation (3)** — the library is already installed; highest value per unit of effort.
2. **Auth on the HTTP server (2 routes matter), plus an explicit localhost bind (1)** — closes the sharpest edge, the gate-approval bypass.
3. **Presigned URLs for R2 (4)** — removes a permanent, growing public exposure using a client already in the codebase.
4. **CI with `npm audit` + type-check, Dependabot, and push protection (6)** — cheap, automated, and prevents regression on everything else.
5. **Secrets manager and a rotation schedule (2)** — the largest change; the interim mitigation (gitignore + completed rotation) is already in place.
6. **Exponential backoff with jitter and a hard budget stop (5)**.
7. **Structured audit log for gate decisions (7)**.

## Reporting

This is a personal project with no users. If you find something I have missed, open an issue — I would rather know.
