import 'instrument'
import logger from './logger.ts'
import { initServer } from './initServer.ts'
import { startWsServer, stopWsServer } from './wsServer.ts'
import { closeDb } from './persistence.ts'

await initServer()

startWsServer()

/**
 * Graceful shutdown
 */

async function gracefulShutdown() {
    logger.info('Shutting down server...')
    await stopWsServer()
    closeDb()
    process.exit(0)
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)
