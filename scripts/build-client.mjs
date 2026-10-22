import { build } from 'esbuild';
// DSH 0.2.0-rc.2's published client registration format, with shared host React.
await build({ entryPoints: ['src/native-client.ts'], outfile: 'dist/src/client.js', bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', external: ['react'],
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-evolve",factory:(require)=>{const module={exports:{}};const exports=module.exports;' },
  footer: { js: 'return module.exports;}});' } });
