import type { MachineCapability } from '../machines/identity.js';
import type { MachineWorkOrder } from '../jobs/work-order.js';
import type { FleetRegistryEntry } from './registry.js';
import { canAssignMachine } from './registry.js';

export interface MachineAvailabilityScore {
  machineId: string;
  assignable: boolean;
  score: number;
  reasons: string[];
  matchedCapabilities: MachineCapability[];
  missingCapabilities: MachineCapability[];
}

export interface FleetSelectionResult {
  workOrderId: string;
  selectedMachineId?: string | undefined;
  candidates: MachineAvailabilityScore[];
}

export function scoreMachineForWorkOrder(entry: FleetRegistryEntry, order: Pick<MachineWorkOrder, 'workOrderId' | 'requirement'>): MachineAvailabilityScore {
  const assignable = canAssignMachine(entry, { jobId: order.workOrderId, requiredCapabilities: order.requirement.capabilities });
  const matchedCapabilities = order.requirement.capabilities.filter((capability) => entry.capabilities.includes(capability));
  const missingCapabilities = order.requirement.capabilities.filter((capability) => !entry.capabilities.includes(capability));
  const batteryScore = Math.min(40, Math.max(0, Math.round((entry.batteryPct ?? 50) * 0.4)));
  const capabilityScore = order.requirement.capabilities.length === 0 ? 0 : Math.round((matchedCapabilities.length / order.requirement.capabilities.length) * 40);
  const healthScore = entry.health === 'nominal' || entry.health === undefined ? 20 : entry.health === 'degraded' ? 8 : 0;
  return {
    machineId: entry.machineId,
    assignable: assignable.ok,
    score: assignable.ok ? batteryScore + capabilityScore + healthScore : 0,
    reasons: assignable.reasons,
    matchedCapabilities,
    missingCapabilities
  };
}

export function selectMachineForWorkOrder(entries: FleetRegistryEntry[], order: Pick<MachineWorkOrder, 'workOrderId' | 'requirement'>): FleetSelectionResult {
  const candidates = entries
    .map((entry) => scoreMachineForWorkOrder(entry, order))
    .sort((a, b) => b.score - a.score || a.machineId.localeCompare(b.machineId));
  return {
    workOrderId: order.workOrderId,
    selectedMachineId: candidates.find((candidate) => candidate.assignable)?.machineId,
    candidates
  };
}

export function summarizeFleetReadiness(entries: FleetRegistryEntry[]): { ready: number; degraded: number; offline: number; active: number } {
  return entries.reduce((summary, entry) => {
    if (entry.status === 'offline' || entry.health === 'offline') summary.offline += 1;
    else if (entry.health === 'degraded' || entry.status === 'faulted' || entry.health === 'faulted') summary.degraded += 1;
    else summary.ready += 1;
    if (entry.activeJobId) summary.active += 1;
    return summary;
  }, { ready: 0, degraded: 0, offline: 0, active: 0 });
}
