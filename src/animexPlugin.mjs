export async function resolveAnimexSource(request, api) {
  const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
  const SEARCH_ENDPOINT = 'https://graphql.animex.one/graphql';
  const PROVIDERS_ENDPOINT = 'https://pp.animex.one/rest/api/servers';
  const SOURCES_ENDPOINT = 'https://pp.animex.one/rest/api/sources';
  const DEFAULT_429_COOLDOWN_MS = 30 * 1000;
  const MAX_429_COOLDOWN_MS = 20 * 60 * 1000;

  function normalizeTitle(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenizeTitle(value) {
    const stopWords = new Set(['the', 'of', 'and', 'a', 'an', 'season', 'part', 'movie', 'tv']);
    return normalizeTitle(value)
      .split(' ')
      .map((part) => part.trim())
      .filter((part) => part.length >= 2 && !stopWords.has(part));
  }

  function titleSimilarityScore(left, right) {
    const leftTokens = tokenizeTitle(left);
    const rightTokens = tokenizeTitle(right);
    if (!leftTokens.length || !rightTokens.length) return 0;

    const rightSet = new Set(rightTokens);
    let common = 0;
    for (const token of leftTokens) {
      if (rightSet.has(token)) common += 1;
    }

    return common / Math.max(leftTokens.length, rightTokens.length);
  }

  function toPreferredAudioLanguage(preferences) {
    return preferences?.audioLanguage === 'dub' ? 'dub' : 'sub';
  }

  function appendHeaderSafe(headers, name, value) {
    try {
      headers.append(name, value);
    } catch {
      // Some environments disallow certain browser headers.
    }
  }

  function buildJsonHeaders(origin) {
    const headers = new Headers();
    appendHeaderSafe(headers, 'accept', 'application/json');
    appendHeaderSafe(headers, 'accept-language', 'en-US,en;q=0.9,id;q=0.8');
    appendHeaderSafe(headers, 'content-type', 'application/json');
    appendHeaderSafe(headers, 'origin', origin);
    appendHeaderSafe(headers, 'priority', 'u=1, i');
    appendHeaderSafe(headers, 'sec-fetch-dest', 'empty');
    appendHeaderSafe(headers, 'sec-fetch-mode', 'cors');
    appendHeaderSafe(headers, 'sec-fetch-site', 'same-site');
    appendHeaderSafe(
      headers,
      'user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    );
    return headers;
  }

  function parseJsonSafe(text) {
    try {
      return JSON.parse(String(text || ''));
    } catch {
      return null;
    }
  }

  function parseRetryAfterSeconds(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const raw = payload.retry_after;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.max(1, Math.floor(value));
  }

  function toCooldownMs(retryAfterSeconds) {
    if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
      return DEFAULT_429_COOLDOWN_MS;
    }
    return Math.min(MAX_429_COOLDOWN_MS, Math.max(1000, Math.floor(retryAfterSeconds * 1000)));
  }

  function getRateLimitState(cache) {
    if (!cache.rateLimit || typeof cache.rateLimit !== 'object') {
      cache.rateLimit = {
        blockedUntil: 0,
        reason: '',
      };
    }
    return cache.rateLimit;
  }

  async function fetchJsonWithRetries(url, init, attempts, logStep, cache) {
    let lastError = null;
    const rateLimit = getRateLimitState(cache);

    if (rateLimit.blockedUntil > Date.now()) {
      const waitSeconds = Math.max(1, Math.ceil((rateLimit.blockedUntil - Date.now()) / 1000));
      const reason = rateLimit.reason ? ` (${rateLimit.reason})` : '';
      throw new Error(`HTTP 429 cooldown active, retry after ${waitSeconds}s${reason}`);
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await api.fetch(url, {
          ...init,
          signal: api.signal,
        });

        if (!response.ok) {
          const bodyText = await response.text();
          const parsedBody = parseJsonSafe(bodyText);
          const bodyPreview = String(bodyText || '').slice(0, 160).replace(/\s+/g, ' ').trim();
          if (response.status === 429) {
            const retryAfterSeconds = parseRetryAfterSeconds(parsedBody);
            const cooldownMs = toCooldownMs(retryAfterSeconds);
            const waitSeconds = Math.max(1, Math.ceil(cooldownMs / 1000));
            rateLimit.blockedUntil = Date.now() + cooldownMs;
            rateLimit.reason = 'animex-rate-limit';
            const message = `HTTP 429${bodyPreview ? ` ${bodyPreview}` : ''}`;
            lastError = new Error(message);
            logStep(
              `Rate limited by Animex on ${url}. Cooldown ${waitSeconds}s${retryAfterSeconds ? ` (retry_after=${retryAfterSeconds}s)` : ''}.`,
            );
            break;
          }
          const message = `HTTP ${response.status}${bodyPreview ? ` ${bodyPreview}` : ''}`;
          lastError = new Error(message);
          logStep(`Request failed (attempt ${attempt}/${attempts}) for ${url}: ${message}.`);
          continue;
        }

        const parsed = parseJsonSafe(await response.text());
        if (!parsed || typeof parsed !== 'object') {
          lastError = new Error('Non-JSON payload');
          logStep(`Request returned non-JSON payload (attempt ${attempt}/${attempts}) for ${url}.`);
          continue;
        }

        return parsed;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        lastError = error;
        logStep(`Request error (attempt ${attempt}/${attempts}) for ${url}: ${detail}.`);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Request failed after retries');
  }

  function getGlobalCache() {
    const root = typeof globalThis === 'object' && globalThis ? globalThis : {};
    if (!root.__myanime1996AnimexResolveCache) {
      root.__myanime1996AnimexResolveCache = {
        byQuery: {},
        byAnime: {},
        rateLimit: {
          blockedUntil: 0,
          reason: '',
        },
      };
    }

    const cache = root.__myanime1996AnimexResolveCache;
    if (!cache.byQuery || typeof cache.byQuery !== 'object') cache.byQuery = {};
    if (!cache.byAnime || typeof cache.byAnime !== 'object') cache.byAnime = {};
    if (!cache.rateLimit || typeof cache.rateLimit !== 'object') {
      cache.rateLimit = {
        blockedUntil: 0,
        reason: '',
      };
    }
    return cache;
  }

  function getCached(cacheBucket, key) {
    const hit = cacheBucket?.[key];
    if (!hit) return null;
    if (Date.now() - Number(hit.cachedAt || 0) > CACHE_TTL_MS) {
      delete cacheBucket[key];
      return null;
    }
    return hit;
  }

  function setCached(cacheBucket, key, value) {
    cacheBucket[key] = {
      ...value,
      cachedAt: Date.now(),
    };
  }

  function selectBestSearchMatch(candidates, title, titleEnglish, titleJapanese, logStep) {
    const normalizedCandidates = Array.isArray(candidates)
      ? candidates
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const animeId = String(entry.id || '').trim();
            if (!animeId) return null;
            const romaji = String(entry.titleRomaji || '').trim();
            const english = String(entry.titleEnglish || '').trim();
            const displayTitle = english || romaji || animeId;
            const normalizedDisplay = normalizeTitle(displayTitle);
            return {
              animeId,
              title: displayTitle,
              normalizedDisplay,
              raw: entry,
            };
          })
          .filter(Boolean)
      : [];

    if (!normalizedCandidates.length) return null;

    const normalizedTitle = normalizeTitle(title);
    const normalizedEnglish = normalizeTitle(titleEnglish);
    const normalizedJapanese = normalizeTitle(titleJapanese);

    const exact = normalizedCandidates.find((entry) => {
      return (
        (normalizedTitle && entry.normalizedDisplay === normalizedTitle) ||
        (normalizedEnglish && entry.normalizedDisplay === normalizedEnglish) ||
        (normalizedJapanese && entry.normalizedDisplay === normalizedJapanese)
      );
    });
    if (exact) {
      logStep(`Selected exact Animex catalog match: ${exact.animeId}.`);
      return exact;
    }

    let best = null;
    let bestScore = 0;
    for (const candidate of normalizedCandidates) {
      const score = Math.max(
        titleSimilarityScore(title, candidate.title),
        titleSimilarityScore(titleEnglish, candidate.title),
        titleSimilarityScore(titleJapanese, candidate.title),
      );
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (best && bestScore >= 0.5) {
      logStep(`Selected approximate Animex catalog match (score=${bestScore.toFixed(2)}): ${best.animeId}.`);
      return best;
    }

    return normalizedCandidates[0];
  }

  function toProviderCandidates(payload, audioLanguage, logStep) {
    const subProviders = Array.isArray(payload?.subProviders) ? payload.subProviders : [];
    const dubProviders = Array.isArray(payload?.dubProviders) ? payload.dubProviders : [];

    if (audioLanguage === 'dub') {
      const dub = dubProviders
        .map((entry) => {
          const id = String(entry?.id || '').trim();
          if (!id) return null;
          return {
            id,
            tip: String(entry?.tip || '').trim(),
            default: Boolean(entry?.default),
          };
        })
        .filter(Boolean)
        .sort((left, right) => Number(right.default) - Number(left.default));

      logStep(`Animex dub providers available: ${dub.length}.`);
      return dub;
    }

    const hardSub = subProviders
      .map((entry) => {
        const id = String(entry?.id || '').trim();
        if (!id) return null;
        return {
          id,
          tip: String(entry?.tip || '').trim(),
          default: Boolean(entry?.default),
        };
      })
      .filter(Boolean)
      .filter((entry) => /hard\s*sub/i.test(entry.tip))
      .sort((left, right) => Number(right.default) - Number(left.default));

    logStep(`Animex hard-sub provider candidates: ${hardSub.length}.`);
    return hardSub;
  }

  function toSourceOptions(payload, animeId, episodeNumber, audioLanguage, providerId) {
    const sources = Array.isArray(payload?.sources) ? payload.sources : [];
    const options = [];

    for (const entry of sources) {
      const url = String(entry?.url || '').trim();
      if (!url) continue;

      const quality = String(entry?.quality || 'auto').trim() || 'auto';
      const mimeType = String(entry?.type || '').trim();
      options.push({
        id: `animex-${animeId}-ep-${episodeNumber}-${audioLanguage}-${providerId}-${quality}`,
        type: 'direct',
        url,
        label: `Animex ${providerId.toUpperCase()} ${audioLanguage.toUpperCase()} ${quality}`,
        language: audioLanguage,
        server: providerId,
        controllable: true,
        mimeType,
      });
    }

    return options;
  }

  const steps = [];
  const logStep = (message) => {
    const text = String(message || '').trim();
    if (!text || steps.length >= 80) return;
    steps.push(text);
    try {
      if (typeof api?.logStep === 'function') {
        api.logStep(text);
      }
    } catch {
      // Ignore host runtime log forwarding errors.
    }
  };

  const item = request?.item || {};
  const episodeNumber = Math.max(1, Number(item.episodeNumber || 1));
  const kind = String(item.kind || 'episode').toLowerCase();
  const requestedAudioLanguage = toPreferredAudioLanguage(request?.preferences);
  const title = String(item.title || '').trim();
  const titleEnglish = String(item.titleEnglish || '').trim();
  const titleJapanese = String(item.titleJapanese || '').trim();

  if (!title && !titleEnglish && !titleJapanese) {
    return {
      noMatchReason: 'Missing title metadata for Animex source resolution.',
      steps,
    };
  }

  if (!['episode', 'movie', 'ova', 'ona', 'special'].includes(kind)) {
    return {
      noMatchReason: `Unsupported media kind: ${kind || 'unknown'}.`,
      steps,
    };
  }

  const cache = getGlobalCache();
  const rateLimit = getRateLimitState(cache);
  if (rateLimit.blockedUntil > Date.now()) {
    const waitSeconds = Math.max(1, Math.ceil((rateLimit.blockedUntil - Date.now()) / 1000));
    logStep(`Animex rate-limit cooldown active. Skipping resolver network calls for ${waitSeconds}s.`);
    return {
      noMatchReason: `Animex rate limit active. Retry after ${waitSeconds}s.`,
      steps,
    };
  }

  const queryKey = normalizeTitle(titleEnglish || title || titleJapanese);
  const audioLanguage = requestedAudioLanguage;
  const queryText = titleEnglish || title || titleJapanese;

  logStep(`Resolving Animex source for ${queryText} episode ${episodeNumber}.`);
  logStep(`Requested language: ${audioLanguage.toUpperCase()}.`);

  let anime = getCached(cache.byQuery, queryKey);
  if (!anime) {
    const searchBody = {
      query:
        '\nquery FastSearch($query: String, $limit: Int, $includeAdult: Boolean) {\n  catalogAnime(filter: { query: $query, includeAdult: $includeAdult }, limit: $limit) {\n    items {\n      id\n      anilistId\n      malId\n      titleRomaji\n      titleEnglish\n      coverImage\n      format\n      status\n      episodeCount\n      seasonYear\n      season\n      color\n      genres\n      bannerImage\n    }\n  }\n}\n',
      variables: {
        query: queryText,
        limit: 20,
        includeAdult: false,
      },
    };

    let searchPayload;
    try {
      searchPayload = await fetchJsonWithRetries(
        SEARCH_ENDPOINT,
        {
          method: 'POST',
          headers: buildJsonHeaders('https://animex.one'),
          body: JSON.stringify(searchBody),
          redirect: 'follow',
        },
        3,
        logStep,
        cache,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        noMatchReason: `Animex search failed: ${detail}.`,
        steps,
      };
    }

    const candidates = searchPayload?.data?.catalogAnime?.items;
    anime = selectBestSearchMatch(candidates, title, titleEnglish, titleJapanese, logStep);
    if (!anime) {
      return {
        noMatchReason: 'Animex catalog search returned no usable matches.',
        steps,
      };
    }

    setCached(cache.byQuery, queryKey, anime);
    setCached(cache.byAnime, anime.animeId, anime);
  } else {
    logStep(`Animex cache hit for query: ${queryText}.`);
  }

  const animeId = String(anime.animeId || '').trim();
  if (!animeId) {
    return {
      noMatchReason: 'Animex match did not include a valid anime id.',
      steps,
    };
  }

  const providersUrl = `${PROVIDERS_ENDPOINT}?id=${encodeURIComponent(animeId)}&epNum=${encodeURIComponent(String(episodeNumber))}`;
  let providersPayload;
  try {
    providersPayload = await fetchJsonWithRetries(
      providersUrl,
      {
        method: 'GET',
        headers: buildJsonHeaders('https://animex.one'),
        redirect: 'follow',
      },
      3,
      logStep,
      cache,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      noMatchReason: `Animex provider lookup failed: ${detail}.`,
      steps,
    };
  }

  const providerCandidates = toProviderCandidates(providersPayload, audioLanguage, logStep);
  if (!providerCandidates.length) {
    return {
      noMatchReason: `No ${audioLanguage.toUpperCase()} providers available for ${animeId} episode ${episodeNumber}.`,
      steps,
    };
  }

  const typeParam = audioLanguage === 'dub' ? 'dub' : 'sub';
  const optionList = [];
  let selectedOptionId = undefined;

  for (const provider of providerCandidates) {
    const providerId = provider.id;
    const sourceUrl = `${SOURCES_ENDPOINT}?id=${encodeURIComponent(animeId)}&epNum=${encodeURIComponent(String(episodeNumber))}&type=${encodeURIComponent(typeParam)}&providerId=${encodeURIComponent(providerId)}`;

    let sourcePayload;
    try {
      sourcePayload = await fetchJsonWithRetries(
        sourceUrl,
        {
          method: 'GET',
          headers: buildJsonHeaders('https://animex.one'),
          redirect: 'follow',
        },
        2,
        logStep,
        cache,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logStep(`Skipping provider ${providerId}: ${detail}.`);
      continue;
    }

    const providerOptions = toSourceOptions(sourcePayload, animeId, episodeNumber, audioLanguage, providerId);
    if (!providerOptions.length) {
      logStep(`Provider ${providerId} returned no playable sources.`);
      continue;
    }

    logStep(`Provider ${providerId} returned ${providerOptions.length} source(s).`);
    optionList.push(...providerOptions);
    if (!selectedOptionId) {
      selectedOptionId = providerOptions[0].id;
    }
  }

  if (!optionList.length) {
    return {
      noMatchReason: `Animex sources unavailable for ${animeId} episode ${episodeNumber} (${audioLanguage}).`,
      steps,
    };
  }

  return {
    selectedOptionId,
    sources: optionList,
    message: `Resolved Animex ${audioLanguage.toUpperCase()} sources for ${animeId} episode ${episodeNumber}.`,
    steps,
  };
}

const ANIMEX_RESOLVER_CODE = resolveAnimexSource.toString();

export const animexPluginArtifact = {
  schemaVersion: 2,
  compatibilityApiVersion: '1.0',
  plugin: {
    id: 'animex-source',
    name: 'Animex Source',
    version: '1.0.1',
    compatibilityApiVersion: '1.0',
    hostRequirements: {
      connectSrcOrigins: ['https://graphql.animex.one', 'https://pp.animex.one'],
      frameSrcOrigins: ['https://animex.one', 'https://pp.animex.one'],
      httpAllowlist: ['https://graphql.animex.one/*', 'https://pp.animex.one/*'],
    },
    resolver: {
      kind: 'inline-js',
      code: ANIMEX_RESOLVER_CODE,
      timeoutMs: 25000,
    },
    iconPng: {
      mimeType: 'image/png',
      dataBase64: "iVBORw0KGgoAAAANSUhEUgAAApoAAAF3CAYAAAAFPus+AAAgAElEQVR4XuxdB3gU1RrdNAi9hF4URQSlKhZ6k6KA2BFFRRBEqnQBC01AOojgQ6Qo2EABEUVQEbAgqIhioYvSe28pm3f+ydw4DJvs7M7MZgNnvm9JyM7cuffcdu5fIzy8iAARIAJEgAgQASJABIiACwhEuFAmiyQCRIAIEAEiQASIABEgAh4STQ4CIkAEiAARIAJEgAgQAVcQINF0BVYWSgSIABEgAkSACBABIkCiyTFABIgAESACRIAIEAEi4AoCJJquwMpCiQARIAJEgAgQASJABEg0OQaIABEgAkSACBABIkAEXEGARNMVWFkoESACRIAIEAEiQASIAIkmxwARIAJEgAgQASJABIiAKwiQaLoCKwslAkSACBABIkAEiAARINHkGCACRIAIEAEiQASIABFwBQESTVdgZaFEgAgQASJABIgAESACJJocA0SACBABIkAEiAARIAKuIECi6QqsLJQIEAEiQASIABEgAkSARJNjgAgQASJABIgAESACRMAVBEg0XYGVhRIBIkAEiAARIAJEgAiQaHIMEAEiQASIABEgAkSACLiCAImmK7CyUCJABIgAESACRIAIEAESTY4BIkAEiAARIAJEgAgQAVcQINF0BVYWSgSIABEgAkSACBABIkCiyTFABIgAESACRIAIEAEi4AoCJJquwMpCiQARIAJEgAgQASJABEg0OQaIABEgAkSACBABIkAEXEGARNMVWFkoESACRIAIEAEiQASIAIkmxwARIAJEgAgQASJABIiAKwiQaLoCKwslAkSACBABIkAEiAARINHkGCACRIAIEAEiQASIABFwBQESTVdgZaFEgAgQASJABIgAESACJJocA0SACBABIkAEiAARIAKuIECi6QqsLJQIEAEiQASIABEgAkSARJNjgAgQASJABIgAESACRMAVBEg0XYGVhRIBIkAEiAARIAJEgAiQaHIMEAEiQASIABEgAkSACLiCAImmK7CyUCJABIgAESACRIAIEAESTY4BIkAEiAARIAJEgAgQAVcQINF0BVYWSgSIABEgAkSACBABIkCiyTFABIgAESACRIAIEAEi4AoCJJquwMpCiQARIAJEgAgQASJABEg0OQaIABEgAkSACBABIkAEXEGARNMVWFkoESACRIAIEAEiQASIAIkmxwARIAJEgAgQASJABIiAKwiQaLoCKwslAkSACBABIkAEiAARINHkGCACRIAIEAEiQASIABFwBQESTVdgZaFEgAgQASJABIgAESACJJocA0SACBABIkAEiAARIAKuIECi6QqsLJQIEAEiQASIABEgAkSARJNjgAgQASJABIgAESACRMAVBEg0XYGVhRIBIkAEiAARIAJEgAiQaHIMEAEiQASIABEgAkSACLiCAImmK7CyUCJABIgAESACRIAIEAESTY4BIkAEiAARIAJEgAgQAVcQINF0BVYWSgSIABEgAkSACBABIkCiyTFABIgAESACRIAIEAEi4AoCJJquwMpCiQARIAJEgAgQASJABEg0OQaIABEgAkSACBABIkAEXEGARNMVWFkoESACRIAIEAEiQASIAIkmxwARIAJEgAgQASJABIiAKwiQaLoCKwslAkSACBABIkAEiAARINHkGCACRIAIEAEiQASIABFwBQESTVdgZaFEgAgQASJABIgAESACJJocA0SACBABIkAEiAARIAKuIECi6QqsLJQIEAEiQASIABEgAkSARJNjgAgQASJABIgAESACRMAVBEg0XYGVhRIBIkAEiAARIAJEgAiQaHIMEAEiQASIABEgAkSACLiCAImmK7CyUCJABIgAESACRIAIEAESTY4BIkAEiAARIAJEgAgQAVcQINF0BVYWSgSIABEgAkSACBABIkCiyTFABIgAESACRIAIEAEi4AoCJJquwMpCiQARIAJEgAgQASJABEg0OQaIABEgAkSACBABIkAEXEGARNMVWFkoESACRIAIEAEiQASIAIkmxwARIAJEgAgQASJABIiAKwiQaLoCKwslAkSACBABIkAEiAARINHkGCACRIAIEAEiQASIABFwBQESTVdgZaFEgAgQASJABIgAESACJJocA0SACBABIkAEiAARIAKuIECi6QqsLJQIEAEiQASIABEgAkSARJNjgAgQASJABIgAESACRMAVBEg0XYGVhRIBIkAEiAARIAJEgAiQaHIMEAEiQASIABEgAkSACLiCAImmK7CyUCJABIgAESACRIAIEAESTY4BIkAEiAARIAJEgAgQAVcQINF0BVYWSgSIABEgAkSACBABIkCiyTFABIgAESACRIAIEAEi4AoCJJquwMpCiQARIAJEgAgQASJABEg0OQaIABEgAkSACBABIkAEXEGARNMVWFkoESACRIAIEAEiQASIAIkmxwARIAJEgAgQASJABIiAKwiQaLoCKwslAkSACBABIkAEiAARINHkGCACRIAIEAEiQASIABFwBQESTVdgZaFEgAgQASJABIgAESACJJocA0SACBABIkAEiAARIAKuIECi6QqsLJQIEAEiQASIABEgAkSARJNjgAgQASJABIgAESACRMAVBEg0XYGVhRIBIkAEiAARIAJEgAiQaHIMEAEiQASIABEgAkSACLiCAImmK7CyUCJABIgAESACRIAIEAESTY4BIkAEiAARIAJEgAgQAVcQINF0BVYWSgSIABEgAkSACBABIkCiyTFABIgAESACRIAIEAEi4AoCJJquwMpCiQARIAJEgAgQASJABEg0OQaIABEgAkSACBABIkAEXEGARNMVWFkoESACRIAIEAEiQASIAIkmxwARIAJEgAgQASJABIiAKwiQaLoC65VT6EMPPZRl3rx5iREREd4rp9VsKREgAkSACBABImAFARJNKyjxnosQSE5Ojvjuu++Kzp8/v+SYMWOqgWT+9e677/7cpk2bI4SKCBABIkAEiAARIAIKARJNjgXLCAjBXLx4cdHq1atXyZUrV8uYmJh7oqKicqOA/cuXL3/7o48+mp8jR46/JkyYcM5yobyRCBABIkAEiAARuGwRING8bLvW2YZBRZ5z9uzZ9c+dO3dvXFzcHSi9GD7RSUlJMoaSQTgv4Pefz58///F0XD179jzubA1YGhEgAkSACBABIpDZECDRzGw9FuL6wv4y6sCBAzeVLVv2kbp1696VJUuW6xITE6NxRXi9Xk9kZKSxRsn4z7GEhIRPzpw5M/ull15aM3ny5AshrjJfRwSIABEgAkSACIQJAiSaYdIR4ViN77//PtsNN9zQKW/evE+gfteBQGaHujwCkksPJJhalUE6PSCdntOnT3ty5swpfxKymYjP1iNHjixYt27dmKZNm54Mx/axTkSACBABIkAEiIC7CJBouotvpitd7DBR6RyQYjYoUKBABxDKWpBc5oHkUhsrIJsayRRJJu7V2gdnIO2n/F+knDoJlS/P4vPjnj17xhUvXvwr3EfbzUw3IlhhIkAEiAARIALBI0CiGTx2l9WTIImRGzduzPPee+9VGjx4cF+oyBuggbHCI202VAhnEj5zWrZsOaFIkSJb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",
      width: 666,
      height: 375,
    }
  },
};
