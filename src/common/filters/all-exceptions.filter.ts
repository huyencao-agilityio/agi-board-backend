import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Every error leaves the API as { error: { code, message, details? } }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const [status, body] = this.toResponse(exception);
    if (status >= 500) this.logger.error(exception);
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }

  private toResponse(exception: unknown): [number, ErrorBody] {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const obj = typeof res === 'object' ? (res as Record<string, unknown>) : { message: res };
      // ValidationPipe puts the list of failures in `message`.
      if (Array.isArray(obj.message)) {
        return [status, { error: { code: 'VALIDATION_FAILED', message: 'Validation failed', details: obj.message } }];
      }
      const code = typeof obj.code === 'string' ? obj.code : (HttpStatus[status] ?? 'ERROR');
      return [
        status,
        {
          error: {
            code,
            message: typeof obj.message === 'string' ? obj.message : exception.message,
            details: obj.details,
          },
        },
      ];
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') return [409, { error: { code: 'CONFLICT', message: 'Resource already exists' } }];
      if (exception.code === 'P2025') return [404, { error: { code: 'NOT_FOUND', message: 'Resource not found' } }];
    }
    // Body-parser errors (e.g. a JSON body over the size limit) are not HttpExceptions but carry a safe 4xx status.
    const parserError = exception as { expose?: unknown; status?: unknown } | null;
    const status = parserError?.status;
    if (parserError?.expose === true && typeof status === 'number' && status >= 400 && status < 500) {
      return [status, { error: { code: HttpStatus[status] ?? 'BAD_REQUEST', message: 'Invalid request body' } }];
    }
    return [500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } }];
  }
}
