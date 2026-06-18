export type ApiClientOptions = {
  baseUrl: string
}

type RequestOptions = {
  body?: unknown
  method?: string
}

export class ApiClient {
  private baseUrl: string

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
  }

  get<T>(path: string) {
    return this.request<T>(path)
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      body,
      method: 'POST',
    })
  }

  delete<T>(path: string) {
    return this.request<T>(path, {
      method: 'DELETE',
    })
  }

  async request<T>(path: string, options: RequestOptions = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      method: options.method ?? 'GET',
    })

    const text = await response.text()
    const data = text.length > 0 ? JSON.parse(text) : null

    if (!response.ok) {
      throw new Error(
        `API request failed: ${options.method ?? 'GET'} ${path} ${response.status} ${text}`,
      )
    }

    return data as T
  }
}
