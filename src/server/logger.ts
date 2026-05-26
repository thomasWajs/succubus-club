import pino from 'pino'

const isProd = process.env.NODE_ENV === 'production'
export const LOG_DIR = process.env.SCS_LOG_PATH ?? '../../logs'

const consoleTransport = {
    target: 'pino/file',
    level: 'info',
    options: { destination: 1 },
}

const prettyConsoleTransport = {
    target: 'pino-pretty',
    options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
    },
}

const fileTransport = {
    target: 'pino-roll',
    options: {
        file: `${LOG_DIR}/scs`,
        frequency: 'daily',
        extension: '.log',
        dateFormat: 'yyyy-MM-dd',
        mkdir: true,
        limit: { count: 90 },
    },
}

const transport = isProd ? { targets: [consoleTransport, fileTransport] } : prettyConsoleTransport

// @ts-ignore
const logger = pino(
    {
        level: process.env.LOG_LEVEL ?? 'info',
        base: undefined, // ← removes pid & hostname
        timestamp: pino.stdTimeFunctions.isoTime, // ← human-readable time
        formatters: {
            level: label => ({ level: label }), // ← "info" instead of 30
        },
    },
    // @ts-ignore
    pino.transport(transport),
)

export default logger
