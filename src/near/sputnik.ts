export interface NearAction {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
}

export interface SputnikPolicy {
  roles: unknown[];
  default_vote_policy: unknown;
  proposal_bond: string;
  proposal_period: string;
  bounty_bond: string;
  bounty_forgiveness_period: string;
  [key: string]: unknown;
}

export interface SputnikBounty {
  id?: number;
  description: string;
  token: string;
  amount: string;
  times: number;
  max_deadline: string;
  [key: string]: unknown;
}

export class NearRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NearRpcError';
  }
}

/** Read adapter plus wallet-signable action builders. It never holds a DAO full-access key. */
export class SputnikClient {
  constructor(
    readonly daoId: string,
    readonly rpcUrl = process.env.NEAR_RPC_URL ?? 'https://rpc.testnet.near.org',
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!/^[a-z0-9._-]{2,64}$/.test(daoId)) throw new NearRpcError('invalid DAO account id');
    const daoNetwork = daoId.endsWith('.testnet') ? 'testnet' : daoId.endsWith('.near') ? 'mainnet' : undefined;
    const rpcNetwork = rpcUrl.includes('testnet') ? 'testnet' : rpcUrl.includes('mainnet') ? 'mainnet' : undefined;
    if (daoNetwork && rpcNetwork && daoNetwork !== rpcNetwork) {
      throw new NearRpcError(`DAO account is on ${daoNetwork}, but NEAR_RPC_URL points to ${rpcNetwork}`);
    }
  }

  getPolicy(): Promise<SputnikPolicy> { return this.view('get_policy', {}); }
  getBounties(fromIndex = 0, limit = 50): Promise<SputnikBounty[]> {
    return this.view('get_bounties', { from_index: fromIndex, limit });
  }
  getBountyClaims(accountId: string): Promise<unknown[]> {
    return this.view('get_bounty_claims', { account_id: accountId });
  }
  getProposals(fromIndex = 0, limit = 50): Promise<unknown[]> {
    return this.view('get_proposals', { from_index: fromIndex, limit });
  }

  addBountyProposal(description: string, bounty: Omit<SputnikBounty, 'id'>, proposalBond: string): NearAction {
    return this.action('add_proposal', {
      proposal: { description, kind: { AddBounty: { bounty } } },
    }, proposalBond);
  }

  claimBounty(id: number, deadlineNs: string, bountyBond: string): NearAction {
    return this.action('bounty_claim', { id, deadline: deadlineNs }, bountyBond);
  }

  completeBounty(id: number, accountId: string, description: string): NearAction {
    return this.action('bounty_done', { id, account_id: accountId, description }, '0');
  }

  vote(proposalId: number, action: 'VoteApprove' | 'VoteReject' | 'VoteRemove'): NearAction {
    return this.action('act_proposal', { id: proposalId, action }, '0');
  }

  private action(methodName: string, args: Record<string, unknown>, deposit: string): NearAction {
    return { receiverId: this.daoId, methodName, args, gas: '200000000000000', deposit };
  }

  private async view<T>(methodName: string, args: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'streamline', method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: this.daoId,
          method_name: methodName,
          args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        },
      }),
    });
    if (!response.ok) throw new NearRpcError(`NEAR RPC HTTP ${response.status}`);
    const body = await response.json() as {
      result?: { result?: number[] };
      error?: { message?: string; data?: string | { error_message?: string } };
    };
    if (body.error) {
      const detail = typeof body.error.data === 'string'
        ? body.error.data
        : body.error.data?.error_message;
      throw new NearRpcError(detail ? `${body.error.message ?? 'NEAR RPC error'}: ${detail}` : body.error.message ?? 'NEAR RPC error');
    }
    if (!body.result?.result) throw new NearRpcError('NEAR RPC returned no result');
    try {
      return JSON.parse(Buffer.from(body.result.result).toString('utf8')) as T;
    } catch {
      throw new NearRpcError('NEAR RPC returned malformed JSON');
    }
  }
}
