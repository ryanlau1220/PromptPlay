/** An expected request failure whose message is safe to return to the caller. */
export class RequestError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 404 | 409 | 429) {
    super(message)
  }
}

/** The provider may have executed the request, so its reservation must remain intact. */
export class UpstreamError extends Error {}
