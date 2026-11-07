"""Print a consented brainprint at rest and after a short drive.

Research output only. Requires informed consent or it refuses.
"""

from cia1.entrainment.brainprint import BrainprintSession
from cia1.entrainment.protocols import PROTOCOLS_LIST


def main() -> None:
    subject = "did:monarch:example"
    print(f"subject {subject}")
    for protocol in PROTOCOLS_LIST:
        rest = BrainprintSession(subject, protocol.id, consent=True).frame(0)
        driven = BrainprintSession(subject, protocol.id, consent=True).frame(24)
        axes = " ".join(
            f"{name[:3]}={value:.2f}" for name, value in zip(driven["dimensions"], driven["vector"])
        )
        print(
            f"{protocol.id:10} {protocol.beat_hz:4.0f} Hz  "
            f"SCI {rest['sci']:.3f} -> {driven['sci']:.3f}  "
            f"{driven['mode']:6} ρ={driven['rho']:.3f}  "
            f"locus={driven['locus']}  lock={driven['lock']:.2f}  H0={driven['h0']}"
        )
        print(f"           {axes}")
        print(f"           {driven['anchor']}")


if __name__ == "__main__":
    main()
