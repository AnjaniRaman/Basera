/**
 * A business-rule violation. `code` is stable and maps to a translated message in the app
 * (err.<code>); `details` carries the values the message may need.
 */
export class DomainError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, details) {
  throw new DomainError(code, details);
}

export function assert(condition, code, details) {
  if (!condition) fail(code, details);
}
