import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isRelease = process.argv.includes('--release');
const isDev = isWatch && !isRelease;

// Release 模式下移除调试日志，只保留 error 和 warn
const releaseDefines = isRelease ? {
  'console.log': '(()=>{})',
  'console.debug': '(()=>{})',
  'console.info': '(()=>{})',
  'debugLog': '(()=>{})',
} : {};

const commonOptions = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome115'],
  sourcemap: isDev ? 'inline' : false,
  minify: isRelease,
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
    ...releaseDefines
  },
  logLevel: 'info'
};

// React 相关配置
const reactOptions = {
  ...commonOptions,
  loader: {
    '.js': 'jsx',
    '.jsx': 'jsx'
  },
  jsx: 'automatic',  // 使用 React 17+ 的自动 JSX 运行时
};

const builds = [
  // Content Script (不需要 React)
  {
    ...commonOptions,
    entryPoints: ['src/content/index.js'],
    outfile: 'dist/content.js'
  },
  // Background Script (不需要 React)
  {
    ...commonOptions,
    entryPoints: ['src/background/index.js'],
    outfile: 'dist/background.js'
  },
  // Side Panel (使用 React)
  {
    ...reactOptions,
    entryPoints: ['src/sidepanel/index.jsx'],
    outfile: 'dist/sidepanel.js'
  },
  // Side Panel CSS
  {
    ...commonOptions,
    entryPoints: ['src/sidepanel/styles/index.css'],
    outfile: 'dist/sidepanel.css'
  }
];

async function build() {
  try {
    if (isWatch) {
      console.log('Watching for changes...');
      const contexts = await Promise.all(
        builds.map(options => esbuild.context(options))
      );
      await Promise.all(contexts.map(ctx => ctx.watch()));
    } else {
      await Promise.all(builds.map(options => esbuild.build(options)));
      if (isRelease) {
        console.log('√ Release build completed! (debug logs removed, minified)');
      } else {
        console.log('√ Build completed!');
      }
    }
  } catch (error) {
    console.error('× Build failed:', error);
    process.exit(1);
  }
}

build();
