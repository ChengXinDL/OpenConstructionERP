# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Signature-provider abstraction.

This module defines the *shape* a real e-signature provider adapter plugs into,
without performing any cryptography itself. A provider is described purely by the
legal *capability* it delivers (qualified / advanced / simple electronic, or a
digital-certificate signature) and by five operations, none of which accepts a
key, a certificate file or a password:

    describe()            - static metadata about the provider for the UI.
    verify_attestation()  - a metadata-only sanity check of a recorded
                            attestation. It does NOT verify a signature
                            cryptographically; it only reports whether the
                            attestation is well-formed and self-consistent.
    initiate()             - called when a signing session is opened. For an
                            external provider this is where a signing request
                            would be dispatched; the return value is metadata
                            the caller may record, never a credential.
    check_status()         - the provider's view of a session's workflow
                            status, given its current signatory map and
                            recorded attestations.
    fetch_artifact()       - what the provider can currently hand back for a
                            session: an issued-set manifest and, when the
                            provider produces one, descriptive certificate
                            metadata. Never the certificate file itself.

The default :class:`NullProvider` is what ships in core: it records and reasons
about attestations but claims no cryptographic assurance, dispatches nothing
externally, and derives status/artifact purely from what is already recorded in
this registry (:mod:`app.modules.signing.service`). Real schemes - a
CryptoPro/GOST adapter for RU УКЭП, an eIDAS QES adapter for the EU, a DSC
adapter for India, an e-sign adapter for the US - are added later as separate
adapters that implement :class:`SignatureProvider`, keyed on the same capability
vocabulary, and registered via :func:`register_provider`. They live outside this
module and NEVER change the rule that the platform stores no keys,
certificates-as-files or passwords.

Frontend note: a provider-selector UI (letting a user pick which registered
provider handles a given session/capability) is deliberately not part of this
change - the signing UI is owned by a separate workstream. Once more than the
built-in :class:`NullProvider` is registered, that UI can read the roster from
``GET /v1/signing/meta`` the same way it already reads capabilities/statuses.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import UTC, datetime
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


@dataclass(frozen=True)
class ProviderInitiation:
    """Outcome of opening a signing session with a provider.

    ``accepted`` is ``True`` when the provider is ready to collect signatures
    for the session (for the built-in provider this is always true - there is
    nothing external to fail). ``external_reference`` is an opaque id an
    external provider would hand back to correlate later status/webhook
    calls; the built-in provider never sets it. ``details`` is free-form,
    provider-specific metadata safe to persist (never a credential).
    """

    accepted: bool
    provider_name: str
    external_reference: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "accepted": self.accepted,
            "provider_name": self.provider_name,
            "external_reference": self.external_reference,
            "details": dict(self.details),
        }


@dataclass(frozen=True)
class ProviderStatus:
    """The provider's view of a session's workflow status.

    ``status`` uses the same vocabulary as
    :data:`app.modules.signing.schemas.SESSION_STATUSES`. For the built-in
    provider this is derived purely from the session's own recorded
    attestations; an external provider might instead report back what it
    observed on its side (e.g. a webhook-driven status).
    """

    status: str
    provider_name: str
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "provider_name": self.provider_name,
            "details": dict(self.details),
        }


@dataclass(frozen=True)
class SignedArtifact:
    """What a provider can currently hand back for a session.

    ``manifest`` is the issued-set hash manifest (``{document_ref:
    content_hash}``). ``certificate`` is optional, descriptive certificate
    *metadata* only (subject / validity), never a certificate file, a key or
    a password - the same rule every other part of this module follows.
    ``available`` is ``False`` until at least one attestation has been
    recorded (there is nothing to hand back for an empty session).
    """

    available: bool
    provider_name: str
    manifest: dict[str, str] = field(default_factory=dict)
    certificate: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "provider_name": self.provider_name,
            "manifest": dict(self.manifest),
            "certificate": self.certificate,
        }


class SignatureProvider(ABC):
    """Abstract e-signature provider keyed on a legal capability.

    Concrete adapters implement all five methods below. No method of this
    interface accepts a key, a certificate file or a password, and
    implementations must keep it that way. ``initiate`` / ``check_status`` /
    ``fetch_artifact`` are the operations the signing registry (see
    :class:`app.modules.signing.service.SigningService`) drives a session
    through instead of hard-coding its own status/manifest logic; a real
    external adapter overrides them to talk to whatever service it wraps.
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

    @abstractmethod
    def initiate(self, session: Any) -> ProviderInitiation:
        """Open a signing request for ``session`` with this provider."""
        ...

    @abstractmethod
    def check_status(self, session: Any, signatures: Any) -> ProviderStatus:
        """Return this provider's current status for ``session``."""
        ...

    @abstractmethod
    def fetch_artifact(self, session: Any, signatures: Any) -> SignedArtifact:
        """Return whatever signed-artifact info this provider currently has."""
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
    cryptographically verified anything. It dispatches nothing externally:
    ``initiate`` always accepts immediately, and ``check_status`` /
    ``fetch_artifact`` are pure re-derivations of what is already recorded in
    the registry (via :mod:`app.modules.signing.service`'s pure functions, so
    there is exactly one implementation of the status-derivation rules).
    Regional adapters override :attr:`capability` and provide real
    verification semantics elsewhere.
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

    def initiate(self, session: Any) -> ProviderInitiation:
        return ProviderInitiation(
            accepted=True,
            provider_name=self.name,
            external_reference=None,
            details={"mode": "manual_attestation", "initiated_at": datetime.now(UTC).isoformat()},
        )

    def check_status(self, session: Any, signatures: Any) -> ProviderStatus:
        # Lazy import: service.py imports this module at call time (router /
        # service wiring), so importing it back here at module load time
        # would be circular. Importing inside the method avoids that while
        # keeping exactly one implementation of the derivation rules.
        from app.modules.signing.service import recompute_session_status

        status = recompute_session_status(
            _field(session, "signatory_map") or [],
            signatures,
            expires_at=_field(session, "expires_at"),
            now=datetime.now(UTC),
            current_status=_field(session, "status"),
        )
        return ProviderStatus(status=status, provider_name=self.name)

    def fetch_artifact(self, session: Any, signatures: Any) -> SignedArtifact:
        from app.modules.signing.service import issued_set_manifest

        signed = [s for s in signatures if _field(s, "status") == "signed"]
        return SignedArtifact(
            available=bool(signed),
            provider_name=self.name,
            manifest=issued_set_manifest([session]),
            # No cryptographic certificate is ever produced by this
            # provider - only descriptive metadata already carried on a
            # signature (cert_subject / cert_valid_until), which the caller
            # can already read straight off the signature rows.
            certificate=None,
        )


#: The provider core ships with. Adapters register others keyed by capability.
DEFAULT_PROVIDER: SignatureProvider = NullProvider()

#: Registry of providers keyed by the capability they deliver. Seeded with the
#: built-in provider for every capability so ``get_provider`` never returns
#: ``None``; :func:`register_provider` lets a real adapter take over one
#: capability without touching this module or any call site.
_PROVIDER_REGISTRY: dict[str, SignatureProvider] = {}


def register_provider(capability: str, provider: SignatureProvider) -> None:
    """Register ``provider`` as the handler for ``capability``.

    Called by an adapter package at import/startup time (e.g. a regional
    module's ``on_startup`` hook), never by core. Overwrites any previous
    registration for the same capability so a later-loaded adapter wins.
    """
    _PROVIDER_REGISTRY[capability] = provider


def get_provider(capability: str | None = None) -> SignatureProvider:
    """Return the provider registered for ``capability``.

    Falls back to :data:`DEFAULT_PROVIDER` (the built-in :class:`NullProvider`)
    when ``capability`` is ``None`` or nothing has been registered for it, so
    every capability always resolves to a usable provider even before any
    adapter is installed.
    """
    if capability is None:
        return DEFAULT_PROVIDER
    return _PROVIDER_REGISTRY.get(capability, DEFAULT_PROVIDER)


__all__ = [
    "DEFAULT_PROVIDER",
    "AttestationVerification",
    "NullProvider",
    "ProviderInitiation",
    "ProviderStatus",
    "SignatureProvider",
    "SignedArtifact",
    "get_provider",
    "register_provider",
]
