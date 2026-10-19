/** Fixed local protocol answers for harness integration only. Never used in live mode. */
let prompt = '';
process.stdin.setEncoding('utf8'); process.stdin.on('data', (part: string) => { prompt += part; });
process.stdin.on('end', () => {
  const data = JSON.parse(prompt.slice(prompt.indexOf('{"task":')));
  const file = data.source[0];
  const variable = file.path === 'stage.py' ? 'entry' : file.path === 'cart.py' ? 'cart' : 'options';
  const signature = file.content.split('\n')[0];
  const mutation = file.path === 'cart.py' ? "    cart['price'] = price\n    cart['discount'] = 0\n" : `    ${variable}.update(changes)\n`;
  const content = signature + `\n    before = dict(${variable})\n` + mutation
    + `    if reject:\n        ${variable}.clear()\n        ${variable}.update(before)\n        raise ValueError('fixture rejection')\n    return ${variable}\n`;
  for (const event of [{ type: 'thread.started', thread_id: 'process-fixture' },
    { type: 'item.completed', item: { id: 'fixture-final', type: 'agent_message', text: JSON.stringify({ summary: 'Process fixture, not a model', changes: [{ path: file.path, beforeDigest: file.beforeDigest, content }], candidate: null }) } },
    { type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 } }]) process.stdout.write(JSON.stringify(event) + '\n');
});
