import crypto from "node:crypto";

const serializeError = (error) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
};

const writeLog = (level, message, meta = {}) => {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  const serialized = JSON.stringify(payload);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  console.log(serialized);
};

export const logInfo = (message, meta = {}) => writeLog("info", message, meta);

export const logError = (message, error, meta = {}) =>
  writeLog("error", message, {
    ...meta,
    error: serializeError(error),
  });

export const requestLogger = (req, res, next) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    writeLog("info", "http_request", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
};