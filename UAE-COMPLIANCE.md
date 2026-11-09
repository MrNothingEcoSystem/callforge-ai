# UAE Compliance Status

This document records engineering gates, not legal advice or regulatory certification.

## Current state

The v0.2 implementation stores simulated compliance fields and exposes a validation tool for development tests. Those values are not authoritative evidence and cannot authorize a real call.

## Required pre-dispatch evidence for future milestones

- Verified business identity and applicable license.
- Authorized UAE carrier route and caller identity.
- Contact permission, consent, and suppression/DNCR result.
- Applicable calling-hours and retry-limit decision.
- AI and recording disclosure requirements.
- Single-use authenticated human approval bound to an immutable call intent.
- Tenant spending and usage limits.

Missing, expired, unverifiable, or conflicting evidence must fail closed. Real provider integration and regulatory declarations require separate human authorization and qualified legal review.
