import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { Server } from 'socket.io';

/**
 * Prometheus metrics (W2-D). One registry per process, served by `GET /metrics`
 * behind `METRICS_TOKEN` (`modules/metrics/metrics.route.ts`). Metrics are
 * always collected — the cost is a few counters — so turning the endpoint on
 * needs no restart of anything but the env.
 *
 * Every instance exposes its own numbers; Prometheus scrapes each instance and
 * sums. Label values are bounded: routes are Express route patterns, never raw
 * URLs; reasons are the fixed answer-path codes.
 */
export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ app: 'openpoll-backend' });
collectDefaultMetrics({ register: metricsRegistry });

const registers = [metricsRegistry];

/** Request latency by route pattern (`/api/presentations/:id/answer`). */
export const httpRequestDuration = new Histogram({
  name: 'openpoll_http_request_duration_seconds',
  help: 'HTTP request latency by method, route pattern and status code',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2.5, 5],
  registers,
});

export const socketConnections = new Gauge({
  name: 'openpoll_socket_connections',
  help: 'Socket.io connections open on this instance',
  registers,
});

export const answersAccepted = new Counter({
  name: 'openpoll_answers_accepted_total',
  help: 'Answers accepted by the live answer path (replays of an accepted answer count as replay="true")',
  labelNames: ['via', 'replay'] as const,
  registers,
});

export const answersRejected = new Counter({
  name: 'openpoll_answers_rejected_total',
  help: 'Answers refused by the live answer path, by reason',
  labelNames: ['via', 'reason'] as const,
  registers,
});

/** Server time to handle one answer (REST or socket), from validation to the reply. */
export const answerDuration = new Histogram({
  name: 'openpoll_answer_duration_seconds',
  help: 'Live answer handling time, by channel',
  labelNames: ['via'] as const,
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1],
  registers,
});

export const redisCommandDuration = new Histogram({
  name: 'openpoll_redis_command_duration_seconds',
  help: 'Latency of instrumented Redis calls on the live hot path, by operation',
  labelNames: ['op', 'outcome'] as const,
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1],
  registers,
});

export const liveEventsCoalesced = new Counter({
  name: 'openpoll_live_answer_updates_total',
  help: 'Coalesced host answer:received updates published (one per dirty slide per 250ms window)',
  registers,
});

export const autoReveals = new Counter({
  name: 'openpoll_live_auto_reveals_total',
  help: 'Scored timed slides revealed automatically after their timer',
  registers,
});

/** The exposition text and its content type. */
export const renderMetrics = async () => ({
  contentType: metricsRegistry.contentType,
  body: await metricsRegistry.metrics(),
});

/** Counts this instance's Socket.io connections into `openpoll_socket_connections`. */
export const trackSocketConnections = (io: Server) => {
  io.on('connection', (socket) => {
    socketConnections.inc();
    socket.once('disconnect', () => socketConnections.dec());
  });
};
