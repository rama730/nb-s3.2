import { spawn, type ChildProcess } from 'node:child_process'

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
    name: 'presence',
    command: 'npm',
    args: ['run', 'presence:dev'],
})

startProcess({
    name: 'next',
    command: 'next',
    args: ['dev', '--webpack'],
})
