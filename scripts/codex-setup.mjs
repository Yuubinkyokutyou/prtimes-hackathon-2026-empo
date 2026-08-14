import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('.env')) {
  if (!existsSync('.env.example')) {
    console.error('.env も .env.example も見つかりません。');
    process.exit(1);
  }

  copyFileSync('.env.example', '.env');
  console.log('.env がコピーされていないため、.env.example から作成しました。');
} else {
  console.log('既存の .env を使用します。');
}

const npmExecutable = process.env.npm_execpath
  ? { command: process.execPath, args: [process.env.npm_execpath, 'ci'] }
  : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['ci'] };

const install = spawnSync(npmExecutable.command, npmExecutable.args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
  shell: process.platform === 'win32' && !process.env.npm_execpath,
});

if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status ?? 1);

console.log('\nCodex worktree のセットアップが完了しました。');
console.log('Run アクション（npm run dev:worktree）で専用ポートの開発環境を起動できます。');
