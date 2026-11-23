// Local artifact preparation only. No deployment, credentials or remote DB use.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function buildOwned({ coreInput, expectedCoreSha256, rebuildCore = false, output = resolve(directory, 'build/index.js') } = {}) {
  if (rebuildCore === Boolean(coreInput)) throw new Error('Choose an approved core input or an explicit core rebuild');
  output = resolve(output);
  const generatedCore = resolve(dirname(output), 'core.mjs');
  if (output === generatedCore) throw new Error('Runtime output cannot replace the core input');
  if (coreInput && output === resolve(coreInput)) throw new Error('Runtime output cannot replace the approved core input');
  await mkdir(dirname(generatedCore), { recursive: true });
  await mkdir(dirname(output), { recursive: true });
  if (rebuildCore) {
    await new Promise((accept, reject) => {
      const child = spawn(process.execPath, [resolve(directory, '../bundle.mjs')], { env: { ...process.env, HARBOUR_WORKER_OUTPUT: generatedCore }, stdio: 'inherit' });
      child.on('error', () => reject(new Error('Core builder could not start')));
      child.on('close', code => code === 0 ? accept() : reject(new Error('Core builder failed')));
    });
  } else {
    if (!/^[a-f0-9]{64}$/i.test(expectedCoreSha256 ?? '')) throw new Error('An approved core SHA-256 is required');
    const bytes = await readFile(resolve(coreInput));
    if (sha(bytes) !== expectedCoreSha256.toLowerCase()) throw new Error('Approved core digest mismatch');
    // Write the exact bytes whose digest was checked, rather than rereading a
    // shared input through copyFile after verification.
    if (resolve(coreInput) !== generatedCore) await writeFile(generatedCore, bytes);
  }
  const coreSha256 = sha(await readFile(generatedCore));
  if (!rebuildCore && coreSha256 !== expectedCoreSha256.toLowerCase()) throw new Error('Generated core digest mismatch');
  const result = await build({ entryPoints: [resolve(directory, 'production-entry.mjs')], outfile: output, bundle: true, format: 'esm', minify: true, platform: 'browser', external: ['cloudflare:workers'], target: 'es2022', legalComments: 'none', metafile: true,
    plugins: [{ name: 'approved-local-core', setup(builder) { builder.onResolve({ filter: /^\.\/build\/core\.mjs$/ }, input => input.importer === resolve(directory, 'production-entry.mjs') ? { path: generatedCore } : undefined); } }],
  });
  const artifact = await readFile(output);
  const receipt = { sha256: sha(artifact), bytes: artifact.length, coreSha256, coreRebuilt: rebuildCore, administrationRoutes: false, remoteOperations: 0, inputs: Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/')) };
  await writeFile(resolve(dirname(output), 'owned-build-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  for (let at = 0; at < args.length; at++) {
    if (args[at] === '--rebuild-core') options.rebuildCore = true;
    else if (['--core', '--core-sha256', '--output'].includes(args[at]) && args[at + 1]) options[{ '--core': 'coreInput', '--core-sha256': 'expectedCoreSha256', '--output': 'output' }[args[at]]] = args[++at];
    else throw new Error('Use --core FILE --core-sha256 SHA, or --rebuild-core; optional --output FILE');
  }
  console.log(JSON.stringify(await buildOwned(options), null, 2));
}
