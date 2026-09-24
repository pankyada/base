import { getObservatoryCollections } from '../../../lib/observatory-files'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin) {
    try { if (new URL(origin).origin !== new URL(request.url).origin) return false } catch { return false }
  }
  return request.headers.get('sec-fetch-site') !== 'cross-site'
}

export async function GET(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } })
  const body = await getObservatoryCollections()
  return Response.json(body, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
}
