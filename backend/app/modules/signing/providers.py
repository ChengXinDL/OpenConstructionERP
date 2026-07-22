# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Signature-provider abstraction.

This module defines the *shape* a real e-signature provider adapter plugs into,
without performing any cryptography itself. A provider is described purely by the
legal *capability* it delivers (qualified / advanced / simple electronic, or a
digital-certificate signature) and by two pure operations:

    describe()            - static metadata about the provider for the UI.
    verify_attestation()  - a metadata-only sanity check of a recorded
                            attestation. It does NOT verify a signature
                            cryptographically; it only reports whether the
                            attestation is well-formed and self-consistent.

The default :class:`NullProvider` is what ships in core: it records and reasons
about attestations but claims no cryptographic assurance. Real schemes - a
CryptoPro/GOST adapter for RU УКЭП, an eIDAS QES adapter for the EU, a DSC
adapter for India, an e-sign adapter for the US - are added later as separate
adapters that implement :class:`SignatureProvider`, keyed on the same capability
vocabulary. They live outside this module and NEVER change the rule that the
platform stores no keys, certificates-as-files or passwords.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class AttestationVerification:
    """Outcome of a metadata-only attestation check.

    ``ok`` says the attestation is well-formed and self-consistent (it names a
    signatory and role and carries a content hash). ``cryptographically_verified``
    is intentionally always ``False`` for the core providers: this platform
    records the fact of a signature, it does not re-verify the cryptography.
    """

    ok: bool
    capability: str
    cryptographically_verified: bool = False
    issues: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "capability": self.capability,
            "cryptographically_verified": self.cryptographically_verified,
            "issues": list(self.issues),
        }


class SignatureProvider(ABC):
    """Abstract e-signature provider keyed on a legal capability.

    Concrete adapters implement :meth:`describe` and :meth:`verify_attestation`.
    No method of this interface accepts a key, a certificate file or a password,
    and implementations must keep it that way.
    """

    #: The legal capability this provider delivers; one of
    #: :data:`app.modules.signing.schemas.CAPABILITIES`.
    capability: str = "simple_electronic"

    #: Short, brandless identifier of the adapter kind.
    name: str = "null"

    @abstractmethod
    def describe(self) -> dict[str, Any]:
        """Return static, UI-facing metadata about this provider."""
        ...

    @abstractmethod
    def verify_attestation(self, attestation: Any) -> AttestationVerification:
        """Metadata-only well-formedness check. Never cryptographic."""
        ...


def _field(obj: Any, name: str) -> Any:
    """Read ``name`` from a dict or an object, returning ``None`` if absent."""
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


class NullProvider(SignatureProvider):
    """Default provider: records attestations, claims no cryptographic assurance.

    It is the honest baseline - it validates that an attestation is well-formed
    (a signatory, a role, a content hash) and reports that the platform has *not*
    cryptographically verified anything. Regional adapters override
    :attr:`capability` and provide real verification semantics elsewhere.
    """

    name = "null"
    capability = "simple_electronic"

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "capability": self.capability,
            "cryptographic_verification": False,
            "records_attestations": True,
            "accepts_keys_or_passwords": False,
            "description": (
                "Attestation-only provider. Records who signed what and when; "
                "performs no cryptography and stores no credentials."
            ),
        }

    def verify_attestation(self, attestation: Any) -> AttestationVerification:
        issues: list[str] = []
        if not _field(attestation, "signatory_name"):
            issues.append("missing signatory_name")
        if not _field(attestation, "signatory_role"):
            issues.append("missing signatory_role")
        if not _field(attestation, "content_hash"):
            issues.append("missing content_hash")
        return AttestationVerification(
            ok=not issues,
            capability=self.capability,
            cryptographically_verified=False,
            issues=issues,
        )


#: The provider core ships with. Adapters register others keyed by capability.
DEFAULT_PROVIDER: SignatureProvider = NullProvider()


def get_provider(capability: str | None = None) -> SignatureProvider:
    """Return a provider for the requested capability.

    Core only ships the :class:`NullProvider`; until a regional adapter is
    registered, every capability resolves to the attestation-only default. The
    signature keeps the door open for a real registry later without a call-site
    change.
    """
    return DEFAULT_PROVIDER


__all__ = [
    "DEFAULT_PROVIDER",
    "AttestationVerification",
    "NullProvider",
    "SignatureProvider",
    "get_provider",
]
