export type RuntimeEventType = 'machine.action' | 'policy.checked' | 'settlement.intent.created' | 'receipt.verified';
export interface RuntimeEvent {
  eventId: string;
  type: RuntimeEventType;
  machineId: string;
  sessionId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}
export function createRuntimeEvent(input: Omit<RuntimeEvent, 'eventId' | 'occurredAt'> & { eventId?: string; occurredAt?: string }): RuntimeEvent {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  return { eventId: input.eventId ?? `${input.type}:${input.sessionId}:${occurredAt}`, type: input.type, machineId: input.machineId, sessionId: input.sessionId, occurredAt, payload: input.payload };
}
