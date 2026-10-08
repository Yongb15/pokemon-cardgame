import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common'
import type { Response } from 'express'

/**
 * Every error leaves as { error: { message, code } }: HTTP errors keep their status and a short
 * message, anything else is a plain 500 — no stack, query or connection details (Security)
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const message = status >= 500 ? '서버 오류가 발생했습니다.' : messageOf(exception)
      res.status(status).json({ error: { message, code: status } })
      return
    }
    // Request errors from Express middleware (too large, malformed JSON) carry a 4xx status
    const status = (exception as { status?: unknown } | null)?.status
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const message = status === 413 ? '요청이 너무 큽니다.' : '요청을 처리할 수 없습니다.'
      res.status(status).json({ error: { message, code: status } })
      return
    }
    // Name only in the log: the error itself can hold queries or connection strings
    console.error('unhandled error:', exception instanceof Error ? exception.name : typeof exception)
    res.status(500).json({ error: { message: '서버 오류가 발생했습니다.', code: 500 } })
  }
}

function messageOf(exception: HttpException) {
  const body = exception.getResponse()
  if (typeof body === 'string') return body
  const message = (body as { message?: unknown }).message
  return typeof message === 'string' ? message : '요청을 처리할 수 없습니다.'
}
