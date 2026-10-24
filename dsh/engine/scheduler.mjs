/**
 * Dispatch strategies — direct ports of EvalScope's closed-loop and open-loop
 * request generators (`perf/core/strategies/closed_loop.py`, `open_loop.py`).
 *
 * Closed loop: at most `parallel` requests in flight (a semaphore provides
 * back-pressure). Optional `rate` paces dispatch with a Poisson arrival process
 * while the concurrency cap still holds. Warmup requests share the same dispatch
 * loop and semaphore with **no barrier** — a barrier would drain server
 * occupancy to zero and the first measured requests would again burst together,
 * which is exactly what warmup exists to prevent.
 *
 * Open loop: requests are fired on a Poisson schedule regardless of whether the
 * server finished previous ones. Inter-arrival intervals are pre-computed and
 * rescaled so the realised rate is locked to the configured value (relative
 * `sleep(delta)` pacing drifts and silently lowers the effective QPS).
 *
 * Deviations from EvalScope, all recorded in the adaptation notes:
 *   - open loop has a hard in-flight cap (default 512) so a hung endpoint cannot
 *     exhaust local sockets; EvalScope fires unbounded.
 *   - both strategies stop on request cancellation (Ctrl-C equivalent).
 */

import { createSample } from './metrics.mjs';

const nowSec = () => performance.now() / 1000;

export function createRng(seed) {
  if (seed == null) return Math.random;
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pre-compute absolute dispatch timestamps from a Poisson process, then rescale to
 * exactly `n / rate` seconds. Mirrors the numpy implementation in EvalScope.
 */
export function poissonArrivalTimes(n, rate, random = Math.random, anchor = nowSec()) {
  if (!(rate > 0) || n <= 0) return null;
  const offsets = [];
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    // -ln(U)/rate is Exp(1/rate); guard U=0.
    let u = random();
    if (u <= 0) u = Number.MIN_VALUE;
    total += -Math.log(u) / rate;
    offsets.push(total);
  }
  const targetTotal = n / rate;
  const scale = total > 0 ? targetTotal / total : 1;
  return offsets.map((offset) => anchor + offset * scale);
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (timer.unref) timer.unref();
  });
}

async function sleepUnless(ms, cancelled) {
  const end = nowSec() + ms / 1000;
  while (nowSec() < end) {
    if (cancelled && cancelled()) return false;
    const leftMs = Math.max(0, (end - nowSec()) * 1000);
    await delay(Math.min(50, leftMs));
  }
  return !(cancelled && cancelled());
}

class Semaphore {
  constructor(limit) {
    this.limit = Math.max(1, limit);
    this.active = 0;
    this.queue = [];
  }

  acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) {
      this.active += 1;
      next();
    }
  }
}

/**
 * @param {object} options
 * @param {Array<{body: object, promptText?: string, isWarmup?: boolean}>} options.requests
 * @param {(request: object) => Promise<object>} options.sendRequest
 * @param {(sample: object) => void} [options.onSample]
 * @param {number} options.parallel
 * @param {number} [options.rate] -1 = no pacing
 * @param {number} [options.inFlightMultiplier]
 * @param {number|null} [options.durationSec]
 * @param {() => boolean} [options.cancelled]
 */
export async function runClosedLoop(options) {
  const {
    requests,
    sendRequest,
    onSample,
    parallel = 1,
    rate = -1,
    inFlightMultiplier = 2,
    durationSec = null,
    cancelled,
  } = options;

  const semaphore = new Semaphore(parallel);
  const maxInFlight = Math.max(1, parallel * Math.max(1, inFlightMultiplier));
  const inFlight = new Set();
  const targetTimes = poissonArrivalTimes(requests.length, rate);
  let deadline = null;
  let dispatched = 0;
  let stopped = false;

  const dispatchOne = (item) => {
    const task = (async () => {
      await semaphore.acquire();
      try {
        if (cancelled && cancelled()) return null;
        // The timed window starts on the first *measured* request that actually
        // goes out, not on the first dispatch: warmup holds every slot first.
        if (deadline == null && !item.isWarmup && durationSec != null) {
          deadline = nowSec() + durationSec;
        }
        const sample = await sendRequest(item);
        sample.isWarmup = Boolean(item.isWarmup);
        if (opts.onSample) opts.onSample(sample);
        return sample;
      } finally {
        semaphore.release();
      }
    })();
    const tracked = task.finally(() => inFlight.delete(tracked)).catch(() => null);
    inFlight.add(tracked);
    return task;
  };

  const opts = { onSample };
  for (let i = 0; i < requests.length; i += 1) {
    const item = requests[i];
    if (cancelled && cancelled()) {
      stopped = true;
      break;
    }
    if (deadline != null && nowSec() >= deadline) {
      stopped = true;
      break;
    }
    if (targetTimes) {
      let sleepMs = (targetTimes[i] - nowSec()) * 1000;
      if (deadline != null) sleepMs = Math.min(sleepMs, (deadline - nowSec()) * 1000);
      if (sleepMs > 0 && !(await sleepUnless(sleepMs, cancelled))) {
        stopped = true;
        break;
      }
    }
    while (inFlight.size >= maxInFlight) {
      await Promise.race(inFlight);
    }
    dispatchOne(item);
    dispatched += 1;
  }

  await Promise.allSettled([...inFlight]);
  while (inFlight.size) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.race(inFlight);
  }
  return { dispatched, skipped: requests.length - dispatched, stopped };
}

/**
 * @param {object} options same as runClosedLoop, plus `maxInFlight`
 */
export async function runOpenLoop(options) {
  const {
    requests,
    sendRequest,
    onSample,
    rate = 0,
    durationSec = null,
    maxInFlight = 512,
    cancelled,
  } = options;

  const emit = (sample, isWarmup) => {
    sample.isWarmup = Boolean(isWarmup);
    if (onSample) onSample(sample);
    return sample;
  };

  const inFlight = new Set();
  const launch = (item, isWarmup) => {
    const task = (async () => {
      if (cancelled && cancelled()) return null;
      const sample = await sendRequest(item);
      return emit(sample, isWarmup);
    })();
    const tracked = task.finally(() => inFlight.delete(tracked)).catch(() => null);
    inFlight.add(tracked);
    return task;
  };

  const warmup = requests.filter((item) => item.isWarmup);
  const measured = requests.filter((item) => !item.isWarmup);
  let dispatched = 0;
  let stopped = false;

  if (!(rate > 0)) throw new Error('开环模式必须设置大于 0 的到达速率');

  // Warmup phase mirrors EvalScope: it is paced by the same target rate but
  // ignores --duration, and it must drain before the timed window is anchored.
  if (warmup.length) {
    const warmupTimes = poissonArrivalTimes(warmup.length, rate);
    for (let i = 0; i < warmup.length; i += 1) {
      if (cancelled && cancelled()) {
        stopped = true;
        break;
      }
      const sleepMs = (warmupTimes[i] - nowSec()) * 1000;
      if (sleepMs > 0 && !(await sleepUnless(sleepMs, cancelled))) {
        stopped = true;
        break;
      }
      while (inFlight.size >= maxInFlight) await Promise.race(inFlight);
      launch(warmup[i], true);
      dispatched += 1;
    }
    await Promise.allSettled([...inFlight]);
  }

  if (!stopped) {
    const targetTimes = poissonArrivalTimes(measured.length, rate);
    let deadline = null;
    for (let i = 0; i < measured.length; i += 1) {
      if (cancelled && cancelled()) {
        stopped = true;
        break;
      }
      let sleepMs = (targetTimes[i] - nowSec()) * 1000;
      if (deadline != null) sleepMs = Math.min(sleepMs, (deadline - nowSec()) * 1000);
      if (sleepMs > 0 && !(await sleepUnless(sleepMs, cancelled))) {
        stopped = true;
        break;
      }
      if (i === 0 && durationSec != null) deadline = nowSec() + durationSec;
      if (deadline != null && nowSec() >= deadline) {
        stopped = true;
        break;
      }
      while (inFlight.size >= maxInFlight) await Promise.race(inFlight);
      launch(measured[i], false);
      dispatched += 1;
    }
  }

  await Promise.allSettled([...inFlight]);
  while (inFlight.size) await Promise.race(inFlight);
  return { dispatched, skipped: requests.length - dispatched, stopped };
}

/** Connection probe: one non-streaming tiny request, reusing the timing path. */
export async function probeConnection({ sendRequest, timeoutBudget = 30000 }) {
  const sample = createSample();
  const start = nowSec();
  sample.startTime = start;
  const result = await Promise.race([
    sendRequest({ body: { stream: false, max_tokens: 8 }, promptText: 'ping', isWarmup: true }),
    delay(timeoutBudget).then(() => {
      const timeoutSample = createSample();
      timeoutSample.startTime = start;
      timeoutSample.completedTime = nowSec();
      timeoutSample.queryLatency = timeoutSample.completedTime - start;
      timeoutSample.success = false;
      timeoutSample.error = `连通性测试超时（${timeoutBudget}ms）`;
      return timeoutSample;
    }),
  ]);
  return result;
}