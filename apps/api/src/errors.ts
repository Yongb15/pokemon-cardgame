import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common'
import type { Response } from 'express'

/** An error whose message was written for users: the only kind whose message leaves as is */
export class PublicError extends HttpException {
  constructor(message: string, status: number) {
    super(message, status)
  }
}

/** Fixed texts per status: framework and parser messages can echo the path or the body (qa Q2-1, Security I-2) */
const MESSAGES: Record<number, string> = {
  400: '요청을 처리할 수 없습니다.',
  401: '로그인이 필요합니다.',
  403: '권한이 없습니다.',
  404: '찾을 수 없습니다.',
  405: '허용되지 않는 요청입니다.',
  413: '요청이 너무 큽니다.',
  429: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
}

/**
 * Every error leaves as { error: { message, code } }: 4xx keep their status with a fixed message,
 * anything else is a plain 500 — no stack, query, path, body or connection details (Security)
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()
    // Nest's own HTTP errors, and Express middleware errors (too large, malformed JSON) with a status
    const status =
      exception instanceof HttpException ? exception.getStatus() : (exception as { status?: unknown } | null)?.status
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const message =
        exception instanceof PublicError ? exception.message : (MESSAGES[status] ?? '요청을 처리할 수 없습니다.')
      res.status(status).json({ error: { message, code: status } })
      return
    }
    // Name only in the log: the error itself can hold queries or connection strings
    console.error('unhandled error:', exception instanceof Error ? exception.name : typeof exception)
    res.status(500).json({ error: { message: '서버 오류가 발생했습니다.', code: 500 } })
  }
}
