// Throwaway e2e probe: a TRIAL created purely through MCP must be gradeable by
// the normal respondent path. Run mint_mcp_token.ts first, pass MCP_TOKEN=...
// Not part of the app.
import axios from 'axios';

const MCP_URL = process.env.MCP_URL || 'http://localhost:5000/mcp';
const API_URL = process.env.API_URL || 'http://localhost:5000/api';
const TOKEN = process.env.MCP_TOKEN;

if (!TOKEN) {
  console.error('MCP_TOKEN is required (run scratch/mint_mcp_token.ts)');
  process.exit(1);
}

let sessionId: string | undefined;
let nextId = 1;
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
  const res = await axios.post(
    MCP_URL,
    { jsonrpc: '2.0', method, params, id: nextId++ },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      responseType: 'text',
      validateStatus: () => true,
    },
  );
  if (!sessionId && res.headers['mcp-session-id']) sessionId = res.headers['mcp-session-id'] as string;
  return parseSse(res.data);
}

async function submit(pollId: string, deviceId: string, answers: any[]) {
  const res = await axios.post(
    `${API_URL}/responses`,
    { pollId, deviceId, respondentId: deviceId, answers },
    { validateStatus: () => true },
  );
  return { status: res.status, body: res.data };
}

async function main() {
  console.log('=== MCP-created TRIAL is gradeable e2e ===');

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'grading-probe', version: '1.0.0' },
  });
  if (!sessionId) {
    check('initialize returns a session', false);
    process.exit(1);
  }

  // Built only through MCP — nothing touches the DB or the web builder.
  const created = await rpc('tools/call', {
    name: 'create_poll',
    arguments: {
      title: `MCP Graded Probe ${Date.now()}`,
      pollType: 'TRIAL',
      passingScorePercentage: 60,
      isAnonymous: true,
      questions: [
        {
          text: 'Which planet is closest to the Sun?',
          options: ['Mercury', 'Venus', 'Earth'],
          type: 'single',
          correctOptionIndices: [0],
          explanation: 'Mercury orbits nearest the Sun.',
          points: 5,
        },
        {
          text: 'Which of these are gas giants?',
          options: ['Jupiter', 'Saturn', 'Mercury'],
          type: 'multiple',
          correctOptionIndices: [0, 1],
          points: 5,
        },
      ],
    },
  });

  const text = created?.result?.content?.[0]?.text ?? '';
  const poll = created?.result?.isError ? null : JSON.parse(text).poll;
  check('MCP created the TRIAL', Boolean(poll?._id) && poll?.pollType === 'TRIAL', text.slice(0, 300));
  if (!poll?._id) process.exit(1);

  const [q1, q2] = poll.questions;

  // --- all correct ---------------------------------------------------------
  console.log('\n[1] all-correct submission');
  const perfect = await submit(poll._id, `dev-perfect-${Date.now()}`, [
    { questionId: q1._id, selectedOptionIndices: [0] },
    { questionId: q2._id, selectedOptionIndices: [0, 1] },
  ]);
  const perfectResult = perfect.body?.data?.trialResult;
  check('submission accepted', perfect.status === 201, `${perfect.status} ${JSON.stringify(perfect.body).slice(0, 200)}`);
  check('response is graded (trialResult present)', Boolean(perfectResult), JSON.stringify(perfect.body).slice(0, 300));
  check('score is 10/10', perfectResult?.score === 10 && perfectResult?.maxScore === 10, JSON.stringify(perfectResult)?.slice(0, 200));
  check('percentage is 100', perfectResult?.percentage === 100, `got ${perfectResult?.percentage}`);
  check('marked passed', perfectResult?.passed === true, `got ${perfectResult?.passed}`);
  check(
    'MCP passingScorePercentage drove the threshold',
    perfectResult?.passingScorePercentage === 60,
    `got ${perfectResult?.passingScorePercentage}`,
  );
  check(
    'MCP explanation surfaced to the respondent',
    perfectResult?.breakdown?.[0]?.explanation === 'Mercury orbits nearest the Sun.',
    JSON.stringify(perfectResult?.breakdown?.[0]),
  );

  // --- partially wrong ----------------------------------------------------
  console.log('\n[2] half-wrong submission');
  const half = await submit(poll._id, `dev-half-${Date.now()}`, [
    { questionId: q1._id, selectedOptionIndices: [1] },
    { questionId: q2._id, selectedOptionIndices: [0, 1] },
  ]);
  const halfResult = half.body?.data?.trialResult;
  check('score is 5/10', halfResult?.score === 5, JSON.stringify(halfResult)?.slice(0, 200));
  check('percentage is 50', halfResult?.percentage === 50, `got ${halfResult?.percentage}`);
  check('marked failed at 50 < 60', halfResult?.passed === false, `got ${halfResult?.passed}`);
  check('wrong question flagged incorrect', halfResult?.breakdown?.[0]?.isCorrect === false, JSON.stringify(halfResult?.breakdown?.[0]));

  // --- partial multi-select counts as wrong, not free credit ---------------
  console.log('\n[3] partial multi-select answer');
  const partial = await submit(poll._id, `dev-partial-${Date.now()}`, [
    { questionId: q1._id, selectedOptionIndices: [0] },
    { questionId: q2._id, selectedOptionIndices: [0] },
  ]);
  const partialResult = partial.body?.data?.trialResult;
  check('partial multi-select earns no points for that question', partialResult?.score === 5, JSON.stringify(partialResult)?.slice(0, 200));

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  console.log(`Graded TRIAL poll id: ${poll._id}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('probe crashed:', err.response?.data || err.message || err);
  process.exit(1);
});
