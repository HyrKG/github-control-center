/** Preserve the default error and upstream details for diagnostic output. */
export class LocalizedError extends Error {
  constructor(message: string, readonly localizedMessage: string) {
    super(message);
  }
}

export function toErrorMessage(error: unknown): string {
  return error instanceof LocalizedError ? error.localizedMessage : toDiagnosticMessage(error);
}

export function toDiagnosticMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
