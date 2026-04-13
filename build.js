import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isRelease = process.argv.includes('--release');
const isDev = isWatch && !isRelease;

// 插件：Release 模式下移除调试日志，保留 error 和 warn
const stripDebugLogsPlugin = {
  name: 'strip-debug-logs',
  setup(build) {
    if (!isRelease) return;

    build.onLoad({ filter: /\.jsx?$/ }, async (args) => {
      const fs = await import('fs');
      let contents = await fs.promises.readFile(args.path, 'utf8');

      // 移除 console.log, console.debug, console.info（保留 error, warn）
      // 匹配 console.log(...) 包括多行和嵌套括号
      contents = contents.replace(/console\.(log|debug|info)\s*\([^;]*\);?/g, '');

      return {
        contents,
        loader: args.path.endsWith('.jsx') ? 'jsx' : 'js'
      };
    });
  }
};

const commonOptions = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome115'],
  sourcemap: isDev ? 'inline' : false,
  minify: isRelease,
  plugins: [stripDebugLogsPlugin],
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
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
  // Popup (不需要 React)
  {
    ...commonOptions,
    entryPoints: ['src/popup/popup.js'],
    outfile: 'dist/popup.js'
  },
  // Setup Page (不需要 React)
  {
    ...commonOptions,
    entryPoints: ['src/setup/setup.js'],
    outfile: 'dist/setup.js'
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
  },
  // Main World Script (fetch 拦截，运行在 MAIN world)
  {
    ...commonOptions,
    entryPoints: ['src/content/main-world.js'],
    outfile: 'dist/main-world.js'
  },
  // Backup Manager (不需要 React)
  {
    ...commonOptions,
    entryPoints: ['src/backup-manager/backup-manager.js'],
    outfile: 'dist/backup-manager.js'
  },
  {
    ...commonOptions,
    entryPoints: ['src/export-renderer/index.js'],
    outfile: 'dist/export-renderer.js'
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
