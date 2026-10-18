import { describe, expect, it } from 'bun:test';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/** W2-D spike: prom-client collects custom and default process metrics under Bun. */
describe('spike: prom-client', () => {
  it('exposes counters, gauges, histograms and default metrics', async () => {
    const register = new Registry();
    collectDefaultMetrics({ register });
    const answers = new Counter({
      name: 'openpoll_answers_total',
      help: 'Accepted answers',
      labelNames: ['via'],
      registers: [register],
    });
    const sockets = new Gauge({ name: 'openpoll_sockets', help: 'Connected sockets', registers: [register] });
    const latency = new Histogram({
      name: 'openpoll_http_request_duration_seconds',
      help: 'HTTP latency',
      labelNames: ['route'],
      buckets: [0.05, 0.1, 0.5],
      registers: [register],
    });

    answers.inc({ via: 'socket' }, 3);
    sockets.set(7);
    latency.observe({ route: '/api/presentations/:id/answer' }, 0.07);

    const text = await register.metrics();
    expect(register.contentType).toStartWith('text/plain');
    expect(text).toContain('openpoll_answers_total{via="socket"} 3');
    expect(text).toContain('openpoll_sockets 7');
    expect(text).toContain('openpoll_http_request_duration_seconds_bucket{le="0.1",route="/api/presentations/:id/answer"} 1');
    for (const name of [
      'process_cpu_seconds_total',
      'process_resident_memory_bytes',
      'nodejs_heap_size_used_bytes',
      'nodejs_eventloop_lag_seconds',
    ]) {
      expect(text).toContain(`# TYPE ${name}`);
    }
  });
});
