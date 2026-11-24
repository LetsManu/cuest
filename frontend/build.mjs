import { build } from 'esbuild';

const outdir = '../custom_components/cuest/frontend';
await build({
  entryPoints: {
    'cuest-card': 'src/cuest-card.ts',
    'cuest-panel': 'src/cuest-panel.ts',
    'cuest-arcane': 'src/arcane/index.ts',
  },
  outdir,
  format: 'esm',
  bundle: true,
  minify: true,
  target: 'es2020',
  legalComments: 'none',
  tsconfig: 'tsconfig.json',
});
