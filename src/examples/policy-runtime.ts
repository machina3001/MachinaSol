import { DEFAULT_POLICY_PROFILE, validatePolicyForIntent } from '../policy/profiles.js';
console.log(JSON.stringify({ policy: DEFAULT_POLICY_PROFILE.policyId, validation: validatePolicyForIntent(DEFAULT_POLICY_PROFILE, { chain: 'solana', asset: 'SOL', amount: '0.5', role: 'drone' }) }, null, 2));
