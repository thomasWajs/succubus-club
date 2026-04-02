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
    res.writeHead(404).end()
})

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
