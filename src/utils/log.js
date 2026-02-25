const { maskSensitiveData, maskError } = require('./dataMasker');

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message });
  }
}

function formatMessage(level, scope, message, meta) {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level}] [${scope}] ${message}`;

  if (meta === undefined) {
    return base;
  }

  // Mask sensitive data before logging
  const maskedMeta = maskSensitiveData(meta, {
    showPartial: process.env.LOG_SHOW_PARTIAL === 'true'
  });

  return `${base} ${safeStringify(maskedMeta)}`;
}

function info(scope, message, meta) {
  console.log(formatMessage('INFO', scope, message, meta));
}

function warn(scope, message, meta) {
  console.warn(formatMessage('WARN', scope, message, meta));
}

function error(scope, message, meta) {
  // Special handling for error objects
  let maskedMeta = meta;
  if (meta && meta.error instanceof Error) {
    maskedMeta = {
      ...meta,
      error: maskError(meta.error)
    };
  }
  console.error(formatMessage('ERROR', scope, message, maskedMeta));
}

module.exports = {
  info,
  warn,
  error,
};
