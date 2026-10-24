import { NextRequest, NextResponse } from 'next/server'
import { getActiveProviderForUser } from '@/lib/ai-config'
import { requireAuth } from '@/lib/auth-helpers'
import { saveMediaFile } from '@/lib/file-storage'
import { db } from '@/lib/db'

// POST /api/ai/poll-status - Check the status of an async AI generation task
// Used by the client to poll for results when the API returns { status: 'processing', taskId }
// v0.7: Saves polled image data to file storage instead of returning base64
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const body = await request.json()
    const { category, taskId, dramaId, storyboardId } = body

    if (!category || !taskId) {
      return NextResponse.json({ error: 'Missing category or taskId' }, { status: 400 })
    }

    // Resolve the same provider generation used (user-level key first, then platform default)
    const provider = await getActiveProviderForUser(category, auth.userId)
    if (!provider) {
      // 200 with a terminal status so the client fails fast instead of
      // treating the request error as a transient poll failure
      return NextResponse.json({ status: 'failed', error: `未配置可用的${category === 'image' ? '图片' : '视频'}生成供应商` })
    }

    if (category === 'image') {
      const { getImageAdapter } = await import('@/lib/adapters/image')
      const adapter = getImageAdapter(provider.provider, provider.model)
      const config = { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model }
      const pollReq = adapter.buildPollRequest(config, taskId)
      if (!pollReq) {
        return NextResponse.json({ status: 'unsupported', error: `供应商 ${provider.provider} 不支持图片任务轮询` })
      }
      const pollRes = await fetch(pollReq.url, { method: pollReq.method, headers: pollReq.headers })
      const pollData = await pollRes.json()
      const pollParsed = adapter.parsePollResponse(pollData)

      if (pollParsed.status === 'completed') {
        if (pollParsed.imageUrl) {
          // Download image from provider URL and save to file storage
          const imgRes = await fetch(pollParsed.imageUrl)
          const buffer = Buffer.from(await imgRes.arrayBuffer())
          const saveResult = await saveMediaFile(buffer, {
            mimeType: 'image/png',
            category: 'storyboards',
            dramaId,
            filename: `async_img_${Date.now()}`,
          })
          return NextResponse.json({ status: 'completed', imageUrl: saveResult.url })
        }
        if (pollParsed.imageBase64) {
          // Save base64 to file storage
          const saveResult = await saveMediaFile(pollParsed.imageBase64, {
            mimeType: 'image/png',
            category: 'storyboards',
            dramaId,
            filename: `async_img_${Date.now()}`,
          })
          return NextResponse.json({ status: 'completed', imageUrl: saveResult.url })
        }
        return NextResponse.json({ status: 'completed', error: 'No image data' })
      }
      return NextResponse.json({ status: pollParsed.status, error: pollParsed.error })
    }

    if (category === 'video') {
      const { getVideoAdapter } = await import('@/lib/adapters/video')
      const adapter = getVideoAdapter(provider.provider, provider.model)
      const config = { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model }
      const pollReq = adapter.buildPollRequest(config, taskId)
      if (!pollReq) {
        return NextResponse.json({ status: 'unsupported', error: `供应商 ${provider.provider} 不支持视频任务轮询` })
      }
      const pollRes = await fetch(pollReq.url, { method: pollReq.method, headers: pollReq.headers })
      const pollData = await pollRes.json()
      const pollParsed = adapter.parsePollResponse(pollData)

      if (pollParsed.status === 'completed') {
        // Persist the finished video so the storyboard leaves "processing"
        if (storyboardId && pollParsed.videoUrl) {
          await db.storyboard.update({
            where: { id: storyboardId },
            data: { videoUrl: pollParsed.videoUrl, status: 'completed' },
          }).catch(() => { /* non-critical */ })
        }
        return NextResponse.json({ status: 'completed', videoUrl: pollParsed.videoUrl })
      }
      if (pollParsed.status === 'failed' && storyboardId) {
        await db.storyboard.update({
          where: { id: storyboardId },
          data: { status: 'failed' },
        }).catch(() => { /* non-critical */ })
      }
      return NextResponse.json({ status: pollParsed.status, error: pollParsed.error })
    }

    return NextResponse.json({ error: 'Unsupported category' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
