/**
 * One-shot HTTP request with streaming timing.
 *
 * Ported from EvalScope `perf/core/http_client.py` + `perf/plugin/api/default_api.py`:
 *   - `start_time` is captured before the socket is created (includes DNS/TLS/queueing)
 *   - TTFT is the arrival of the first SSE frame that carries observable output
 *   - inter-chunk latencies are diffs between output-bearing frames
 *   - `completed_time` is the arrival of the last parsed frame (stream) or full body (non-stream)
 *   - a 200 response that carries `{"error": ...}` in-band is a failed request (vLLM/SGLang behaviour)
 *
 * Node's `http.request` is used directly instead of global fetch because we need
 * per-read timestamps, separate connect/read timeouts and a bounded keep-alive pool.
 */

import http from 'node:http';
import https from 'node:https';
import { Buffer } from 'node:buffer';
import { StreamedResponseHandler, parseChatDelta, parseSseMessage } from './sse.mjs';
import { createSample } from './metrics.mjs';

const nowSec = () => performance.now() / 1000;

export function createHttpAgent({ concurrency = 16, protocol = 'https:' } = {}) {
  const Agent = protocol === 'https:' ? https.Agent : http.Agent;
  const sockets = Math.max(1, Math.min(concurrency || 1, 4096));
  return new Agent({ keepAlive: true, maxSockets: sockets, maxFreeSockets: sockets, timeout: 60000 });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractUsage(payload, sample) {
  const usage = payload && payload.usage;
  if (usage && typeof usage === 'object' && (usage.prompt_tokens != null || usage.completion_tokens != null)) {
    sample.promptTokens = usage.prompt_tokens ?? 0;
    sample.completionTokens = usage.completion_tokens ?? 0;
    sample.tokenSource = 'usage';
    const details = usage.prompt_tokens_details;
    if (details && typeof details === 'object' && details.cached_tokens != null) {
      sample.cachedTokens = details.cached_tokens;
    }
  }
}

function extractMeta(payload, sample) {
  if (!payload || typeof payload !== 'object') return;
  if (typeof payload.model === 'string' && payload.model) sample.reportedModel = payload.model;
  if (typeof payload.system_fingerprint === 'string' && payload.system_fingerprint) {
    sample.systemFingerprint = payload.system_fingerprint;
  }
  const choices = payload.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0].finish_reason === 'string') {
    sample.finishReason = choices[0].finish_reason;
  }
}

function extractCompletionsText(payload) {
  const choices = payload && payload.choices;
  if (!Array.isArray(choices) || !choices.length) return '';
  const first = choices[0] || {};
  const message = first.message;
  if (message && typeof message === 'object') {
    return `${message.content || ''}${message.reasoning_content || ''}`;
  }
  return first.text || '';
}

/**
 * Send a single JSON POST and produce a BenchmarkSample.
 *
 * @param {object} options
 * @param {string} options.url             full endpoint URL
 * @param {Record<string,string>} options.headers
 * @param {object} options.body            JSON request body
 * @param {string} [options.promptText]    prompt text, for token estimation fallback only
 * @param {import('node:http').Agent} options.agent
 * @param {number} [options.totalTimeoutMs]
 * @param {number} [options.connectTimeoutMs]
 * @param {number} [options.readTimeoutMs]
 * @returns {Promise<object>} sample
 */
export function postOnce(options) {
  const {
    url,
    headers = {},
    body,
    promptText = '',
    agent,
    totalTimeoutMs = 6 * 60 * 60 * 1000,
    connectTimeoutMs = 30000,
    readTimeoutMs = 120000,
    maxNonStreamBodyBytes = 8 * 1024 * 1024,
  } = options;

  const sample = createSample();
  const start = nowSec();
  sample.startTime = start;
  sample.isStream = body && body.stream === true;
  sample.request = JSON.stringify(body);
  sample.promptText = promptText;

  const data = Buffer.from(JSON.stringify(body));
  let settled = false;
  let totalTimer = null;
  let connectTimer = null;

  return new Promise((resolve) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      if (totalTimer) clearTimeout(totalTimer);
      if (connectTimer) clearTimeout(connectTimer);
      if (sample.completedTime < sample.startTime) sample.completedTime = nowSec();
      if (sample.queryLatency <= 0) sample.queryLatency = Math.max(0, sample.completedTime - sample.startTime);
      resolve(sample);
    };

    const fail = (error) => {
      sample.success = false;
      sample.error = error instanceof Error ? error.message : String(error);
      sample.completedTime = nowSec();
      sample.queryLatency = Math.max(0, sample.completedTime - sample.startTime);
      finish();
    };

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      fail(new Error(`非法 URL：${url}`));
      return;
    }
    const module = parsedUrl.protocol === 'https:' ? https : http;
    const requestHeaders = {
      'content-type': 'application/json',
      'content-length': data.length,
      'user-agent': 'dsh-llm-api-perf/1.0',
      accept: sample.isStream ? 'text/event-stream' : 'application/json',
      ...headers,
    };

    let req;
    try {
      req = module.request(
        {
          protocol: parsedUrl.protocol,
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: `${parsedUrl.pathname}${parsedUrl.search}`,
          method: 'POST',
          headers: requestHeaders,
          agent,
        },
        (res) => {
          if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = null;
          }
          const status = res.statusCode || 0;
          const contentType = String(res.headers['content-type'] || '');
          let mostRecent = start;
          let lastOutputTimestamp = null;
          const handler = new StreamedResponseHandler();
          let chunks = [];

          const onMessage = (message) => {
            if (message.startsWith(':')) return;
            const payload = parseSseMessage(message);
            if (!payload) return;
            const timestamp = nowSec();
            if (payload.error != null || payload.object === 'error') {
              sample.error = JSON.stringify(payload);
            }
            const choices = payload.choices;
            if (Array.isArray(choices) && choices.length) {
              let content = '';
              let hasOutput = false;
              if (payload.object === 'text_completion') {
                content = choices[0] && choices[0].text ? choices[0].text : '';
                hasOutput = Boolean(content);
              } else {
                const delta = (choices[0] && choices[0].delta) || {};
                [content, hasOutput] = parseChatDelta(delta);
              }
              if (hasOutput) {
                if (lastOutputTimestamp == null) sample.firstChunkLatency = timestamp - start;
                else sample.interChunkLatency.push(timestamp - lastOutputTimestamp);
                lastOutputTimestamp = timestamp;
              }
              if (lastOutputTimestamp != null) {
                sample.nDecodeChunks += 1;
                sample.chunkTimes.push(timestamp);
              }
              sample.generatedText += content;
            }
            extractUsage(payload, sample);
            extractMeta(payload, sample);
            mostRecent = timestamp;
          };

          if (status === 200 && contentType.includes('text/event-stream')) {
            sample.isStream = true;
            res.on('data', (chunk) => {
              if (!chunk || !chunk.length) return;
              let messages;
              try {
                messages = handler.addChunk(chunk);
              } catch (error) {
                fail(error);
                res.destroy();
                return;
              }
              for (const message of messages) onMessage(message);
            });
            res.on('end', () => {
              sample.success = sample.error == null;
              sample.completedTime = mostRecent;
              sample.queryLatency = Math.max(0, mostRecent - start);
              if (lastOutputTimestamp == null) {
                // 200 but no output frame: keep TTFT at 0 like EvalScope does.
                sample.firstChunkLatency = 0;
              }
              finish();
            });
            res.on('error', (error) => {
              sample.success = false;
              sample.error = sample.error || error.message;
              sample.completedTime = mostRecent;
              sample.queryLatency = Math.max(0, mostRecent - start);
              finish();
            });
          } else if (status === 200 && (contentType.includes('application/json') || contentType.startsWith('application/'))) {
            chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
              size += chunk.length;
              if (size > maxNonStreamBodyBytes) {
                res.destroy();
                fail(new Error(`响应体超过 ${maxNonStreamBodyBytes} 字节上限`));
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', () => {
              const timestamp = nowSec();
              sample.completedTime = timestamp;
              sample.queryLatency = Math.max(0, timestamp - start);
              sample.firstChunkLatency = sample.queryLatency;
              const payload = parseJson(Buffer.concat(chunks).toString('utf8'));
              if (payload && typeof payload === 'object') {
                sample.generatedText = extractCompletionsText(payload);
                extractUsage(payload, sample);
                extractMeta(payload, sample);
                if (payload.error != null) sample.error = JSON.stringify(payload);
              }
              sample.success = sample.error == null;
              finish();
            });
            res.on('error', fail);
          } else if (status === 200) {
            // Unknown successful content type: read as text and time the full body.
            chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
              const timestamp = nowSec();
              sample.completedTime = timestamp;
              sample.queryLatency = Math.max(0, timestamp - start);
              sample.firstChunkLatency = sample.queryLatency;
              sample.generatedText = Buffer.concat(chunks).toString('utf8');
              sample.success = true;
              finish();
            });
            res.on('error', fail);
          } else {
            sample.statusCode = status;
            chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
              size += chunk.length;
              if (size <= 64 * 1024) chunks.push(chunk);
            });
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8').slice(0, 2000);
              sample.error = text || `HTTP ${status}`;
              sample.success = false;
              sample.completedTime = nowSec();
              sample.queryLatency = Math.max(0, sample.completedTime - start);
              finish();
            });
            res.on('error', fail);
          }
        },
      );
    } catch (error) {
      fail(error);
      return;
    }

    req.on('error', fail);
    req.setTimeout(readTimeoutMs, () => {
      req.destroy(new Error(`读取超时：${readTimeoutMs}ms 内无数据`));
    });
    totalTimer = setTimeout(() => {
      req.destroy(new Error(`总超时：${totalTimeoutMs}ms`));
    }, totalTimeoutMs);
    connectTimer = setTimeout(() => {
      req.destroy(new Error(`连接超时：${connectTimeoutMs}ms`));
    }, connectTimeoutMs);
    req.write(data);
    req.end();
  });
}