// Throwaway e2e probe for the MCP assessment surface. Talks to a running backend
// over the real /mcp Streamable HTTP transport. Run mint_mcp_token.ts first and
// pass MCP_TOKEN=... Not part of the app.
//
// Section [1] is the important one: it asserts the JSON Schema "required" arrays
// that a client validates a tool call against. That is the only thing standing
// between an agent and a submitted assessment with no correct answers — prose in
// a description does not bind, and a server-side refinement only rejects after
// the fact.
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

const ASSESSMENT_QUESTIONS = [
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
  console.log('=== MCP assessment surface e2e ===');

  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'assessment-probe', version: '1.0.0' },
  });
  check('initialize returns a session', Boolean(sessionId), JSON.stringify(init));
  if (!sessionId) return;

  // --- 1. the schema contract an agent is bound by -------------------------
  console.log('\n[1] tools/list advertises the constraint, not just prose');
  const tools = await rpc('tools/list', {});
  const byName: Record<string, any> = {};
  for (const tool of tools?.result?.tools ?? []) byName[tool.name] = tool;

  check(
    'create_assessment is advertised',
    Boolean(byName.create_assessment),
    Object.keys(byName).join(', '),
  );
  check(
    'convert_poll_to_assessment is advertised',
    Boolean(byName.convert_poll_to_assessment),
    Object.keys(byName).join(', '),
  );

  const questionSchema = (tool: any) => tool?.inputSchema?.properties?.questions?.items ?? {};

  const assessmentQuestion = questionSchema(byName.create_assessment);
  check(
    'create_assessment REQUIRES correctOptionIndices',
    (assessmentQuestion.required ?? []).includes('correctOptionIndices'),
    JSON.stringify(assessmentQuestion.required),
  );
  check(
    'correctOptionIndices must be non-empty (minItems 1)',
    assessmentQuestion.properties?.correctOptionIndices?.minItems === 1,
    JSON.stringify(assessmentQuestion.properties?.correctOptionIndices),
  );
  check(
    'create_assessment input is a top-level object (client-compatible)',
    byName.create_assessment?.inputSchema?.type === 'object',
    JSON.stringify(byName.create_assessment?.inputSchema?.type),
  );

  const plainQuestion = questionSchema(byName.create_poll);
  check(
    'create_poll cannot express correct answers at all',
    !('correctOptionIndices' in (plainQuestion.properties ?? {})),
    JSON.stringify(Object.keys(plainQuestion.properties ?? {})),
  );
  check(
    'create_poll has no pollType field to smuggle TRIAL through',
    !('pollType' in (byName.create_poll?.inputSchema?.properties ?? {})),
    JSON.stringify(Object.keys(byName.create_poll?.inputSchema?.properties ?? {})),
  );

  check(
    'convert_poll_to_assessment requires questions up front',
    (byName.convert_poll_to_assessment?.inputSchema?.required ?? []).includes('questions'),
    JSON.stringify(byName.convert_poll_to_assessment?.inputSchema?.required),
  );
  check(
    'convert_poll_to_assessment requires answers per question',
    (questionSchema(byName.convert_poll_to_assessment).required ?? []).includes('correctOptionIndices'),
    JSON.stringify(questionSchema(byName.convert_poll_to_assessment).required),
  );

  check(
    'edit_poll keeps answers optional (enforced against the stored poll instead)',
    !(questionSchema(byName.edit_poll).required ?? []).includes('correctOptionIndices'),
    JSON.stringify(questionSchema(byName.edit_poll).required),
  );
  check(
    'edit_poll cannot change pollType',
    !('pollType' in (byName.edit_poll?.inputSchema?.properties ?? {})),
    JSON.stringify(Object.keys(byName.edit_poll?.inputSchema?.properties ?? {})),
  );

  check(
    'create_poll description steers scored work to create_assessment',
    /create_assessment/.test(byName.create_poll?.description ?? ''),
    byName.create_poll?.description ?? '(none)',
  );

  // --- 2. create_assessment persists a gradeable TRIAL --------------------
  console.log('\n[2] create_assessment');
  const created = await callTool('create_assessment', {
    title: `MCP Assessment Probe ${Date.now()}`,
    passingScorePercentage: 60,
    isAnonymous: false,
    questions: ASSESSMENT_QUESTIONS,
  });
  check('create_assessment succeeds', !created.isError, created.text.slice(0, 300));
  const assessment = created.data?.poll;
  check('persisted pollType is TRIAL', assessment?.pollType === 'TRIAL', `got ${assessment?.pollType}`);
  check('passingScorePercentage persisted', assessment?.passingScorePercentage === 60, `got ${assessment?.passingScorePercentage}`);
  check(
    'q1 correctOptionIndices persisted',
    JSON.stringify(assessment?.questions?.[0]?.correctOptionIndices) === '[0]',
    JSON.stringify(assessment?.questions?.[0]?.correctOptionIndices),
  );
  check(
    'q2 multi correctOptionIndices persisted',
    JSON.stringify(assessment?.questions?.[1]?.correctOptionIndices) === '[0,1]',
    JSON.stringify(assessment?.questions?.[1]?.correctOptionIndices),
  );
  check('q1 points persisted', assessment?.questions?.[0]?.points === 5, `got ${assessment?.questions?.[0]?.points}`);
  check(
    'q1 explanation persisted',
    assessment?.questions?.[0]?.explanation === 'Mercury orbits nearest the Sun.',
    JSON.stringify(assessment?.questions?.[0]?.explanation),
  );

  // The answer to "how do we know the agent picked the RIGHT index?"
  console.log('\n[2b] grading echo resolves indices to option text');
  const grading = created.data?.grading;
  check('grading summary returned', Boolean(grading), JSON.stringify(created.data ?? {}).slice(0, 200));
  check('reported gradeable', grading?.gradeable === true, JSON.stringify(grading?.gradeable));
  check('maxScore summed from points', grading?.maxScore === 8, `got ${grading?.maxScore}`);
  check(
    'q1 answer resolved to "Mercury"',
    JSON.stringify(grading?.questions?.[0]?.correctAnswers) === '["Mercury"]',
    JSON.stringify(grading?.questions?.[0]?.correctAnswers),
  );
  check(
    'q2 answers resolved to Jupiter + Saturn',
    JSON.stringify(grading?.questions?.[1]?.correctAnswers) === '["Jupiter","Saturn"]',
    JSON.stringify(grading?.questions?.[1]?.correctAnswers),
  );

  if (assessment?._id) {
    const fetched = await callTool('get_poll', { pollId: assessment._id });
    check('get_poll round-trips pollType TRIAL', fetched.data?.poll?.pollType === 'TRIAL', fetched.text.slice(0, 200));
    check(
      'get_poll round-trips correct answers',
      JSON.stringify(fetched.data?.poll?.questions?.[0]?.correctOptionIndices) === '[0]',
      JSON.stringify(fetched.data?.poll?.questions?.[0]?.correctOptionIndices),
    );
  }

  // --- 3. create_poll stays ungraded -------------------------------------
  console.log('\n[3] create_poll is ungraded-only');
  const plain = await callTool('create_poll', {
    title: `MCP Plain Probe ${Date.now()}`,
    questions: [{ text: 'Best street food?', options: ['Tacos', 'Samosa'] }],
  });
  check('create_poll succeeds', !plain.isError, plain.text.slice(0, 300));
  check('pollType is POLL', plain.data?.poll?.pollType === 'POLL', `got ${plain.data?.poll?.pollType}`);
  check('no grading summary for an ungraded poll', plain.data?.grading === undefined, JSON.stringify(plain.data?.grading));

  const smuggled = await callTool('create_poll', {
    title: `MCP Smuggle Probe ${Date.now()}`,
    pollType: 'TRIAL',
    questions: [{ text: 'Pick one', options: ['A', 'B'], correctOptionIndices: [0] }],
  });
  check(
    'a TRIAL smuggled into create_poll still lands as an ungraded POLL',
    !smuggled.isError && smuggled.data?.poll?.pollType === 'POLL',
    `got ${smuggled.data?.poll?.pollType} / ${smuggled.text.slice(0, 150)}`,
  );
  check(
    'smuggled correct answers are dropped, not persisted',
    JSON.stringify(smuggled.data?.poll?.questions?.[0]?.correctOptionIndices) === '[]',
    JSON.stringify(smuggled.data?.poll?.questions?.[0]?.correctOptionIndices),
  );

  // --- 4. server-side rejections (defence behind the schema) --------------
  console.log('\n[4] ungradeable or contradictory assessments are rejected');
  const noAnswers = await callTool('create_assessment', {
    title: `MCP Assessment NoAnswers ${Date.now()}`,
    questions: [{ text: 'Capital of France?', options: ['Paris', 'Lyon'] }],
  });
  check('assessment with no correctOptionIndices rejected', noAnswers.isError, noAnswers.text.slice(0, 200));

  const emptyAnswers = await callTool('create_assessment', {
    title: `MCP Assessment Empty ${Date.now()}`,
    questions: [{ text: 'Capital of France?', options: ['Paris', 'Lyon'], correctOptionIndices: [] }],
  });
  check('empty correctOptionIndices rejected', emptyAnswers.isError, emptyAnswers.text.slice(0, 200));

  const outOfRange = await callTool('create_assessment', {
    title: `MCP Assessment OutOfRange ${Date.now()}`,
    questions: [{ text: 'Capital of France?', options: ['Paris', 'Lyon'], correctOptionIndices: [7] }],
  });
  check('out-of-range correct index rejected', outOfRange.isError, outOfRange.text.slice(0, 200));
  check('rejection names the valid range', /valid range 0-1/.test(outOfRange.text), outOfRange.text.slice(0, 200));

  const multiOnSingle = await callTool('create_assessment', {
    title: `MCP Assessment MultiSingle ${Date.now()}`,
    questions: [
      { text: 'Capital of France?', options: ['Paris', 'Lyon'], type: 'single', correctOptionIndices: [0, 1] },
    ],
  });
  check('two correct answers on a "single" question rejected', multiOnSingle.isError, multiOnSingle.text.slice(0, 200));

  // --- 5. conversion ------------------------------------------------------
  console.log('\n[5] convert_poll_to_assessment');
  const plainId = plain.data?.poll?._id;
  if (plainId) {
    const bare = await callTool('convert_poll_to_assessment', { pollId: plainId });
    check('conversion without questions rejected', bare.isError, bare.text.slice(0, 200));

    const converted = await callTool('convert_poll_to_assessment', {
      pollId: plainId,
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
    check('conversion with questions succeeds', !converted.isError, converted.text.slice(0, 300));
    check('converted poll is TRIAL', converted.data?.poll?.pollType === 'TRIAL', `got ${converted.data?.poll?.pollType}`);
    check(
      'converted question carries its correct answer',
      JSON.stringify(converted.data?.poll?.questions?.[0]?.correctOptionIndices) === '[1]',
      JSON.stringify(converted.data?.poll?.questions?.[0]?.correctOptionIndices),
    );
    check(
      'conversion echoes the resolved answer',
      JSON.stringify(converted.data?.grading?.questions?.[0]?.correctAnswers) === '["Samosa"]',
      JSON.stringify(converted.data?.grading?.questions?.[0]?.correctAnswers),
    );

    const reread = await callTool('get_poll', { pollId: plainId });
    check('conversion survives a re-read', reread.data?.poll?.pollType === 'TRIAL', reread.text.slice(0, 200));

    // --- 6. the regression: editing a live assessment ---------------------
    console.log('\n[6] edit_poll cannot silently un-grade an assessment');
    const stripped = await callTool('edit_poll', {
      pollId: plainId,
      questions: [{ text: 'Best street food, really?', options: ['Tacos', 'Samosa'] }],
    });
    check('answerless questions rejected on a stored assessment', stripped.isError, stripped.text.slice(0, 250));
    check(
      'rejection names the offending question number',
      /Missing on question\(s\): 1/.test(stripped.text),
      stripped.text.slice(0, 250),
    );

    const afterFailedEdit = await callTool('get_poll', { pollId: plainId });
    check(
      'the stored assessment still has its answers after the rejected edit',
      JSON.stringify(afterFailedEdit.data?.poll?.questions?.[0]?.correctOptionIndices) === '[1]',
      JSON.stringify(afterFailedEdit.data?.poll?.questions?.[0]?.correctOptionIndices),
    );

    const goodEdit = await callTool('edit_poll', {
      pollId: plainId,
      title: 'Street Food Assessment (edited)',
      questions: [
        { text: 'Best street food?', options: ['Tacos', 'Samosa'], correctOptionIndices: [0], points: 4 },
      ],
    });
    check('edit with answers intact succeeds', !goodEdit.isError, goodEdit.text.slice(0, 250));
    check(
      'edit echoes the new resolved answer',
      JSON.stringify(goodEdit.data?.grading?.questions?.[0]?.correctAnswers) === '["Tacos"]',
      JSON.stringify(goodEdit.data?.grading?.questions?.[0]?.correctAnswers),
    );
  } else {
    check('plain poll id available for conversion tests', false, plain.text.slice(0, 200));
  }

  // --- 7. read tools still work on an assessment -------------------------
  console.log('\n[7] other tools still work against an assessment');
  if (assessment?._id) {
    const share = await callTool('get_share_link', { pollId: assessment._id });
    check('get_share_link works', !share.isError && Boolean(share.data?.shareUrl), share.text.slice(0, 200));
    const analytics = await callTool('get_poll_analytics', { pollId: assessment._id });
    check('get_poll_analytics works', !analytics.isError, analytics.text.slice(0, 200));
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (assessment?._id) console.log(`Assessment poll id: ${assessment._id}`);
  if (plainId) console.log(`Converted poll id: ${plainId}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('probe crashed:', err.response?.data || err.message || err);
  process.exit(1);
});
