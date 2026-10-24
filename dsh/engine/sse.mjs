/**
 * SSE framing + OpenAI streaming payload parsing.
 *
 * Ported from EvalScope:
 *   - `perf/plugin/api/default_api.py::StreamedResponseHandler`  (incremental UTF-8,
 *     CRLF normalisation, `data:` flattening, `[DONE]` handling, trailing-buffer handling)
 *   - `perf/plugin/api/default_api.py::_parse_chat_delta`        (observable-output detection)
 *
 * Why this is not a naive `split('\n\n')`: a multibyte UTF-8 character or an SSE
 * frame can straddle two TCP reads. A naive split either throws on the partial
 * character or drops the frame; both corrupt TTFT.
 */

const DATA_PREFIX = /^data:/;

export class StreamedResponseHandler {
  constructor() {
    this.buffer = '';
    this.decoder = new TextDecoder('utf-8');
  }

  static extractSsePayload(message) {
    const values = [];
    for (const line of message.trim().split('\n')) {
      if (DATA_PREFIX.test(line)) values.push(line.replace(DATA_PREFIX, '').replace(/^ /, ''));
    }
    if (!values.length) return null;
    const payload = values.join('').trim();
    return payload ? `data: ${payload}` : null;
  }

  addChunk(bytes) {
    let chunkStr;
    try {
      chunkStr = this.decoder.decode(bytes, { stream: true });
    } catch {
      this.decoder = new TextDecoder('utf-8');
      chunkStr = Buffer.from(bytes).toString('utf8');
    }
    this.buffer += chunkStr.replace(/\r\n/g, '\n');

    const messages = [];
    while (this.buffer.includes('\n\n')) {
      const index = this.buffer.indexOf('\n\n');
      const message = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      const normalized = StreamedResponseHandler.extractSsePayload(message);
      if (normalized) messages.push(normalized);
    }

    const normalizedBuffer = StreamedResponseHandler.extractSsePayload(this.buffer);
    if (normalizedBuffer) {
      const content = normalizedBuffer.replace(DATA_PREFIX, '').trim();
      if (content === '[DONE]') {
        messages.push(normalizedBuffer);
        this.buffer = '';
      } else if (content) {
        try {
          JSON.parse(content);
          messages.push(normalizedBuffer);
          this.buffer = '';
        } catch {
          // Incomplete JSON: wait for more bytes.
        }
      }
    }
    return messages;
  }
}

/**
 * Return `[text, hasOutput]` for a chat delta. Reasoning text counts as generated
 * output for timing; structured reasoning / tool calls count as output for timing
 * but never contribute text (providers disagree on incremental vs cumulative).
 */
export function parseChatDelta(delta) {
  if (!delta || typeof delta !== 'object') return ['', false];

  const content = typeof delta.content === 'string' ? delta.content : '';
  let reasoning = typeof delta.reasoning_content === 'string' && delta.reasoning_content
    ? delta.reasoning_content
    : delta.reasoning;
  if (typeof reasoning !== 'string') reasoning = '';
  const text = content + reasoning;
  if (text) return [text, true];

  const toolCalls = delta.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      const fn = call && typeof call === 'object' ? call.function : null;
      if (fn && typeof fn === 'object' && ((typeof fn.name === 'string' && fn.name) || (typeof fn.arguments === 'string' && fn.arguments))) {
        return ['', true];
      }
    }
  }

  const reasoningDetails = delta.reasoning_details;
  if (Array.isArray(reasoningDetails)) {
    for (const detail of reasoningDetails) {
      if (!detail || typeof detail !== 'object') continue;
      if ((typeof detail.text === 'string' && detail.text) || (typeof detail.summary === 'string' && detail.summary)) {
        return ['', true];
      }
    }
  }
  return ['', false];
}

/** Strip `data: ` prefix and JSON-parse one SSE message; null for `[DONE]` / junk. */
export function parseSseMessage(message) {
  const raw = message.replace(DATA_PREFIX, '').trim();
  if (!raw || raw === '[DONE]') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}