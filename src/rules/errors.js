export class RuleError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "RuleError";
    this.code = code;
    Object.assign(this, extra);
  }
}
