import { describe, expect, it } from 'bun:test';
import { vercelProvisioner } from '../src/modules/domains/provisioners';

describe('Vercel provisioner', () => {
  const recorder = (status: number) => {
    const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: String(init.method), body: init.body as string | undefined, auth: (init.headers as Record<string, string>).Authorization });
      return new Response(null, { status });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };

  it('attaches and detaches the hostname on the frontend project', async () => {
    const { calls, fetchImpl } = recorder(200);
    const provisioner = vercelProvisioner({ token: 'tok', projectId: 'prj_1', teamId: 'team 1' }, fetchImpl);
    await provisioner.add('polls.acme.test');
    await provisioner.remove('polls.acme.test');
    expect(calls).toEqual([
      { url: 'https://api.vercel.com/v10/projects/prj_1/domains?teamId=team%201', method: 'POST', body: '{"name":"polls.acme.test"}', auth: 'Bearer tok' },
      { url: 'https://api.vercel.com/v9/projects/prj_1/domains/polls.acme.test?teamId=team%201', method: 'DELETE', body: undefined, auth: 'Bearer tok' },
    ]);
  });

  it('treats "already attached" and "already gone" as done, other answers as failures', async () => {
    await vercelProvisioner({ token: 't', projectId: 'p' }, recorder(409).fetchImpl).add('a.test');
    await vercelProvisioner({ token: 't', projectId: 'p' }, recorder(404).fetchImpl).remove('a.test');
    await expect(vercelProvisioner({ token: 't', projectId: 'p' }, recorder(403).fetchImpl).add('a.test')).rejects.toThrow(/403/);
  });
});
