/**
 * Release 打包脚本
 * 用法: npm run release
 *
 * 1. 构建 release 版本 (移除调试日志, 压缩代码)
 * 2. 收集必要文件到 release/ 目录
 * 3. 打包成 zip 文件
 */

import { execSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, readFileSync, copyFileSync, statSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// 读取版本号
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version;

// 需要打包的文件/目录
const FILES_TO_INCLUDE = [
  'manifest.json',
  'dist',
  'src/popup/index.html',
  'src/sidepanel/index.html',
  'src/setup/index.html',
  'src/backup-manager/index.html',
  'src/export-renderer/index.html',
  'assets',
  '_locales',
];

// 排除的文件（不打包进扩展）
const EXCLUDE_FILES = [
  'icon1024.png',  // 未使用的大图标
];

// 截图文件（用于 Chrome Web Store，不打包进扩展）
const SCREENSHOTS_DIR = join(ROOT, 'docs', 'pic');
const SCREENSHOTS = [
  'float_main.png',
  'main_feature.png',
];

// 输出目录
const RELEASE_DIR = join(ROOT, 'release');
const SCREENSHOTS_OUT_DIR = join(ROOT, 'release-screenshots');
const ZIP_NAME = `chatgpt-graph-extension-v${VERSION}.zip`;

async function main() {
  console.log(`\n📦 Building release v${VERSION}...\n`);

  // 1. 构建 release 版本
  console.log('1. Building release version...');
  try {
    execSync('npm run build:release', { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('× Build failed');
    process.exit(1);
  }

  // 2. 清理并创建 release 目录
  console.log('\n2. Preparing release directory...');
  if (existsSync(RELEASE_DIR)) {
    rmSync(RELEASE_DIR, { recursive: true });
  }
  mkdirSync(RELEASE_DIR, { recursive: true });

  // 3. 复制文件
  console.log('3. Copying files...');
  for (const file of FILES_TO_INCLUDE) {
    const src = join(ROOT, file);
    const dest = join(RELEASE_DIR, file);

    if (!existsSync(src)) {
      console.warn(`   ⚠ Skipping (not found): ${file}`);
      continue;
    }

    // 创建目标目录
    mkdirSync(dirname(dest), { recursive: true });

    // 复制
    copyRecursive(src, dest);
    console.log(`   ✓ ${file}`);
  }

  // 4. 复制截图文件（用于 Web Store 上传）
  console.log('4. Copying screenshots for Web Store...');
  if (existsSync(SCREENSHOTS_OUT_DIR)) {
    rmSync(SCREENSHOTS_OUT_DIR, { recursive: true });
  }
  mkdirSync(SCREENSHOTS_OUT_DIR, { recursive: true });
  for (const screenshot of SCREENSHOTS) {
    const src = join(SCREENSHOTS_DIR, screenshot);
    const dest = join(SCREENSHOTS_OUT_DIR, screenshot);
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`   ✓ ${screenshot}`);
    } else {
      console.warn(`   ⚠ Skipping (not found): ${screenshot}`);
    }
  }

  // 5. 打包成 zip
  console.log('\n5. Creating zip archive...');
  const zipPath = join(ROOT, ZIP_NAME);
  await createZip(RELEASE_DIR, zipPath);

  console.log(`\n✅ Release complete!`);
  console.log(`   📁 Extension: release/`);
  console.log(`   📦 Archive: ${ZIP_NAME}`);
  console.log(`   🖼️  Screenshots: release-screenshots/`);
  console.log(`\n   Upload ${ZIP_NAME} to Chrome Web Store.\n`);
}

// 递归复制文件/目录（排除指定文件）
function copyRecursive(src, dest) {
  const stat = statSync(src);

  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const child of readdirSync(src)) {
      // 跳过排除的文件
      if (EXCLUDE_FILES.includes(child)) {
        console.log(`   ⊘ Excluded: ${child}`);
        continue;
      }
      copyRecursive(join(src, child), join(dest, child));
    }
  } else {
    copyFileSync(src, dest);
  }
}

// 创建 zip 文件
function createZip(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const size = (archive.pointer() / 1024).toFixed(1);
      console.log(`   ✓ ${basename(outPath)} (${size} KB)`);
      resolve();
    });

    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

main().catch(console.error);
