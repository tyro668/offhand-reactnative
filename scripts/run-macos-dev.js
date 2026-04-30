#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const macosBundleId = process.env.OFFHAND_MACOS_BUNDLE_ID || 'com.metis.reactnative.offhand';

function hasArg(name) {
  return args.some(arg => arg === name || arg.startsWith(`${name}=`));
}

function argValue(name) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === name) {
      return args[i + 1];
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return undefined;
}

function runChecked(command, commandArgs, options = {}) {
  const result = childProcess.spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function isMetroRunning(port, timeoutMs = 1000) {
  return new Promise(resolve => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/status',
        timeout: timeoutMs,
      },
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          body += chunk;
        });
        response.on('end', () => {
          resolve(body.trim() === 'packager-status:running');
        });
      },
    );
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

function startMetro(port) {
  const cliPath = require.resolve('react-native/cli.js', {paths: [root]});
  const logPath = path.join(os.tmpdir(), `offhand-native-metro-${port}.log`);
  const logFd = fs.openSync(logPath, 'a');
  const child = childProcess.spawn(
    process.execPath,
    [cliPath, 'start', '--port', String(port)],
    {
      cwd: root,
      detached: true,
      env: {
        ...process.env,
        RCT_METRO_PORT: String(port),
      },
      stdio: ['ignore', logFd, logFd],
    },
  );
  child.unref();
  console.log(`Started Metro on port ${port}. Log: ${logPath}`);
  return logPath;
}

function persistPackagerHost(port) {
  const host = `localhost:${port}`;
  const result = childProcess.spawnSync(
    'defaults',
    ['write', macosBundleId, 'RCT_jsLocation', host],
    {stdio: 'ignore'},
  );
  if (result.status !== 0) {
    console.warn(`Could not persist Metro host ${host} for ${macosBundleId}.`);
  }
}

async function waitForMetro(port, logPath) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await isMetroRunning(port, 1000)) {
      console.log(`Metro is ready on http://localhost:${port}`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.error(`Metro did not become ready on port ${port}.`);
  if (logPath) {
    console.error(`Check the Metro log: ${logPath}`);
  }
  process.exit(1);
}

async function main() {
  const port = Number(argValue('--port') || process.env.RCT_METRO_PORT || process.env.METRO_PORT || 8081);
  const mode = argValue('--mode') || argValue('--configuration') || 'Debug';
  const releaseMode = /^release$/i.test(mode);
  const noPackager = hasArg('--no-packager');

  runChecked('bash', [path.join('scripts', 'generate-macos-icons.sh')]);

  let logPath;
  if (!releaseMode && !noPackager) {
    persistPackagerHost(port);
    if (await isMetroRunning(port)) {
      console.log(`Metro is already running on http://localhost:${port}`);
    } else {
      logPath = startMetro(port);
      await waitForMetro(port, logPath);
    }
  }

  const cliPath = require.resolve('react-native/cli.js', {paths: [root]});
  const runArgs = [cliPath, 'run-macos'];
  if (!hasArg('--port')) {
    runArgs.push('--port', String(port));
  }
  if (!releaseMode && !noPackager) {
    runArgs.push('--no-packager');
  }
  runArgs.push(...args);

  const result = childProcess.spawnSync(process.execPath, runArgs, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      RCT_METRO_PORT: String(port),
    },
  });
  process.exit(result.status ?? 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
