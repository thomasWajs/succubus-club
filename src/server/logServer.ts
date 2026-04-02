import http from 'http'
import fs from 'fs'
import archiver from 'archiver'
import { LOG_DIR } from './logger.ts'

const LOGS_PASSWORD = process.env.SCS_LOGS_PASSWORD

if (!LOGS_PASSWORD) {
    console.error('SCS_LOGS_PASSWORD is not set, refusing to start')
    process.exit(1)
}

export function handleLogsRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const auth = req.headers['authorization']
    const expected = `Basic ${Buffer.from(`:${LOGS_PASSWORD}`).toString('base64')}`

    if (!auth || auth !== expected) {
        res.writeHead(401, {
            'WWW-Authenticate': 'Basic realm="Logs"',
        }).end('Unauthorized')
        return
    }

    if (!fs.existsSync(LOG_DIR)) {
        res.writeHead(404).end('Log directory not found')
        return
    }

    const filename = `logs-${new Date().toISOString().slice(0, 10)}.zip`
    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
    })

    const archive = archiver('zip', { zlib: { level: 9 } })

    archive.on('error', err => {
        res.destroy(err)
    })

    archive.pipe(res)
    archive.directory(LOG_DIR, false)
    archive.finalize()
}
