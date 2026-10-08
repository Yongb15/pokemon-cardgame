import { Controller, Get, Res } from '@nestjs/common'
import type { Response } from 'express'

@Controller('health')
export class HealthController {
  /** Up, and whether this request came through the proxy (a boolean only, never the value) */
  @Get()
  check(@Res({ passthrough: true }) res: Response) {
    return { ok: true, proxyVerified: res.locals.proxyVerified === true }
  }
}
