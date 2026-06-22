import 'instrument'
import http from 'http'
import { initServer } from './initServer.ts'
import logger from './logger.ts'
import { stopWsServer, wsServer } from './wsServer.ts'
import { handleLogsRequest } from './logServer.ts'

const PORT = parseInt(process.env.WS_PORT ?? '3001')

await initServer()

const server = http.createServer((req, res) => {
    if (req.method == 'GET' && req.url === '/logs') {
        return handleLogsRequest(req, res)
    }
    // Explicitly close the connection for any other requests (like health checks)
    // so they do not linger and prevent the server from sleeping.
    res.writeHead(404, { Connection: 'close' }).end()
})

// Keep idle timeouts low to allow the server to sleep when there are no active clients.
// This prevents lingering TCP connections (e.g. from health checks or port scanners)
// from exchanging keep-alive packets that reset Railway's 10-minute inactivity timer.
server.keepAliveTimeout = 2000 // 2 seconds
server.headersTimeout = 5000 // 5 seconds
server.requestTimeout = 10000 // 10 seconds

/**
 * Delegate web sockets
 */
server.on('upgrade', (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head, ws => {
        wsServer.emit('connection', ws, req)
    })
})

server.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`)
})

export async function stopServer() {
    await new Promise<void>((resolve, reject) => {
        server.close(err => {
            if (err) reject(err)
            else {
                logger.info(`Server closed`)
                resolve()
            }
        })
    })
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown() {
    logger.info('Shutting down server...')
    await stopWsServer()
    await stopServer()
    process.exit(0)
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)
