# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Payment clock module - the statutory payment notice sequence.

In the United Kingdom, Ireland, Australia, New Zealand, Singapore and Malaysia
the dates around a payment application are imposed by statute rather than
agreed between the parties, and missing one of them has a defined legal
consequence. The rest of the platform stores payment dates somebody typed. This
module stores the dates the law computes, the notices actually served against
them, and what follows when a deadline passes unanswered.

The sentence the module exists for: **if no valid payment notice is served in
time, the notified sum is the sum the contractor applied for.** That is not a
guideline, it decides adjudications, and here it is
``payment_clock.notified_sum`` - a validation rule that names the amount -
rather than a paragraph somebody may or may not read.

The package does no import-time database work. The arithmetic
(:mod:`app.modules.payment_clock.clock`) is pure and imports on any
interpreter; permission registration and rule registration are deferred to
:func:`on_startup`, and the statutory catalogue seeds itself on first read
rather than from a migration.
"""

import logging

logger = logging.getLogger(__name__)


async def on_startup() -> None:
    """Module startup hook (called by the module loader after mount).

    Registers two things, both load-bearing:

    * the module's permissions, without which ``RequirePermission`` denies an
      unregistered key and every endpoint here is admin-only in production
      while every admin-authenticated test still passes;
    * the ``payment_clock`` validation rule set, without which the clock is a
      calendar. The rules are what turn a passed deadline into the statement
      that the sum applied for is now the sum payable.

    Idempotent - both registries overwrite by key, so a hot reload
    re-registers cleanly.

    The statutory catalogue is deliberately not seeded here. It is seeded on
    first read, inside the caller's transaction, so a deployment whose schema
    is a migration behind boots normally instead of logging a warning nobody
    sees.
    """
    from app.modules.payment_clock.permissions import register_payment_clock_permissions
    from app.modules.payment_clock.validators import register_payment_clock_rules

    register_payment_clock_permissions()
    register_payment_clock_rules()
