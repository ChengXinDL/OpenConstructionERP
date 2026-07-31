# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Full EVM module.

Earned Value Management as a register: an approved performance measurement
baseline with its cumulative planned-value curve, the measurements taken
against it, and the full standard metric set derived from them (PV, EV, AC,
SV, CV, SPI, CPI, and the EAC / ETC / VAC / TCPI forecast family).

Also carries the older forecast surface fed by the finance module's EVM
snapshots, plus the predictive alerting that runs on top of it.
"""


async def on_startup() -> None:
    """Module startup hook - register permissions, validation rules and the job."""
    from app.modules.full_evm.job import register_forecast_job_handler
    from app.modules.full_evm.permissions import register_full_evm_permissions
    from app.modules.full_evm.validators import register_full_evm_rules

    register_full_evm_permissions()
    register_full_evm_rules()
    register_forecast_job_handler()
