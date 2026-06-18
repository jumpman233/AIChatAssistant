import { defineEventHandler, setResponseStatus, type H3Event } from 'h3'
import { isAppApiError, toApiErrorResponse } from './apiError'

type ApiHandler<T> = (event: H3Event) => Promise<T> | T

export const defineApiHandler = <T>(handler: ApiHandler<T>) => {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    } catch (error) {
      if (isAppApiError(error)) {
        setResponseStatus(event, error.statusCode)
        return toApiErrorResponse(error)
      }

      throw error
    }
  })
}
