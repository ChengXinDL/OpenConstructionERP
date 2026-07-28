// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Unit tests for the resumable upload client's recovery from a refused
 * completion.
 *
 * The backend answers a completion it cannot assemble with a 409 carrying
 * ``missing_chunks``: the scratch copies of those chunks were lost between
 * upload and assembly, which is ordinary because the chunk root is a temp
 * directory. The bytes are still in the user's file, so the recovery is to
 * resend exactly the named chunks and ask again. Before this the client threw
 * on any non-ok completion, so one lost scratch file cost the whole upload.
 *
 * What matters here is the *shape* of the recovery: only the gap is resent,
 * completion is retried exactly once, and a failure that names no gap is
 * surfaced untouched rather than triggering a pointless resend.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/shared/lib/api', () => ({
  API_BASE: 'http://test.local/api',
  getAuthToken: () => 'test-token',
}));

import { uploadResumable } from './resumableUpload';

/** A 10-byte file the mocked session splits into three chunks. */
const FILE_SIZE = 10;
const CHUNK_SIZE = 4;
const TOTAL_CHUNKS = 3;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SESSION = {
  id: 'S1',
  chunk_size: CHUNK_SIZE,
  total_chunks: TOTAL_CHUNKS,
  received_chunks: [],
  // Empty on a fresh session; the client expands this to the full range.
  missing_chunks: [],
  status: 'in_progress',
};

const COMPLETED = {
  session_id: 'S1',
  document_id: 'DOC-1',
  filename: 'big.bin',
  file_size: FILE_SIZE,
  status: 'complete',
};

interface Harness {
  /** Chunk indices PUT to the server, in order, across all attempts. */
  puts: number[];
  /** How many times completion was requested. */
  completes: number;
}

/**
 * Install a fetch mock driven by ``completeResponses``: the Nth completion
 * request is answered with the Nth entry, the last entry repeating.
 */
function harness(completeResponses: Array<() => Response>): Harness {
  const state: Harness = { puts: [], completes: 0 };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      const chunk = /\/chunks\/(\d+)\//.exec(url);
      if (chunk) {
        state.puts.push(Number(chunk[1]));
        return new Response(null, { status: 200 });
      }

      if (url.endsWith('/complete/')) {
        const index = Math.min(state.completes, completeResponses.length - 1);
        state.completes += 1;
        return completeResponses[index]!();
      }

      if (url.endsWith('/sessions/')) return jsonResponse(200, SESSION);

      throw new Error(`unexpected request to ${url}`);
    }),
  );

  return state;
}

function testFile(): File {
  return new File([new Uint8Array(FILE_SIZE)], 'big.bin');
}

const OPTIONS = { projectId: 'P1', category: 'other' };

const gapRefusal = () =>
  jsonResponse(409, { detail: { error: 'upload incomplete', missing_chunks: [1] } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadResumable - a completion refused for lost chunks', () => {
  it('resends only the chunks the refusal names, then completes', async () => {
    const state = harness([gapRefusal, () => jsonResponse(200, COMPLETED)]);

    const result = await uploadResumable(testFile(), OPTIONS);

    // The full pass, then chunk 1 alone. A client that restarted the upload
    // would show 0,1,2,0,1,2 here and cost the user the whole file again.
    expect(state.puts).toEqual([0, 1, 2, 1]);
    expect(state.completes).toBe(2);
    expect(result.documentId).toBe('DOC-1');
  });

  it('gives up after one resend rather than looping on a chunk that keeps vanishing', async () => {
    const state = harness([gapRefusal]);

    await expect(uploadResumable(testFile(), OPTIONS)).rejects.toThrow(/missing_chunks/);

    expect(state.completes).toBe(2);
    expect(state.puts).toEqual([0, 1, 2, 1]);
  });

  it('surfaces a failure that names no gap without resending anything', async () => {
    // An integrity mismatch is terminal: the bytes on the server are wrong, so
    // resending the same bytes cannot help and must not be attempted.
    const state = harness([
      () => jsonResponse(400, { detail: 'integrity check failed: sha256 mismatch' }),
    ]);

    await expect(uploadResumable(testFile(), OPTIONS)).rejects.toThrow(
      'integrity check failed: sha256 mismatch',
    );

    expect(state.puts).toEqual([0, 1, 2]);
    expect(state.completes).toBe(1);
  });
});
