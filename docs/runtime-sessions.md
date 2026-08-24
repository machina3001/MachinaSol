# Runtime sessions

A runtime session links a machine identity to a wallet/account, operator, policy profile, and settlement/proof rail. Sessions are the public boundary between a robot/drone/sensor and the rails that later verify payment or proof events.

Session creation validates the rail-specific wallet format, machine id, operator, fixture/live mode, and optional metadata. Fleet registry helpers can then attach the session to public-safe machine status, battery/health summary, last telemetry reference, and active work order id.

Sessions do not grant robot-control authority. Production hardware adapters, private policy engines, provider routing, and treasury controls remain platform services outside this package.
