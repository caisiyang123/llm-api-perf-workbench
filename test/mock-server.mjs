/**
 * Deterministic mock of an OpenAI-compatible streaming endpoint.
 * Used by `node --test` so engine assertions never depend on the network.
 */

import http from 'node:http';

export function startMockServer(options = {}) {
  const {
    ttftMs = 20,
    chunkMs = 3,
    chunks = 8,
    withUsage = true,
    status = 200,
    authRequired = true,
    hangMs = 0,
    responder = null,
    models = null,
  } = options;

  const state = { requests: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        body = {};
      }
      state.requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });

      // Model discovery probe: GET {base}/models (OpenAI-compatible).
      if (models && req.method === 'GET' && /\/models\/?$/.test(req.url || '')) {
        if (authRequired && !req.headers.authorization) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'missing api key' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) }));
        return;
      }

      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'mock failure', code: status } }));
        return;
      }
      if (authRequired && !req.headers.authorization) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'missing api key' } }));
        return;
      }
      if (hangMs > 0) {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }, hangMs);
        return;
      }
      if (!body.stream) {
        // Parity/quality tests need content that depends on the target model and
        // on the prompt; the default remains a fixed 'pong' so perf tests are stable.
        const custom = typeof responder === 'function' ? responder({ body, req, path: req.url }) : null;
        const content = custom && typeof custom.content === 'string' ? custom.content : 'pong';
        const usage = custom && custom.usage
          ? custom.usage
          : { prompt_tokens: 7, completion_tokens: Math.max(1, Math.ceil(content.length / 4)) };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            usage,
            model: body.model,
          }),
        );
        return;
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
      setTimeout(() => {
        send({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' } }] });
        let emitted = 0;
        const timer = setInterval(() => {
          emitted += 1;
          if (emitted > chunks) {
            clearInterval(timer);
            if (withUsage) {
              send({ object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 12, completion_tokens: chunks } });
            }
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          send({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '字' } }] });
        }, chunkMs);
      }, ttftMs);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        state,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

export function waitForRun(manager, runId, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const run = manager.get(runId);
      if (!run) return;
      if (run.status !== 'running') {
        clearInterval(timer);
        resolve(run);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('run did not finish in time'));
      }
    }, 50);
  });
}