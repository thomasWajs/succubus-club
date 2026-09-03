import Ably from 'ably'

export async function POST(request) {
    const ABLY_API_KEY = process.env.ABLY_API_KEY

    try {
        const ably = new Ably.Rest({ key: ABLY_API_KEY })
        const tokenRequest = await ably.auth.createTokenRequest({
            clientId: request.headers.get('clientId'),
        })
        return Response.json(tokenRequest)
    } catch (e) {
        console.error('error getting auth token from ably', e)
        return Response.json({ error: 'error getting auth token from ably' }, { status: 500 })
    }
}
