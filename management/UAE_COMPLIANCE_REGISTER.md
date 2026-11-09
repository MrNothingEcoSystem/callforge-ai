# CALLFORGE M04 — UAE Calling-Compliance Requirements Register

**Role:** COMPLIANCE-ENGINEER (research only) | **Date:** 2026-11-09 | **Status:** NOT legal advice. Rules marked **LEGAL-REVIEW** require qualified UAE counsel before implementation. Rules marked **IMPLEMENTABLE NOW** have clear authoritative text and can be engineered as controls pending counsel sign-off.

**Jurisdiction shorthand:** UAE-F = federal UAE (mainland + most free zones). DIFC/ADGM have separate data-protection regimes. Sector regulators (CBUAE, SCA, insurance) overlay PDPL.

**Core authoritative corpus:**

- Federal Decree-Law No.3/2003 Telecom Law (amended) — https://tdra.gov.ae/en/About/tdra-sectors/telecommunication/departments/regulatory-affairs-department/licensing
- Cabinet Resolution No.56/2024 Telemarketing Regulations — https://uaelegislation.gov.ae/en/legislations/2519 (in force 27 Aug 2024, 60 days after Official Gazette 10 Jun 2024)
- Cabinet Resolution No.57/2024 Penalties — https://uaelegislation.gov.ae/en/legislations/2523
- Federal Decree-Law No.45/2021 PDPL — https://uaelegislation.gov.ae/en/legislations/1972 (in force 2 Jan 2022)
- TDRA VoIP Regulatory Policy v2.0 30 Dec 2009 — https://tdra.gov.ae/-/media/About/regulations-and-ruling/EN/Voice-over-internet-protocol-Regulatory-policy-pdf.ashx
- TDRA Spam Calls Regulatory Policy v1.0 4 Apr 2021 (via du/e& DNCR portals)
- CBUAE Telemarketing Regulation eff. 31 Mar 2026 — https://rulebook.centralbank.ae/en/rulebook/article-9-do-not-call-registry-dncr
- UAE AI Charter 10 Jun 2024 (policy, not statute) — https://uaelegislation.gov.ae/en/policy/details/the-uae-charter-for-the-development-and-use-of-artificial-intelligence

---

## A. Licensing, Carrier & Identity

### R01 Business licensing — prior approval for telemarketing

- **Rule:** Companies licensed in UAE (incl. free zones) must obtain prior approval from Competent Authority (Ministry of Economy overall; CBUAE for banks/financial/insurance; SCA for securities; local economic dept otherwise) before telemarketing. Art.4(1) Res.56.
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 | **Jurisdiction:** UAE-F | **Effective:** 2024-08-27 | **Status:** LEGAL-REVIEW (who is "Competent Authority" per entity/emirate is fact-specific)
- **Engineering:** Gate: campaign cannot be created/dialed without `approval_ref + competent_authority + expiry` attached; tenant-level licence registry.
- **Evidence:** Approval letter/certificate, trade licence, approval scope (products, emirates), renewal alerts.

### R02 Authorized carrier routes / VoIP legality

- **Rule:** Real-time voice (incl. VoIP with PSTN breakout) is a Regulated Activity under Telecom Law; only TDRA licensees (public: e& Etisalat, du) may provide/terminate. Unlicensed VoIP, foreign SIP termination, OR SIM-box bypass prohibited. Closed-group internal VoIP exempt.
- **Source:** https://tdra.gov.ae/en/FAQs ; VoIP Policy v2.0 above | **Effective:** 2009-12-30 (policy), Telecom Law 2003 as amended | **Status:** LEGAL-REVIEW (carrier contracting, SIP trunk provenance)
- **Engineering:** Whitelist carriers: only e& / du SIP trunks (or TDRA-licensed resellers via them). Block unlicensed gateways, international direct routes, grey routes. Log carrier, trunk, route per call.
- **Evidence:** Carrier contracts, TDRA licences of e&/du (renewed 2026-08-09 to 2046-08-08), trunk inventory, route whitelist config.

### R03 Caller identity / CLI

- **Rule:** Marketing calls only from local numbers issued by UAE-licensed operators, registered under caller's commercial licence. No personal, unregistered, spoofed/masked numbers. Art.4(3), 4(13) Res.56. TDRA "Kashif" displays registered entity name.
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 ; https://tdra.gov.ae/en/tdra-initiatives/kashif | **Effective:** 2024-08-27 | **Status:** IMPLEMENTABLE NOW
- **Engineering:** CLI policy table: every outbound CLI ∈ licence-registered inventory; reject dial if CLI not bound to tenant+licence; forbid personal SIMs, *67, foreign CLIs; Kashif name match.
- **Evidence:** Number inventory ↔ trade licence mapping, SIP `From`/`P-Asserted-Identity` logs, Kashif registration proof, spoof-attempt audit.

### R04 Natural-person ban

- **Rule:** Natural persons may not make marketing calls from numbers licensed in own name (Res.56 scope: companies). Separate penalty table for individuals (Res.57 Table 2) — fines + disconnect all numbers in name.
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 ; https://uaelegislation.gov.ae/en/legislations/2523 | **Effective:** 2024-08-27 | **Status:** IMPLEMENTABLE NOW
- **Engineering:** Identity check: agents cannot dial from personal numbers; CRM blocks BYO-number dialing.
- **Evidence:** Agent number assignment log, policy attestation.

## B. Consent, DNCR, Opt-Out, Retry, Hours

### R05 Marketing-call restrictions / definition

- **Rule:** "Telemarketing" = calls (landline/mobile) to consumers to market/advertise/promote, incl. marketing SMS & social-app messages. Applies to all UAE-licensed companies. Consumer-requested calls excluded from "unwanted" definition.
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 | **Effective:** 2024-08-27 | **Status:** LEGAL-REVIEW (scope of "consumer-requested" vs lead-form consent is contested — see R12)
- **Engineering:** Campaign classifier: `marketing` vs `transactional/service` vs `consumer-requested`; marketing path triggers full Res.56 controls, others trigger PDPL only.
- **Evidence:** Campaign classification SOP, call-purpose metadata.

### R06 DNCR / suppression

- **Rule:** Do not call numbers on DNCR (TDRA unified registry, via e&/du portals, SMS DNCR→1012). Art.4(5) Res.56. Operator policies (Aug 2023 update): check DNCR _even if prior consent given_. CBUAE Art.9: financial institutions must give telemarketers live DNCR access, never call DNCR/opt-out.
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 ; https://www.eand.ae/en/smb/dncr.html ; https://www.du.ae/business/do-not-call-registry ; https://rulebook.centralbank.ae/en/rulebook/article-9-do-not-call-registry-dncr | **Effective:** DNCR Sep 2022; strict-even-with-consent Aug 2023; Res.56 2024-08-27 | **Status:** IMPLEMENTABLE NOW (API/portal sync); LEGAL-REVIEW on consent-vs-DNCR conflict for consumer-requested calls
- **Engineering:** Pre-dial DNCR check (batch upload to e&/du portal or API), cache with TTL (daily sync minimum), suppression list = DNCR ∪ internal opt-outs; hard block at dialer, not just CRM warning; re-check before every campaign + daily delta.
- **Evidence:** Portal query logs (file, timestamp, result), suppression audit trail, zero-dial-to-DNCR attestation.

### R07 Consent (PDPL + telemarketing)

- **Rule:** PDPL Art.4: processing personal data without consent prohibited except listed exceptions (public interest, legal obligation, vital interests, legitimate establishment of rights, etc. — _no general legitimate-interests basis_). Art.5: purpose limitation, data minimisation, accuracy, security, retention limits. Art.6: consent must be explicit, unambiguous, informed, freely given, revocable. Telemarketing: Art.5(7) ask consumer if they want to continue _before_ pitching.
- **Source:** https://uaelegislation.gov.ae/en/legislations/1972 ; https://uaelegislation.gov.ae/en/legislations/2519 | **Effective PDPL:** 2022-01-02 | **Status:** LEGAL-REVIEW (lawful-basis mapping per use case; Executive Regulations status as of Nov 2026 still pending per LexisNexis — verify)
- **Engineering:** Consent ledger: `contact_id, purpose, channel, wording version, timestamp, IP/UA, source form, expiry`; Granular per-purpose toggles; withdrawal is instant.
- **Evidence:** Consent records, privacy notice versions (AR/EN), form screenshots, withdrawal logs.

### R08 Calling hours

- **Rule:** Marketing calls only 09:00–18:00 (local). Art.5(3) Res.56. No weekend exemption in text (some secondary sources claim Sun–Thu; official text says 9–6 without day restriction — LEGAL-REVIEW). Fine: AED 10k/25k/50k (1st/2nd/3rd).
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 | **Effective:** 2024-08-27 | **Status:** IMPLEMENTABLE NOW (enforce 09:00–18:00); LEGAL-REVIEW on Fri/Sat/public-holiday scope
- **Engineering:** Dialer clock in Asia/Dubai, hard block outside window, queue next-day; TZ-aware scheduling per contact.
- **Evidence:** Scheduler config, timezone audit, out-of-hours block logs.

### R09 Opt-out / refusal

- **Rule:** If consumer rejects on first call, do not call back about that offer. Art.5(4) Res.56. CBUAE Art.8.3: withdrawal → immediately cease + remove from telemarketing list. PDPL rights: restrict/object/erasure.
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 ; https://rulebook.centralbank.ae/en/rulebook/article-8-methods-obtaining-consent | **Effective:** 2024-08-27 / 2026-03-31 (CBUAE) | **Status:** IMPLEMENTABLE NOW
- **Engineering:** Instant suppression: `refused` outcome → permanent marketing suppression for that offer (and global opt-out if requested); propagate to dialer within seconds; no re-queue.
- **Evidence:** Outcome codes, suppression propagation logs, complaint handling records.

### R10 Retry limits

- **Rule:** Unanswered/ended calls: max 1 callback/day, 2/week. Art.5(5) Res.56. Whether initial call counts toward cap is ambiguous — adopt conservative reading (cap callbacks).
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 | **Effective:** 2024-08-27 | **Status:** IMPLEMENTABLE NOW (conservative cap); LEGAL-REVIEW on counting method
- **Engineering:** Per-contact attempt counter (rolling 24h / 7d), dialer-enforced ceiling, reset auditable.
- **Evidence:** Attempt ledger, dialer policy config.

### R11 Caller disclosure at call start

- **Rule:** At beginning: state company name + purpose; ask if consumer wants to continue before marketing. Art.4(11), 5(7) Res.56. Also disclose data source if asked (Art.4(12)).
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 | **Effective:** 2024-08-27 | **Status:** IMPLEMENTABLE NOW
- **Engineering:** Mandatory opener script (AR/EN): company, purpose, recording notice, continue?; agent/AI cannot proceed to pitch without affirmative.
- **Evidence:** Recordings sampling, script versions, disclosure audit.

### R12 AI disclosure / automated calls

- **Rule:** No standalone federal AI statute as of Nov 2026. Res.56 permits automated systems "in accordance with this Resolution" (Art.5(6) per secondary reporting — verify Arabic text). UAE AI Charter (2024) = policy principles (transparency, human oversight) — no direct penalty. CBUAE AI Guidance Feb 2026 (financial institutions): plain-language AR/EN AI disclosure, human review on request, AI opt-out for high-impact decisions. PDPL Art.18: right to object to automated decisions with legal/similarly significant effect.
- **Source:** https://uaelegislation.gov.ae/en/policy/details/the-uae-charter-for-the-development-and-use-of-artificial-intelligence ; https://loc.gov/item/global-legal-monitor/2026-10-27/united-arab-emirates-ai-oversight-body-approved-central-bank-guidance-issued ; https://uaelegislation.gov.ae/en/legislations/1972 | **Status:** LEGAL-REVIEW (AI-voice disclosure wording, human-handover, automated-decision scope)
- **Engineering (implement now, refine after review):** Opener discloses "automated/AI call", company, purpose, recording, opt-out; one-press human transfer; flag AI-made calls in CDR/recording metadata; human approval gate for any consequential decision.
- **Evidence:** AI disclosure script, handover logs, model/system inventory, human-oversight SOP.

## C. Recording, Data Protection, Retention

### R13 Recording consent / notice

- **Rule:** Record all marketing calls; inform consumer at call start. Art.4(7) Res.56. PDPL: voice = personal data (identifying element); processing needs lawful basis + notice. No separate PDPL call-recording article. Wiretapping/interception also governed by Federal Decree-Law No.34/2021 Cybercrime — LEGAL-REVIEW.
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 ; https://uaelegislation.gov.ae/en/legislations/1972 | **Effective:** 2024-08-27 | **Status:** IMPLEMENTABLE NOW (record + notice); LEGAL-REVIEW (consent vs notice, retention, Cybercrime interplay)
- **Engineering:** Always-on recording for marketing campaigns; pre-pitch notice; if consumer objects — stop, do not pitch (counsel to confirm); encrypted storage, access control.
- **Evidence:** Recording files + notice transcript, retention policy, access logs.

### R14 Data protection / residency / cross-border

- **Rule:** PDPL applies to processing inside UAE + UAE entities processing abroad. Art.22: transfer out only if destination has adequate protection (Data Office-approved) or UAE bilateral/multilateral agreement. Art.23: if no adequacy — contract with PDPL-equivalent obligations, explicit data-subject consent, contract performance, legal claims, judicial cooperation, public interest. No adequacy list / SCC templates published as of Nov 2026 — transfers are high-risk. DIFC Law 5/2020 & ADGM regs differ.
- **Source:** https://uaelegislation.gov.ae/en/legislations/1972 (Arts.22–23) | **Effective:** 2022-01-02 | **Status:** LEGAL-REVIEW (every cross-border flow; adequacy, SCCs, consent wording)
- **Engineering (implement now):** Default UAE-region hosting; inventory all cross-border flows (recordings, CRM, AI providers); block transfers without transfer-register entry; minimise fields (Art.5).
- **Evidence:** RoPA, data-flow map, transfer register, contracts/SCCs, explicit-consent records, hosting-region attestations.

### R15 Breach notification & security

- **Rule:** Controller must notify UAE Data Office immediately on breach harming privacy/security (Art.9 PDPL); cooperate, document. Processor duties Art.8. Sector overlays (CBUAE, health, etc.).
- **Source:** https://uaelegislation.gov.ae/en/legislations/1972 | **Effective:** 2022-01-02 | **Status:** IMPLEMENTABLE NOW (process); LEGAL-REVIEW (sector-specific timelines)
- **Engineering:** Incident runbook, 72h-internal-escalation target (not statutory — confirm), encryption at rest/in transit, least-privilege, audit logs.
- **Evidence:** Security policy, incident log, breach drills.

### R16 Retention

- **Rule:** Marketing call records: keep in form prescribed by Competent Authority, do not destroy until authority-specified period expires + periodic reports (Art.4(6),(8) Res.56). PDPL Art.5: keep only as long as purpose requires; no fixed PDPL retention period. CBUAE Art.10: telemarketing logs in manner/time prescribed by Central Bank.
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 ; https://rulebook.centralbank.ae/en/entiresection/7015 | **Effective:** 2024-08-27 | **Status:** LEGAL-REVIEW (authority-specified period per sector — unknown until authority guidance)
- **Engineering:** Configurable retention per record class (recordings, logs, consent, DNCR checks); legal-hold flag; auto-delete after period + buffer; report generation.
- **Evidence:** Retention schedule, deletion logs, periodic report submissions.

### R17 Data trading / disclosure ban + source disclosure

- **Rule:** Consumer personal data may not be disclosed without consent or traded for reprocessing for marketing (Art.6(4) Res.56). Disclose source of number/data on authority/consumer request (Art.4(12)).
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 | **Effective:** 2024-08-27 | **Status:** IMPLEMENTABLE NOW
- **Engineering:** No list resale/sharing; source field mandatory per contact; disclosure workflow.
- **Evidence:** Source-of-data lineage, sharing register (should be empty), disclosure logs.

### R18 Training, code of conduct, reporting

- **Rule:** Train marketers on ethics + DNCR use (Art.4(2) Res.56); CBUAE: ≥15h training for financial telemarketers before authorisation. Sign code of professional conduct; periodic reports to authority.
- **Source:** https://uaelegislation.gov.ae/en/legislations/2519 ; https://rulebook.centralbank.ae/en/entiresection/7009 | **Effective:** 2024-08-27 / 2026-03-31 | **Status:** IMPLEMENTABLE NOW
- **Engineering:** Training tracker blocking dialing until complete; conduct-code e-sign; report job.
- **Evidence:** Training records (curriculum, hours, assessment), signed codes, submitted reports.

### R19 Penalties exposure (for risk sizing, verify Arabic tables)

- **Rule:** Res.57: company fines AED 10k–150k per violation tier (1st/2nd/3rd); DNCR 50k/75k/150k; no approval 75k/100k/150k; unregistered CLI 25k/50k/75k; data trading 50k/75k/150k; plus warnings, 7–90d suspension, licence cancellation, number disconnection. Individuals: fines from AED 5k + disconnect all numbers in name, repeat up to AED 50k + 12mo ban (per MOE summary). Enforcement live: TDRA reported AED 19m+ fines, 9,433 numbers disconnected (Aug 2026, The National).
- **Source:** https://uaelegislation.gov.ae/en/legislations/2523 ; https://thenationalnews.com/news/uae/2026/08/06/dh19-million-in-fines-issued-and-9400-numbers-disconnected-for-telemarketing-violations/ | **Status:** LEGAL-REVIEW (confirm tables in Arabic official text before quoting externally)
- **Engineering:** Compliance dashboard mapping each control → Res.57 penalty tier for prioritisation.
- **Evidence:** This register + control test results.

---

## Human-approval gates (M04 engine)

| Gate                              | Trigger                                | Default                                                         |
| --------------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| G1 Campaign approval              | Any marketing campaign creation        | Blocked until R01 approval + counsel sign-off on classification |
| G2 DNCR & suppression check       | Every dial list                        | Blocked if any DNCR/opt-out hit remains                         |
| G3 CLI binding                    | Dial attempt                           | Blocked if CLI ∉ licence inventory                              |
| G4 Time window                    | Dial attempt                           | Blocked outside 09:00–18:00 Asia/Dubai                          |
| G5 Retry ceiling                  | Dial attempt                           | Blocked at 1/day, 2/week (unanswered) / 0 after refusal         |
| G6 AI disclosure + human approval | AI calls; any consequential decision   | Disclose; human approves consequential outcomes                 |
| G7 Cross-border transfer          | Any export of recordings/personal data | Blocked until transfer register + Art.22/23 basis logged        |

## Open legal-review backlog

1. Competent-Authority mapping per tenant/emirate/sector (R01).
2. "Consumer-requested" vs DNCR-even-with-consent conflict (R05/R06).
3. Fri/Sat/holiday calling scope (R08).
4. PDPL Executive Regulations status; Art.26 penalties Cabinet Decision (R07/R14).
5. AI-voice disclosure + Art.5(6) automated-systems text in Arabic (R12).
6. Recording objection handling; Cybercrime Law 34/2021 interplay (R13).
7. Cross-border adequacy/SCCs; DIFC/ADGM carve-outs (R14).
8. Authority-specified retention/reporting periods (R16).
9. Res.57 penalty tables — Arabic verification (R19).

_Sources retrieved 2026-11-09. Arabic official texts prevail over English translations. This register is engineering research, not legal advice._
