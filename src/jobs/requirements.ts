import type { MachineCapability } from '../machines/identity.js';
import type { MachineWorkOrder, WorkOrderRequirement, WorkOrderStage } from './work-order.js';

export type WorkActionKind = 'assign' | 'prepare' | 'start' | 'submit_proof' | 'settle' | 'cancel' | 'fail';
export interface WorkActionFeedback { action: WorkActionKind; allowed: boolean; stage: WorkOrderStage; reasons: string[]; requiredCapabilities: MachineCapability[]; }

export function validateWorkOrderRequirement(requirement: WorkOrderRequirement): string[] {
  const reasons: string[] = [];
  if (!requirement.capabilities.length) reasons.push('at least one capability is required');
  if (new Set(requirement.capabilities).size !== requirement.capabilities.length) reasons.push('duplicate capabilities are not allowed');
  if (requirement.expectedOutputs?.some((output) => !/^[a-z0-9][a-z0-9._:-]{2,96}$/i.test(output))) reasons.push('expected output references must be stable ids');
  return reasons;
}

export function nextActionFeedback(order: MachineWorkOrder): WorkActionFeedback[] {
  const base = (action: WorkActionKind, allowed: boolean, reasons: string[] = []): WorkActionFeedback => ({ action, allowed, stage: order.stage, reasons, requiredCapabilities: order.requirement.capabilities });
  switch (order.stage) {
    case 'queued': return [base('assign', true), base('cancel', true)];
    case 'assigned': return [base('prepare', Boolean(order.machineId), order.machineId ? [] : ['machine assignment required']), base('cancel', true), base('fail', true)];
    case 'preparing': return [base('start', true), base('fail', true), base('cancel', true)];
    case 'working': return [base('submit_proof', Boolean(order.telemetryRef), order.telemetryRef ? [] : ['telemetry reference required']), base('fail', true)];
    case 'proof_submitted': return [base('settle', Boolean(order.proofId && order.settlementIntentId), order.proofId && order.settlementIntentId ? [] : ['proof and settlement intent required']), base('fail', true)];
    default: return [];
  }
}

export function assertWorkOrderReadyForSettlement(order: MachineWorkOrder): void {
  const reasons: string[] = [];
  if (order.stage !== 'proof_submitted') reasons.push(`stage ${order.stage} is not ready for settlement`);
  if (!order.proofId) reasons.push('proof id required');
  if (!order.telemetryRef) reasons.push('telemetry reference required');
  if (!order.settlementIntentId) reasons.push('settlement intent required');
  if (reasons.length) throw new Error(reasons.join('; '));
}
