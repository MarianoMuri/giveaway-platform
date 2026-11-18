// Error con código HTTP: el handler de app.js lo convierte en la respuesta
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

module.exports = { HttpError };
