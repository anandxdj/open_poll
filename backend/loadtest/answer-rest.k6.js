// k6 script: participants answer ONE open slide over REST at a constant arrival
// rate. Same API as loadtest/answer-storm.ts (which also checks durability and
// can drive Socket.io); use this one when you want k6's reports, ramping or cloud.
//
//   cd backend
//   bun loadtest/answer-storm.ts --spawn --prepare-only --participants 6000   # writes loadtest/.fixture.json
//   k6 run loadtest/answer-rest.k6.js                                          # needs a server on fixture.baseUrl
//
// --prepare-only opens slide 0 and leaves the session live, so the fixture is
// single use: every phone answers once. Run the prepare step again for another run.
// Rate and duration follow from the fixture: RATE answers/s for phones/RATE seconds.
//
// Environment (k6 -e NAME=value):
//   FIXTURE        fixture path, relative to this file    (./.fixture.json)
//   BASE_URL       override the fixture's server address
//   RATE           answers per second                      (600)
//   MIN_RPS        threshold on the accepted answer rate   (500)
//   MAX_P95_MS     threshold on p95 latency, ms            (150)
//
// Every phone sends its own X-Forwarded-For (the backend trusts one proxy hop),
// so the per-IP rate limits see a room of phones, not one machine.

import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';

const fixture = JSON.parse(open(__ENV.FIXTURE || './.fixture.json'));
const phones = new SharedArray('phones', () => fixture.phones);

const RATE = Number(__ENV.RATE || 600);
const MIN_RPS = Number(__ENV.MIN_RPS || 500);
const MAX_P95_MS = Number(__ENV.MAX_P95_MS || 150);
const BASE_URL = (__ENV.BASE_URL || fixture.baseUrl).replace(/\/$/, '');
const DURATION_S = Math.max(1, Math.floor(phones.length / RATE));

const accepted = new Counter('answers_accepted');

export const options = {
  scenarios: {
    answers: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: `${DURATION_S}s`,
      preAllocatedVUs: Math.min(500, Math.max(50, Math.ceil(RATE / 4))),
      maxVUs: 2000,
    },
  },
  thresholds: {
    // Latency of answers the server accepted, measured from the moment k6 was due to send.
    'http_req_duration{expected_response:true}': [`p(95)<${MAX_P95_MS}`],
    // A rejected answer is a failure here: the fixture has one slide, open, one answer per phone.
    http_req_failed: ['rate<0.001'],
    answers_accepted: [`rate>=${MIN_RPS}`],
  },
};

export default function () {
  const index = exec.scenario.iterationInTest;
  if (index >= phones.length) return; // the arrival rate overshot the fixture a little
  const phone = phones[index];

  const res = http.post(
    `${BASE_URL}/api/presentations/${fixture.presentationId}/answer`,
    JSON.stringify({
      participantId: phone.participantId,
      participantToken: phone.token,
      sessionId: fixture.sessionId,
      slideId: fixture.slideIds[fixture.slideIndex],
      slideIndex: fixture.slideIndex,
      optionIndex: phone.choice,
      clientAnswerId: `${phone.participantId}-k6`,
    }),
    { headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': phone.ip } }
  );

  const ok = check(res, {
    'answer accepted': (r) => r.status === 200 && r.json('data.accepted') === true,
  });
  if (ok) accepted.add(1);
}
