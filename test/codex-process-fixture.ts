// Deterministic local child process exercising JSONL framing; this is not a model.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const mode = process.argv[2];
let prompt = '';
process.stdin.setEncoding('utf8'); process.stdin.on('data', (data: string) => { prompt += data; });
process.stdin.on('end', () => {
  const emit = (event: unknown): void => { process.stdout.write(JSON.stringify(event) + '\n'); };
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  if (mode === 'exit-with-open-pipe') {
    const orphan = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    orphan.unref(); process.exit(0);
  }
  if (mode === 'invalid-jsonl') { process.stdout.write('not-json\n'); return; }
  if (mode === 'output-limit') { process.stdout.write('x'.repeat(2048)); setInterval(() => {}, 1000); return; }
  if (mode === 'line-limit') { process.stdout.write(JSON.stringify({ type: 'ignored', text: 'x'.repeat(270000) }) + '\n'); setInterval(() => {}, 1000); return; }
  emit({ type: 'thread.started', thread_id: 'fixture' });
  if (mode === 'missing-item-id') emit({ type: 'item.started', item: { type: 'command_execution' } });
  if (mode === 'unknown-item') emit({ type: 'item.started', item: { id: 'x', type: 'future_tool' } });
  if (mode === 'unknown-event') emit({ type: 'future_tool.started' });
  if (mode === 'tool-limit') {
    for (let i = 0; i < 5; i++) emit({ type: 'item.started', item: { id: String(i), type: 'command_execution', command: 'PRIVATE RAW COMMAND', status: 'in_progress' } });
    setInterval(() => {}, 1000); return;
  }
  const proposal = { summary: 'Fixture proposal', changes: [{ path: 'module.py',
    beforeDigest: createHash('sha256').update('x = 1\n').digest('hex'), content: 'x = 2\n' }], candidate: mode === 'bad-candidate'
      ? { title: 'PRIVATE TITLE', strategy: 'PRIVATE STRATEGY', observedFacts: [], inferences: [], recommendations: [], requiredFiles: ['module.py'] } : null };
  emit({ type: 'item.completed', item: { id: 'reasoning', type: 'reasoning', text: 'PRIVATE REASONING' } });
  emit({ type: 'item.completed', item: { id: 'reply', type: 'agent_message', text: mode === 'bad-final' ? '{}' : JSON.stringify(proposal) } });
  if (mode === 'turn-failed') emit({ type: 'turn.failed', error: { message: 'PRIVATE ERROR' } });
  else if (mode === 'network') emit({ type: 'error', message: 'network connection failed at PRIVATE ENDPOINT' });
  else if (mode === 'no-final-newline') process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 123, cached_input_tokens: 100, output_tokens: 45 } }));
  else if (mode !== 'missing-completion') emit({ type: 'turn.completed', usage: { input_tokens: 123, cached_input_tokens: 100, output_tokens: 45 } });
  if (mode === 'trailing-garbage') process.stdout.write('not-json');
  if (mode === 'trailing-unknown') process.stdout.write(JSON.stringify({ type: 'future_tool.started' }));
  if (!prompt.includes('rememberedExperience') || !process.argv.includes('read-only') || !process.argv.includes('--ignore-user-config')
    || !['apps', 'plugins', 'hooks', 'remote_plugin'].every((name) => process.argv.includes(name))) process.exitCode = 9;
  if (!process.argv.includes('model_providers.evolve-https.supports_websockets=false')) process.exitCode = 9;
  if (mode === 'nonzero') process.exitCode = 1;
});
