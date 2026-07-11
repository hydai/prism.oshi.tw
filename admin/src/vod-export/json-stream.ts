const JSON_STREAM_CHUNK_CODE_UNITS = 8_192;
const jsonStreamEncoder = new TextEncoder();

/**
 * Produces compact JSON incrementally so a 4 MiB private findings payload does
 * not require one equally large JSON string in the Worker isolate.
 */
export function createCompactJsonStream(value: unknown): ReadableStream<Uint8Array> {
  const chunks = compactJsonChunks(value);
  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      const next = chunks.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(jsonStreamEncoder.encode(next.value));
    },
    cancel(): void {
      chunks.return?.();
    },
  });
}

/** Exposed for exact serializer tests and allocation-free stress accounting. */
export function* compactJsonChunks(value: unknown): Generator<string, void, undefined> {
  let buffered = '';
  for (const token of jsonTokens(value, false)) {
    if (buffered.length > 0 && buffered.length + token.length > JSON_STREAM_CHUNK_CODE_UNITS) {
      yield buffered;
      buffered = '';
    }
    if (token.length >= JSON_STREAM_CHUNK_CODE_UNITS) {
      if (buffered.length > 0) {
        yield buffered;
        buffered = '';
      }
      yield token;
    } else {
      buffered += token;
    }
  }
  if (buffered.length > 0) yield buffered;
}

function* jsonTokens(value: unknown, arrayElement: boolean): Generator<string, void, undefined> {
  if (value === null) {
    yield 'null';
    return;
  }
  switch (typeof value) {
    case 'string':
      yield* quotedStringTokens(value);
      return;
    case 'boolean':
      yield value ? 'true' : 'false';
      return;
    case 'number':
      yield Number.isFinite(value) ? String(value === 0 ? 0 : value) : 'null';
      return;
    case 'undefined':
    case 'function':
    case 'symbol':
      if (arrayElement) yield 'null';
      return;
    case 'bigint':
      throw new TypeError('BigInt cannot be serialized to JSON');
    case 'object':
      break;
  }

  if (Array.isArray(value)) {
    yield '[';
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) yield ',';
      const element = value[index];
      if (!containsLongString(element, 0)) {
        const compact = JSON.stringify(element);
        yield compact ?? 'null';
      } else {
        yield* jsonTokens(element, true);
      }
    }
    yield ']';
    return;
  }

  const record = value as Record<string, unknown>;
  yield '{';
  let emitted = 0;
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue;
    if (emitted > 0) yield ',';
    yield* quotedStringTokens(key);
    yield ':';
    yield* jsonTokens(child, false);
    emitted += 1;
  }
  yield '}';
}

function containsLongString(value: unknown, depth: number): boolean {
  if (typeof value === 'string') return value.length > JSON_STREAM_CHUNK_CODE_UNITS / 2;
  if (value === null || typeof value !== 'object') return false;
  if (depth >= 8) return true;
  if (Array.isArray(value)) {
    for (const child of value) {
      if (containsLongString(child, depth + 1)) return true;
    }
    return false;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (containsLongString(child, depth + 1)) return true;
  }
  return false;
}

function* quotedStringTokens(value: string): Generator<string, void, undefined> {
  yield '"';
  let chunk = '';
  const flush = function* (): Generator<string, void, undefined> {
    if (chunk.length === 0) return;
    yield chunk;
    chunk = '';
  };

  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    let encoded: string;
    if (first === 0x22) encoded = '\\"';
    else if (first === 0x5c) encoded = '\\\\';
    else if (first === 0x08) encoded = '\\b';
    else if (first === 0x0c) encoded = '\\f';
    else if (first === 0x0a) encoded = '\\n';
    else if (first === 0x0d) encoded = '\\r';
    else if (first === 0x09) encoded = '\\t';
    else if (first < 0x20) encoded = `\\u${first.toString(16).padStart(4, '0')}`;
    else if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        encoded = value.slice(index, index + 2);
        index += 1;
      } else {
        encoded = `\\u${first.toString(16).padStart(4, '0')}`;
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      encoded = `\\u${first.toString(16).padStart(4, '0')}`;
    } else {
      encoded = value[index] ?? '';
    }

    if (chunk.length > 0 && chunk.length + encoded.length > JSON_STREAM_CHUNK_CODE_UNITS) {
      yield* flush();
    }
    chunk += encoded;
  }
  yield* flush();
  yield '"';
}
