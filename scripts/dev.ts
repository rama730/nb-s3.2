import { spawn, type ChildProcess } from 'node:child_process'
import { config as loadDotenv } from 'dotenv'

const REQUIRED_HEAP_OPTION = "--max-old-space-size=4096";

function tokenizeNodeOptions(value: string) {
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}

function normalizedFlag(token: string) {
  return token.replace(/^['"]|['"]$/g, "").replaceAll("_", "-");
}

function buildDevNodeOptions(value: string | undefined) {
  const tokens = tokenizeNodeOptions(value ?? "");
  const retained: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const flag = normalizedFlag(token);

    if (flag === "--optimize-for-size" || flag.startsWith("--optimize-for-size=")) {
      continue;
    }

    if (flag === "--max-old-space-size") {
      if (tokens[index + 1] && !tokens[index + 1]!.startsWith("-")) index += 1;
      continue;
    }

    if (flag.startsWith("--max-old-space-size=")) {
      continue;
    }

    retained.push(token);
  }

  retained.push(REQUIRED_HEAP_OPTION);
  return retained.join(" ");
}

loadDotenv({ path: '.env.local' })
loadDotenv()

process.env.NODE_OPTIONS = buildDevNodeOptions(process.env.NODE_OPTIONS)

type ProcSpec = {
    name: string
    command: string
    args: string[]
}

const processes: ChildProcess[] = []
let shuttingDown = false

function startProcess(spec: ProcSpec) {
    console.info(`[dev] starting ${spec.name}`)
    const child = spawn(spec.command, spec.args, {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: process.env,
    })

    child.on('exit', (code, signal) => {
        if (shuttingDown) {
            return
        }

        shuttingDown = true
        for (const processRef of processes) {
            if (processRef.pid && processRef.pid !== child.pid) {
                processRef.kill('SIGTERM')
            }
        }

        if (signal) {
            process.kill(process.pid, signal)
            return
        }

        process.exit(code ?? 0)
    })

    processes.push(child)
}

function shutdown(signal: NodeJS.Signals) {
    if (shuttingDown) {
        return
    }

    shuttingDown = true
    for (const child of processes) {
        if (child.pid) {
            child.kill(signal)
        }
    }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

startProcess({
    name: 'yjs',
    command: 'npm',
    args: ['run', 'yjs:dev'],
})

startProcess({
    name: 'next',
    command: 'next',
    args: ['dev', '--turbo'],
})
