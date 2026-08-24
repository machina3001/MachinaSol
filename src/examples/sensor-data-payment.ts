import { createRegistryEntry, createMachineJob, normalizeTelemetrySnapshot, evaluateMachineJobPolicy, buildSettlementIntent, createMachineWorkProof } from '../index.js';

const SENSOR_WALLET = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const RECIPIENT = 'SysvarC1ock11111111111111111111111111111111';

const machine = createRegistryEntry({ machineId: 'edge-sensor-3', role: 'edge_node', walletAddress: SENSOR_WALLET, operatorId: 'sensor-ops', capabilities: ['sensing', 'compute', 'audit_capture'], label: 'Warehouse edge sensor' }, '2026-07-14T02:00:00.000Z');
const job = createMachineJob({ jobId: 'job-temp-window-3', machineId: machine.machineId, requiredCapabilities: ['sensing', 'compute'], chain: 'solana', settlementAmount: '0.08', settlementAsset: 'SOL', recipient: RECIPIENT }, '2026-07-14T02:01:00.000Z');
const telemetry = normalizeTelemetrySnapshot({ machineId: machine.machineId, observedAt: '2026-07-14T02:02:00.000Z', batteryPct: 61, health: 'nominal', signalPct: 99, progressPct: 100, telemetryRef: 'telemetry:edge-sensor-3:temp-window' });
const decision = evaluateMachineJobPolicy(machine, job, telemetry, { policyId: 'sensor-data', allowedChains: ['solana'], maxAmount: '0.5', minBatteryPct: 10 }, new Date('2026-07-14T02:03:00.000Z'));
const intent = buildSettlementIntent({ chain: 'solana', source: machine.walletAddress, recipient: job.recipient, amount: job.settlementAmount, asset: 'SOL', machineId: machine.machineId, sessionId: 'session-sensor-3', policyId: decision.policyId, memo: 'temperature-window' });
const proof = createMachineWorkProof({ machineId: machine.machineId, jobId: job.jobId, sessionId: 'session-sensor-3', chain: 'solana', settlementIntentId: intent.intentId, telemetryRef: telemetry.telemetryRef, resultRef: 'dataset:temp-window:sha256-fixture', expectation: { to: job.recipient, amount: job.settlementAmount, memo: 'temperature-window' } }, '2026-07-14T02:04:00.000Z');
console.log(JSON.stringify({ machine, job, telemetry, decision, intent, proof }, null, 2));
