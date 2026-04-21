import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import waitOn from 'wait-on';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');
const repoRoot = join(frontendRoot, '..');
const realtimeRoot = join(repoRoot, 'realtime');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function quoteArg(arg) {
  if (!/[\s"]/u.test(arg)) return arg;
  return `"${String(arg).replace(/"/g, '\\"')}"`;
}

function buildCommand(command, args) {
  return [command, ...args.map(quoteArg)].join(' ');
}

async function isResourceAvailable(resource) {
  try {
    await waitOn({
      resources: [resource],
      timeout: 1500,
      interval: 250,
      window: 500,
      validateStatus: (status) => status >= 200 && status < 500,
    });
    return true;
  } catch {
    return false;
  }
}

function startProcess(command, args, cwd, name, extraEnv = {}) {
  const child = process.platform === 'win32'
    ? spawn(buildCommand(command, args), [], {
        cwd,
        stdio: 'inherit',
        shell: true,
        env: {
          ...process.env,
          ...extraEnv,
        },
      })
    : spawn(command, args, {
        cwd,
        stdio: 'inherit',
        env: {
          ...process.env,
          ...extraEnv,
        },
      });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[builder-direct-playtest:ci] ${name} exited via signal ${signal}`);
      return;
    }
    if (code !== 0 && code !== null) {
      console.log(`[builder-direct-playtest:ci] ${name} exited with code ${code}`);
    }
  });

  return child;
}

function stopProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.killed) {
      resolve();
      return;
    }

    const done = () => resolve();
    child.once('exit', done);
    if (process.platform === 'win32') {
      const killer = spawn('taskkill /pid ' + String(child.pid) + ' /t /f', [], {
        stdio: 'ignore',
        shell: true,
      });
      killer.once('exit', done);
      killer.once('error', done);
      return;
    }

    child.kill('SIGTERM');

    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL');
      }
    }, 5000).unref();
  });
}

async function main() {
  const realtimeWasReady = await isResourceAvailable('tcp:127.0.0.1:2567');
  const frontendWasReady = await isResourceAvailable('http://127.0.0.1:5173/builder.html');
  const realtime = realtimeWasReady ? null : startProcess(npmCommand, ['start'], realtimeRoot, 'realtime');
  const frontend = frontendWasReady
    ? null
    : startProcess(
        npmCommand,
        ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
        frontendRoot,
        'frontend',
      );

  try {
    await waitOn({
      resources: ['tcp:127.0.0.1:2567', 'http://127.0.0.1:5173/builder.html'],
      timeout: 120000,
      interval: 500,
      window: 1000,
      validateStatus: (status) => status >= 200 && status < 500,
    });

    const smokeExitCode = await new Promise((resolve, reject) => {
      const smoke = process.platform === 'win32'
        ? spawn(buildCommand(npmCommand, ['run', 'test:e2e:builder-direct-playtest']), [], {
            cwd: frontendRoot,
            stdio: 'inherit',
            shell: true,
            env: {
              ...process.env,
              BASE_URL: process.env.BASE_URL || 'http://127.0.0.1:5173',
            },
          })
        : spawn(npmCommand, ['run', 'test:e2e:builder-direct-playtest'], {
            cwd: frontendRoot,
            stdio: 'inherit',
            env: {
              ...process.env,
              BASE_URL: process.env.BASE_URL || 'http://127.0.0.1:5173',
            },
          });

      smoke.on('error', reject);
      smoke.on('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`builder direct playtest smoke terminated via ${signal}`));
          return;
        }
        resolve(code ?? 1);
      });
    });

    process.exitCode = smokeExitCode;
  } finally {
    await Promise.allSettled([
      stopProcess(frontend),
      stopProcess(realtime),
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
