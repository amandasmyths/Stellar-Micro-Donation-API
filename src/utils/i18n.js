const Translation = require('../models/translation');
const log = require('./log');

// In-memory cache
let translationCache = {};
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds (as per acceptance criteria)

const loadTranslations = async () => {
  const now = Date.now();
  
  // Return cache if still valid
  if (now - lastCacheUpdate < CACHE_TTL && Object.keys(translationCache).length > 0) {
    return translationCache;
  }

  try {
    const translations = await Translation.find({});
    translationCache = {};

    translations.forEach((doc) => {
      translationCache[doc.key] = doc.translations || {};
    });

    lastCacheUpdate = now;
    log.info('I18N', 'Loaded translation keys from DB', { count: Object.keys(translationCache).length });
    
    return translationCache;
  } catch (error) {
    log.error('I18N', 'Failed to load translations from DB', { error: error.message });
    return translationCache; // fallback to existing cache
  }
};

/**
 * Get translation for a key and language
 * @param {string} key - Translation key (e.g. "error.validation.required")
 * @param {string} lang - Language code (en, es, fr, pt, etc.)
 * @returns {string} Translated string or fallback
 */
const t = async (key, lang = 'en') => {
  const translations = await loadTranslations();
  
  const langTranslations = translations[key] || {};
  
  // Return requested language
  if (langTranslations[lang]) {
    return langTranslations[lang];
  }
  
  // Fallback to English
  if (langTranslations['en']) {
    return langTranslations['en'];
  }
  
  // Ultimate fallback
  return key;
};

/**
 * Get all translations for a specific language
 */
const getAllForLanguage = async (lang = 'en') => {
  const translations = await loadTranslations();
  const result = {};
  
  Object.keys(translations).forEach(key => {
    result[key] = translations[key][lang] || translations[key]['en'] || key;
  });
  
  return result;
};

// ─── Static error-message localisation ──────────────────────────────────────
// Synchronous, dependency-free catalogue used by the error handler to localise
// standard API error responses (separate from the DB-backed dynamic `t` above).

const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'pt'];

const MESSAGES = {
  VALIDATION_ERROR:    { en: 'Validation error',      es: 'Error de validación',        fr: 'Erreur de validation',             pt: 'Erro de validação' },
  INVALID_REQUEST:     { en: 'Invalid request',       es: 'Solicitud inválida',         fr: 'Requête invalide',                 pt: 'Requisição inválida' },
  NOT_FOUND:           { en: 'Resource not found',    es: 'Recurso no encontrado',      fr: 'Ressource introuvable',            pt: 'Recurso não encontrado' },
  UNAUTHORIZED:        { en: 'Unauthorized',          es: 'No autorizado',              fr: 'Non autorisé',                     pt: 'Não autorizado' },
  ACCESS_DENIED:       { en: 'Access denied',         es: 'Acceso denegado',            fr: 'Accès refusé',                     pt: 'Acesso negado' },
  FORBIDDEN:           { en: 'Forbidden',             es: 'Prohibido',                  fr: 'Interdit',                         pt: 'Proibido' },
  INTERNAL_ERROR:      { en: 'Internal server error', es: 'Error interno del servidor', fr: 'Erreur interne du serveur',        pt: 'Erro interno do servidor' },
  DUPLICATE_ERROR:     { en: 'Duplicate resource',    es: 'Recurso duplicado',          fr: 'Ressource en double',              pt: 'Recurso duplicado' },
  RATE_LIMIT_EXCEEDED: { en: 'Rate limit exceeded',   es: 'Límite de tasa excedido',    fr: 'Limite de débit dépassée',         pt: 'Limite de taxa excedido' },
  ENDPOINT_NOT_FOUND:  { en: 'Endpoint not found',    es: 'Punto final no encontrado',  fr: 'Point de terminaison introuvable', pt: 'Endpoint não encontrado' },
};

/**
 * Resolve the best supported language from an Accept-Language header value.
 * Falls back to 'en' when nothing supported is requested.
 * @param {string|undefined|null} acceptLanguage
 * @returns {string} A supported language code.
 */
function parseLanguage(acceptLanguage) {
  if (!acceptLanguage || typeof acceptLanguage !== 'string') return 'en';

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
      const base = (tag || '').trim().toLowerCase().split('-')[0];
      return { base, q: Number.isFinite(q) ? q : 1 };
    })
    .filter((e) => e.base)
    .sort((a, b) => b.q - a.q);

  for (const entry of ranked) {
    if (SUPPORTED_LANGUAGES.includes(entry.base)) return entry.base;
  }
  return 'en';
}

/**
 * Get a localised standard error message.
 * @param {string} key - Message key (e.g. 'VALIDATION_ERROR').
 * @param {string} [lang='en'] - Language code; unsupported languages fall back to English.
 * @returns {string|null} The localised message, or null when the key is unknown.
 */
function getMessage(key, lang = 'en') {
  const entry = MESSAGES[key];
  if (!entry) return null;
  return entry[lang] || entry.en;
}

module.exports = {
  t,
  getAllForLanguage,
  loadTranslations, // exported for admin usage
  parseLanguage,
  getMessage,
  SUPPORTED_LANGUAGES,
  MESSAGES,
};