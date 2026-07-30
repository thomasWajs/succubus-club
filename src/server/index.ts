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
    // Silently destroy the socket for any other request (health checks, port scanners, etc.)
    // so no response bytes are sent and the connection does not linger.
    logger.info(`Destroying socket following a request on ${req.url}`)
    req.socket.destroy()
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
    if (req.url !== '/realtime') {
        socket.destroy()
        logger.info(`Destroying socket following a request on ${req.url}`)
        return
    }
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
