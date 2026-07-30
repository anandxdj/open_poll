// Throwaway e2e probe for the MCP pollType/TRIAL fix. Talks to a running backend
// over the real /mcp Streamable HTTP transport. Run mint_mcp_token.ts first and
// pass MCP_TOKEN=... Not part of the app.
import axios from 'axios';

const BASE_URL = process.env.MCP_URL || 'http://localhost:5000/mcp';
const TOKEN = process.env.MCP_TOKEN;

if (!TOKEN) {
  console.error('MCP_TOKEN is required (run scratch/mint_mcp_token.ts)');
  process.exit(1);
}

const baseHeaders: Record<string, string> = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

let sessionId: string | undefined;
let nextId = 1;

function parseSse(data: unknown): any {
  if (typeof data !== 'string') return data;
  for (const line of data.split('\n')) {
    if (line.startsWith('data: ')) {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        /* keep scanning */
      }
    }
  }
  return null;
}

async function rpc(method: string, params: any) {
  const headers = { ...baseHeaders, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) };
  const res = await axios.post(
    BASE_URL,
    { jsonrpc: '2.0', method, params, id: nextId++ },
    { headers, responseType: 'text', validateStatus: () => true },
  );
  if (!sessionId && res.headers['mcp-session-id']) {
    sessionId = res.headers['mcp-session-id'] as string;
  }
  return parseSse(res.data);
}

// A tool error comes back as isError + text content, not a JSON-RPC error.
async function callTool(name: string, args: any) {
  const out = await rpc('tools/call', { name, arguments: args });
  const text = out?.result?.content?.[0]?.text ?? '';
  const isError = Boolean(out?.result?.isError) || Boolean(out?.error);
  let data: any = null;
  if (!isError) {
    try {
      data = JSON.parse(text);
    } catch {
      /* leave null */
    }
  }
  return { isError, text: text || JSON.stringify(out?.error ?? out), data };
}

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const TRIAL_QUESTIONS = [
  {
    text: 'Which planet is closest to the Sun?',
    options: ['Mercury', 'Venus', 'Earth', 'Mars'],
    type: 'single' as const,
    correctOptionIndices: [0],
    explanation: 'Mercury orbits nearest the Sun.',
    points: 5,
  },
  {
    text: 'Which of these are gas giants?',
    options: ['Jupiter', 'Saturn', 'Mercury'],
    type: 'multiple' as const,
    correctOptionIndices: [0, 1],
    points: 3,
  },
];

async function main() {
  console.log('=== MCP TRIAL/pollType e2e ===');

  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'trial-probe', version: '1.0.0' },
  });
  check('initialize returns a session', Boolean(sessionId), JSON.stringify(init));
  if (!sessionId) return;

  // --- 1. schema surface ---------------------------------------------------
  console.log('\n[1] tools/list exposes the assessment fields');
  const tools = await rpc('tools/list', {});
  const create = tools?.result?.tools?.find((t: any) => t.name === 'create_poll');
  const edit = tools?.result?.tools?.find((t: any) => t.name === 'edit_poll');
  const createProps = create?.inputSchema?.properties ?? {};
  const questionProps =
    createProps.questions?.items?.properties ??
    createProps.questions?.items?.anyOf?.[0]?.properties ??
    {};
  check('create_poll advertises pollType', 'pollType' in createProps, JSON.stringify(Object.keys(createProps)));
  check('create_poll advertises passingScorePercentage', 'passingScorePercentage' in createProps);
  check('edit_poll advertises pollType', 'pollType' in (edit?.inputSchema?.properties ?? {}));
  for (const field of ['correctOptionIndices', 'points', 'explanation', 'type']) {
    check(`question shape advertises ${field}`, field in questionProps, JSON.stringify(Object.keys(questionProps)));
  }
  check(
    'description mentions TRIAL',
    /TRIAL/.test(create?.description ?? ''),
    create?.description ?? '(none)',
  );

  // --- 2. the actual bug: TRIAL must persist as TRIAL ---------------------
  console.log('\n[2] create_poll with pollType TRIAL');
  const trial = await callTool('create_poll', {
    title: `MCP Trial Probe ${Date.now()}`,
    pollType: 'TRIAL',
    passingScorePercentage: 60,
    isAnonymous: false,
    questions: TRIAL_QUESTIONS,
  });
  check('create_poll(TRIAL) succeeds', !trial.isError, trial.text.slice(0, 300));
  const trialPoll = trial.data?.poll;
  check('persisted pollType is TRIAL', trialPoll?.pollType === 'TRIAL', `got ${trialPoll?.pollType}`);
  check('passingScorePercentage persisted', trialPoll?.passingScorePercentage === 60, `got ${trialPoll?.passingScorePercentage}`);
  check(
    'q1 correctOptionIndices persisted',
    JSON.stringify(trialPoll?.questions?.[0]?.correctOptionIndices) === '[0]',
    JSON.stringify(trialPoll?.questions?.[0]),
  );
  check(
    'q2 multi correctOptionIndices persisted',
    JSON.stringify(trialPoll?.questions?.[1]?.correctOptionIndices) === '[0,1]',
    JSON.stringify(trialPoll?.questions?.[1]?.correctOptionIndices),
  );
  check('q1 points persisted', trialPoll?.questions?.[0]?.points === 5, `got ${trialPoll?.questions?.[0]?.points}`);
  check(
    'q1 explanation persisted',
    trialPoll?.questions?.[0]?.explanation === 'Mercury orbits nearest the Sun.',
    JSON.stringify(trialPoll?.questions?.[0]?.explanation),
  );
  check('q2 type persisted as multiple', trialPoll?.questions?.[1]?.type === 'multiple', `got ${trialPoll?.questions?.[1]?.type}`);

  // Read it back through a separate tool: rules out a create-time response fluke.
  if (trialPoll?._id) {
    const fetched = await callTool('get_poll', { pollId: trialPoll._id });
    check('get_poll round-trips pollType TRIAL', fetched.data?.poll?.pollType === 'TRIAL', fetched.text.slice(0, 200));
    check(
      'get_poll round-trips correct answers',
      JSON.stringify(fetched.data?.poll?.questions?.[0]?.correctOptionIndices) === '[0]',
      JSON.stringify(fetched.data?.poll?.questions?.[0]?.correctOptionIndices),
    );
  }

  // --- 3. plain poll still defaults to POLL ------------------------------
  console.log('\n[3] plain poll is unaffected');
  const plain = await callTool('create_poll', {
    title: `MCP Plain Probe ${Date.now()}`,
    questions: [{ text: 'Best street food?', options: ['Tacos', 'Samosa'] }],
  });
  check('create_poll without pollType succeeds', !plain.isError, plain.text.slice(0, 300));
  check('defaults to pollType POLL', plain.data?.poll?.pollType === 'POLL', `got ${plain.data?.poll?.pollType}`);

  // --- 4. ungradeable TRIALs are rejected --------------------------------
  console.log('\n[4] ungradeable TRIALs are rejected');
  const noAnswers = await callTool('create_poll', {
    title: `MCP Trial NoAnswers ${Date.now()}`,
    pollType: 'TRIAL',
    questions: [{ text: 'Capital of France?', options: ['Paris', 'Lyon'] }],
  });
  check('TRIAL with no correctOptionIndices rejected', noAnswers.isError, noAnswers.text.slice(0, 200));
  check('rejection explains the rule', /at least one correct option/i.test(noAnswers.text), noAnswers.text.slice(0, 200));

  const outOfRange = await callTool('create_poll', {
    title: `MCP Trial OutOfRange ${Date.now()}`,
    pollType: 'TRIAL',
    questions: [{ text: 'Capital of France?', options: ['Paris', 'Lyon'], correctOptionIndices: [7] }],
  });
  check('out-of-range correct index rejected', outOfRange.isError, outOfRange.text.slice(0, 200));
  check('rejection names the valid range', /valid range 0-1/.test(outOfRange.text), outOfRange.text.slice(0, 200));

  const multiOnSingle = await callTool('create_poll', {
    title: `MCP Trial MultiSingle ${Date.now()}`,
    pollType: 'TRIAL',
    questions: [
      { text: 'Capital of France?', options: ['Paris', 'Lyon'], type: 'single', correctOptionIndices: [0, 1] },
    ],
  });
  check('two correct answers on a "single" question rejected', multiOnSingle.isError, multiOnSingle.text.slice(0, 200));

  // --- 5. promotion via edit_poll ----------------------------------------
  console.log('\n[5] edit_poll promotion to TRIAL');
  const plainId = plain.data?.poll?._id;
  if (plainId) {
    const promoteBare = await callTool('edit_poll', { pollId: plainId, pollType: 'TRIAL' });
    check('promotion without questions rejected', promoteBare.isError, promoteBare.text.slice(0, 200));
    check(
      'rejection tells the agent to resupply questions',
      /resupplying questions/i.test(promoteBare.text),
      promoteBare.text.slice(0, 200),
    );

    const promote = await callTool('edit_poll', {
      pollId: plainId,
      pollType: 'TRIAL',
      passingScorePercentage: 50,
      questions: [
        {
          text: 'Best street food?',
          options: ['Tacos', 'Samosa'],
          type: 'single',
          correctOptionIndices: [1],
          points: 2,
        },
      ],
    });
    check('promotion with questions succeeds', !promote.isError, promote.text.slice(0, 300));
    check('promoted poll is TRIAL', promote.data?.poll?.pollType === 'TRIAL', `got ${promote.data?.poll?.pollType}`);
    check(
      'promoted question carries its correct answer',
      JSON.stringify(promote.data?.poll?.questions?.[0]?.correctOptionIndices) === '[1]',
      JSON.stringify(promote.data?.poll?.questions?.[0]?.correctOptionIndices),
    );

    const reread = await callTool('get_poll', { pollId: plainId });
    check('promotion survives a re-read', reread.data?.poll?.pollType === 'TRIAL', reread.text.slice(0, 200));
  } else {
    check('plain poll id available for promotion tests', false, plain.text.slice(0, 200));
  }

  // --- 6. share link / analytics still work on a TRIAL -------------------
  console.log('\n[6] other tools still work against a TRIAL');
  if (trialPoll?._id) {
    const share = await callTool('get_share_link', { pollId: trialPoll._id });
    check('get_share_link works for a TRIAL', !share.isError && Boolean(share.data?.shareUrl), share.text.slice(0, 200));
    const analytics = await callTool('get_poll_analytics', { pollId: trialPoll._id });
    check('get_poll_analytics works for a TRIAL', !analytics.isError, analytics.text.slice(0, 200));
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (trialPoll?._id) console.log(`TRIAL poll id: ${trialPoll._id}`);
  if (plainId) console.log(`Promoted poll id: ${plainId}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('probe crashed:', err.response?.data || err.message || err);
  process.exit(1);
});
