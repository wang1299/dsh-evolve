import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import { EXTRACTION_OUTPUT_BYTES, EXTRACTION_SYSTEM } from './extraction.js';
import { extractionUsageSchema, InvalidExtractionResponse, type ExtractionPort, type ExtractionUsage } from './extraction-domain.js';

/** Official DSH prepared, registration-bound, one-shot call. No provider/key or Agent loop. */
export function dshExtractionPort(llm: LlmRuntime): ExtractionPort {
  return async ({ policy, material, signal }) => {
    signal.throwIfAborted();
    const call = await llm.prepareCall({ provider: policy.provider, model: policy.model, maxTokens: policy.maxTokens }, signal);
    if (call.config.provider !== policy.provider || call.config.model !== policy.model
      || call.config.maxTokens === undefined || call.config.maxTokens > policy.maxTokens) throw new Error('Extraction route controls changed');
    let text = ''; let totalBytes = 0; let chunks = 0; let finished = false; let usage: ExtractionUsage | null = null;
    const blocks = new Map<number, { kind: 'text' | 'reasoning'; text: string; bytes: number }>();
    const seen = new Set<number>();
    for await (const chunk of call.stream({ ...call.config, system: EXTRACTION_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: material }] }], signal })) {
      signal.throwIfAborted();
      if (++chunks > 20000 || finished) throw new InvalidExtractionResponse();
      switch (chunk.type) {
        case 'block-start':
          if ((chunk.blockType !== 'text' && chunk.blockType !== 'reasoning') || seen.has(chunk.index) || seen.size >= 8) throw new InvalidExtractionResponse();
          seen.add(chunk.index); blocks.set(chunk.index, { kind: chunk.blockType, text: '', bytes: 0 }); break;
        case 'text-delta': case 'reasoning-delta': {
          const block = blocks.get(chunk.index);
          if (!block || block.kind !== (chunk.type === 'text-delta' ? 'text' : 'reasoning')) throw new InvalidExtractionResponse();
          const bytes = Buffer.byteLength(chunk.text, 'utf8'); totalBytes += bytes; block.bytes += bytes;
          if (totalBytes > EXTRACTION_OUTPUT_BYTES) throw new InvalidExtractionResponse();
          if (block.kind === 'text') block.text += chunk.text;
          break;
        }
        case 'block-end': {
          const block = blocks.get(chunk.index);
          if (!block || block.kind !== chunk.block.type || (chunk.block.type !== 'text' && chunk.block.type !== 'reasoning')) throw new InvalidExtractionResponse();
          // End blocks may be the sole text representation; deltas and end payload must agree.
          const bytes = Buffer.byteLength(chunk.block.text, 'utf8');
          totalBytes += Math.max(0, bytes - block.bytes);
          if (totalBytes > EXTRACTION_OUTPUT_BYTES) throw new InvalidExtractionResponse();
          if (bytes > EXTRACTION_OUTPUT_BYTES || (block.kind === 'text' && block.text && block.text !== chunk.block.text)) throw new InvalidExtractionResponse();
          if (block.kind === 'text') text += chunk.block.text;
          if (Buffer.byteLength(text, 'utf8') > EXTRACTION_OUTPUT_BYTES) throw new InvalidExtractionResponse();
          blocks.delete(chunk.index); break;
        }
        case 'usage':
          if (usage !== null) throw new InvalidExtractionResponse();
          usage = extractionUsageSchema.parse(chunk.usage); break;
        case 'finish':
          if (chunk.reason.kind !== 'stop') throw new Error('Extraction model did not complete');
          if (blocks.size) throw new InvalidExtractionResponse();
          finished = true; break;
        default: throw new InvalidExtractionResponse();
      }
    }
    if (!finished || !text) throw new Error('Incomplete extraction response');
    return { text, usage };
  };
}
