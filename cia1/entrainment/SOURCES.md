# Sources folded into the brainprint

Relevant Veritas-experimental modules, ported rather than mounted as a submodule
so CIA-1 does not depend on the private radio, FPGA, or DeFi trees.

| CIA-1 module | Upstream | Commit object |
|---|---|---|
| `veritas_coherence.py` | `sophia/consciousness.py` | `dc5cbe5f7b65d7a0b9c66cb7b0fe2465639c5469` |
| `veritas_recover.py` | `control-plane/control/signal_recovery.py` | `6a694b5ef143581ad61009ef082c9c545b81bcf1` |
| `resonance.py` | `sophia_fullstack/monarch_bci_mr7.py` (`_assemble_signal`, `NeuralDecoder.decode`, `build_immersive_brainwave_directive`, `_classify_action`) | `bb4f90a4d55b42b0edea9490f88e4b7b538da95c` |

Upstream repos:

- `indigomoon1986-eng/veritash-experimental` @ `a5b69f987eb2f10f88bfff751c159a619ca09cab`
- `indigomoon1986-eng/sophia-agentic-orchestration` @ the MR7 object above

Left where they were, on purpose:

- `sophia/signal.py` — Sophia frame modem and transmit path. Not used for entrainment.
- `beamform/` — FPGA beamformer and integer FFT twin. Not part of the cognitive map.
- `defi/`, `broadcast/`, `air/` — settlement and radio preamble. Out of scope.
- Sophia-MD-Prime `quantum_dna_bci.py`, `audiovisual_cortex.py`, `biomanifold_engine.py` — the methods that would scan or treat return empty stubs. Not copied, and not presented as medicine.

Signal quality in the lock is carrier lock mixed with Veritas ρ. It is not an electrode SNR.

CIA-1 pieces this module calls by contract, not by import, so it stays on the
standard library:

- Continuity axes and Ξ = v vᵀ from `cia1/continuity/tensor.py`
- Equal-weight SCI from `cia1/continuity/sci.py`
- Trajectory stability from `cia1/topostat/manifold.py`
- H0 component proxy from `cia1/topostat/homology.py`
- Consent gate aligned with `cia1/governance/consent.py`
- Protocol names aligned with `cia1/cpmp` phases

The browser console in the CIA-1 Brainprint lab runs the same numeric model.
