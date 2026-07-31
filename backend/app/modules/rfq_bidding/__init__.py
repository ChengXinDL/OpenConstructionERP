# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""RFQ & Bidding module.

Request for Quotation management: the scope suppliers are asked to price, the
quotes that come back on their own terms, the comparison that puts those quotes
on one basis, and the award recorded against the ranking it was taken from.
"""


async def on_startup() -> None:
    """Module startup hook: register permissions and validation rules.

    The rules have to be registered here rather than at import time. A module
    that is installed but disabled must not push rules into the shared registry,
    and the startup hook is the point at which the loader has decided this
    module is running.
    """
    from app.modules.rfq_bidding.permissions import register_rfq_permissions
    from app.modules.rfq_bidding.validators import register_rfq_validation_rules

    register_rfq_permissions()
    register_rfq_validation_rules()
