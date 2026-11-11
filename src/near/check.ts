import { SputnikClient } from './sputnik';

const daoId = process.env.SPUTNIK_DAO_ID;
if (!daoId) throw new Error('SPUTNIK_DAO_ID is required');
const client = new SputnikClient(daoId, process.env.NEAR_RPC_URL);
const [policy, bounties, proposals] = await Promise.all([client.getPolicy(), client.getBounties(), client.getProposals()]);
console.log(JSON.stringify({
  daoId,
  proposalBond: policy.proposal_bond,
  roles: policy.roles.length,
  bounties: bounties.length,
  proposals: proposals.length,
}, null, 2));
