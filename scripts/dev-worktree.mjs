import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDirectory = process.cwd();
const statePath = join(rootDirectory, '.worktree-dev.json');
const parentDirectoryName = basename(dirname(rootDirectory));
const fallbackId = createHash('sha256').update(rootDirectory).digest('hex').slice(0, 8);
const worktreeId = /^[0-9a-f]{4,16}$/i.test(parentDirectoryName) ? parentDirectoryName.toLowerCase() : fallbackId;
const projectName = `team-empo-${worktreeId}`;
const command = process.argv[2] ?? 'up';

function readState() {
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return state.projectName === projectName ? state : null;
  } catch {
    return null;
  }
}

function writeState(ports) {
  const state = { projectName, ...ports };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function composeEnvironment(state) {
  return {
    ...process.env,
    COMPOSE_PROJECT_NAME: projectName,
    POSTGRES_PORT: String(state.postgresPort),
    API_PORT: String(state.apiPort),
    FRONTEND_PORT: String(state.frontendPort),
  };
}

function runCompose(args, state, { capture = false, exitOnError = true } = {}) {
  const result = spawnSync('docker', ['compose', '-p', projectName, ...args], {
    cwd: rootDirectory,
    env: state ? composeEnvironment(state) : process.env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !capture && exitOnError) process.exit(result.status ?? 1);
  return result;
}

function runningServices() {
  const result = runCompose(['ps', '--services', '--status', 'running'], null, { capture: true });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/).filter(Boolean) : [];
}

function publishedPort(service, containerPort) {
  const result = runCompose(['port', service, String(containerPort)], null, { capture: true });
  if (result.status !== 0) return null;
  const match = result.stdout.trim().match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function inspectRunningPorts() {
  const postgresPort = publishedPort('db', 5432);
  const apiPort = publishedPort('backend', 3000);
  const frontendPort = publishedPort('frontend', 5173);
  return postgresPort && apiPort && frontendPort ? { postgresPort, apiPort, frontendPort } : null;
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port }, () => server.close(() => resolve(true)));
  });
}

async function findFreePort(start, reserved) {
  for (let port = start; port < start + 500; port += 1) {
    if (!reserved.has(port) && await isPortAvailable(port)) {
      reserved.add(port);
      return port;
    }
  }
  throw new Error(`${start} から利用可能なポートを見つけられませんでした。`);
}

async function allocatePorts(previousState) {
  const reserved = new Set();
  const choose = async (previous, start) => {
    if (Number.isInteger(previous) && !reserved.has(previous) && await isPortAvailable(previous)) {
      reserved.add(previous);
      return previous;
    }
    return findFreePort(start, reserved);
  };
  return {
    postgresPort: await choose(previousState?.postgresPort, 15432),
    apiPort: await choose(previousState?.apiPort, 13000),
    frontendPort: await choose(previousState?.frontendPort, 15173),
  };
}

function printSummary(state, prefix) {
  console.log(`\n${prefix}`);
  console.log(`  Project:  ${projectName}`);
  console.log(`  Frontend: http://localhost:${state.frontendPort}`);
  console.log(`  API:      http://localhost:${state.apiPort}/api/health`);
  console.log(`  Postgres: localhost:${state.postgresPort}`);
}

async function main() {
  const storedState = readState();

  if (command === 'up') {
    if (runningServices().includes('frontend')) {
      const inspectedState = storedState ? null : inspectRunningPorts();
      const state = storedState ?? (inspectedState ? writeState(inspectedState) : null);
      if (!state) throw new Error('起動中コンテナの公開ポートを取得できませんでした。');
      printSummary(state, 'このworktreeの開発環境は起動済みです。');
      return;
    }

    let previousState = storedState;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const state = writeState(await allocatePorts(previousState));
      printSummary(state, 'このworktree専用の空きポートを割り当てました。');

      const result = runCompose(['up', '--build', '-d'], state, { exitOnError: false });
      if (result.status === 0) {
        printSummary(state, '開発環境を起動しました。');
        return;
      }

      runCompose(['down', '--remove-orphans'], state, { exitOnError: false });
      previousState = null;
      console.warn(`起動に失敗したため、別のポートで再試行します (${attempt}/3)。`);
    }

    console.error('空きポートで開発環境を起動できませんでした。');
    process.exit(1);
  }

  const state = storedState ?? inspectRunningPorts();
  if (command === 'down') {
    runCompose(['down'], state);
    console.log(`停止しました: ${projectName}`);
    return;
  }
  if (command === 'status') {
    runCompose(['ps'], state);
    if (state) printSummary(state, '割り当て済みURL');
    return;
  }
  if (command === 'logs') {
    runCompose(['logs', '--follow', '--tail', '100'], state);
    return;
  }

  console.error('使い方: node scripts/dev-worktree.mjs <up|down|status|logs>');
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
