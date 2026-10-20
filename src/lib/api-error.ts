// Only intentionally public messages belong here; raw provider errors stay server-side.
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}
