export class ProtofaceClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtofaceClientError";
  }
}

export class ProtofaceTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtofaceTokenError";
  }
}
