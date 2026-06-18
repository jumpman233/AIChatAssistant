export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONVERSATION_DELETED'
  | 'CONVERSATION_STREAMING'
  | 'MESSAGE_NOT_RETRYABLE'
  | 'MESSAGE_NOT_ABORTABLE'
  | 'INTERNAL_ERROR'

export type ApiErrorResponse = {
  message: string
  code?: ApiErrorCode
  details?: unknown
}

type ApiErrorInput = {
  statusCode: number
  message: string
  code?: ApiErrorCode
  details?: unknown
}

export class AppApiError extends Error {
  code?: ApiErrorCode
  details?: unknown
  statusCode: number

  constructor(input: ApiErrorInput) {
    super(input.message)
    this.name = 'AppApiError'
    this.statusCode = input.statusCode
    this.code = input.code
    this.details = input.details
  }
}

export const isAppApiError = (error: unknown): error is AppApiError => {
  return error instanceof AppApiError
}

export const toApiErrorResponse = (error: AppApiError): ApiErrorResponse => ({
  code: error.code,
  details: error.details,
  message: error.message,
})

export const createApiError = (input: ApiErrorInput) => {
  return new AppApiError(input)
}

export const badRequest = (message: string, details?: unknown) =>
  createApiError({
    code: 'BAD_REQUEST',
    details,
    message,
    statusCode: 400,
  })

export const notFound = (message: string) =>
  createApiError({
    code: 'NOT_FOUND',
    message,
    statusCode: 404,
  })

export const conflict = (message: string, code: ApiErrorCode, details?: unknown) =>
  createApiError({
    code,
    details,
    message,
    statusCode: 409,
  })
