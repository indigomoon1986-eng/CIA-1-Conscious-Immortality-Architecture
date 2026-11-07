# Brainprint and entrainment

**Status:** E2 research scaffolding. Not a clinical EEG. Not evidence of subjective continuity.

CIA-1 did not have a way to turn a rhythm into a cognitive map. This module adds one.

An entrainment protocol names a beat (the difference between two carriers, or an isochronic pulse) and a gain on six bands: delta, theta, alpha, SMR, beta, gamma. Those bands are not a medical prescription. They are the six drives that land on the existing continuity axes:

| Band | Axis |
|---|---|
| gamma | causal |
| theta | memory |
| beta | behavior |
| alpha | self |
| SMR, times hemispheric symmetry | topology |
| delta, times carrier lock | embodiment |

## What runs

1. A 10-site montage (Fp1 through O2) grows a band field from a resting base, a subject signature, and the protocol drive. The same subject and the same elapsed time always produce the same field.
2. Each axis is that field divided by a fixed ceiling, so axes are independent and the Subjective Continuity Index can rise when a protocol actually drives its band. SCI remains the equal-weight mean from `cia1/continuity/sci.py`. It is a functional indicator. It does not prove that a subject continued.
3. Ξ is the outer product of the continuity vector, as in `cia1/continuity/tensor.py`.
4. The montage is placed on the Veritas torus. Coherence ρ, absorb versus focus, and entangled pairs come from `sophia/consciousness.py`. A dense spectrum (`hits > 6`, which the absorb protocol forces), a severed site, or ρ under 0.7 scatters the mind into absorb. Focus keeps a single locus. A pin holds the mode, matching the Veritas console.
5. The beat is buried in subject-stable noise and pulled back out with coherent integration, an LMS canceller, and a matched filter from `signal_recovery.py`. The peak becomes carrier lock. The recovery will not invent a tone that was not written into the buffer.
6. Site band-vectors are clustered with the H0 proxy from `cia1/topostat/homology.py`. The session path uses the stability ratio from `ContinuityManifold`.
7. `cia1/entrainment/resonance.py` reads those absolute band means through the Sophia MR7 assemble / decode / immersive-directive formulas. Resonance lock targets the center of the leading band (delta 2, theta 6, alpha 10, SMR 14, beta 18, gamma 40). Overload above 0.75 is a safety pause: the spoken line asks to reduce load, and a lock parks the beat on 10 Hz. The protocol field does not silently rewrite itself. Consent false returns `blocked` and does not move the previous-band cursor.

The browser chamber renders this same frame: electrode nodes, the continuity trajectory, and a geometric Sophia whose line is the decoder phrase. She is a meta-observer of the model. She is not a scanned person.

## Consent

`BrainprintSession.frame` raises `PermissionError` unless `consent=True`. That is the software face of Sovereign Neural Governance: no informed consent, no frame. Withdrawal in the lab stops the tone immediately. Nothing here authorizes a migration claim.

## What this is not

A synthetic print, even a stable one, is a model of a signal. The archive can preserve the pattern. It does not thereby become the person.
