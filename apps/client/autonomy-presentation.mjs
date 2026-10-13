const GATES = Object.freeze([
  Object.freeze({ key: 'requested', label: 'Protected host gate', ready: (runtime) => runtime.requested === true }),
  Object.freeze({ key: 'releaseCertified', label: 'Certified build', ready: (runtime) => runtime.releaseCertified === true }),
  Object.freeze({ key: 'identityBound', label: 'Tenant, user and WhatsApp identity', ready: (runtime) => runtime.identityBound === true }),
  Object.freeze({ key: 'durableLifecycle', label: 'Durable authorization and outbox', ready: (runtime) => runtime.durableLifecycle === true }),
  Object.freeze({ key: 'deliveryBoundaryConfigured', label: 'Exact delivery boundary', ready: (runtime) => runtime.deliveryBoundaryConfigured === true }),
  Object.freeze({ key: 'safetyAuthoritiesConfigured', label: 'Fresh safety authorities', ready: (runtime) => runtime.safetyAuthoritiesConfigured === true }),
]);

export function autonomyReadiness(autonomy = {}) {
  const runtime = autonomy?.runtime && typeof autonomy.runtime === 'object' ? autonomy.runtime : {};
  return GATES.map((gate) => Object.freeze({
    key: gate.key,
    label: gate.label,
    ready: gate.ready(runtime),
  }));
}

export function autonomySummary(autonomy = {}) {
  if (autonomy?.automaticSendAvailable === true) {
    return Object.freeze({
      title: 'Certified automatic delivery is available.',
      detail: 'Each draft still rechecks the exact chat, latest message, relationship graph, policy, consent, connection and safety state before delivery.',
    });
  }
  const missing = autonomyReadiness(autonomy).filter((item) => !item.ready).length;
  return Object.freeze({
    title: 'Automatic delivery is off.',
    detail: missing
      ? `${missing} protected execution ${missing === 1 ? 'gate is' : 'gates are'} not ready. Saving a policy or consent cannot bypass them.`
      : 'Execution consent is not current. Saving a policy alone cannot send a message.',
  });
}
