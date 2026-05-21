import { CURRENT_VERSION } from '../src/shared/version.mjs'

export async function GET() {
    return Response.json({ version: CURRENT_VERSION })
}
