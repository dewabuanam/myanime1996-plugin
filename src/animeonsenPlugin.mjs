export async function resolveAnimeonsenSource(request, api) {
  const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
  const VIDEO_BEARER_REFRESH_MS = 5 * 24 * 60 * 60 * 1000;
  const SEARCH_ENDPOINT = 'https://search.animeonsen.xyz/indexes/content/search';
  const VIDEO_ENDPOINT_BASE = 'https://api.animeonsen.xyz/v4/content';
  const MAX_MANUAL_SELECTION_OPTIONS = 5;
  const MIN_MANUAL_SELECTION_SIMILARITY = 0.6;
  const DEFAULT_429_COOLDOWN_MS = 30 * 1000;
  const MAX_429_COOLDOWN_MS = 20 * 60 * 1000;

  // As provided, this token is stable for the search index endpoint.
  const SEARCH_BEARER_TOKEN = '0e36d0275d16b40d7cf153634df78bc229320d073f565db2aaf6d027e0c30b13';


  function normalizeTitle(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
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

  function normalizeForScore(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, '');
  }

  function titleSimilarityScore(left, right) {
    const leftValue = normalizeForScore(left);
    const rightValue = normalizeForScore(right);
    if (!leftValue || !rightValue) return 0;
    if (leftValue === rightValue) return 1;

    const toBigrams = (value) => {
      if (value.length < 2) return [value];
      const pairs = [];
      for (let i = 0; i < value.length - 1; i += 1) {
        pairs.push(value.slice(i, i + 2));
      }
      return pairs;
    };

    const leftBigrams = toBigrams(leftValue);
    const rightBigrams = toBigrams(rightValue);
    if (!leftBigrams.length || !rightBigrams.length) return 0;

    const rightCounts = new Map();
    for (const pair of rightBigrams) {
      rightCounts.set(pair, (rightCounts.get(pair) || 0) + 1);
    }

    let overlap = 0;
    for (const pair of leftBigrams) {
      const count = rightCounts.get(pair) || 0;
      if (count > 0) {
        overlap += 1;
        rightCounts.set(pair, count - 1);
      }
    }

    return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
  }

  function toPreferredAudioLanguage(preferences) {
    return preferences?.audioLanguage === 'dub' ? 'dub' : 'sub';
  }

  function appendHeaderSafe(headers, name, value) {
    try {
      headers.append(name, value);
    } catch {
      // Some environments disallow browser-managed headers.
    }
  }

  function buildSearchHeaders() {
    const headers = new Headers();
    appendHeaderSafe(headers, 'accept', '*/*');
    appendHeaderSafe(headers, 'accept-language', 'en-US,en;q=0.9,id;q=0.8');
    appendHeaderSafe(headers, 'authorization', `Bearer ${SEARCH_BEARER_TOKEN}`);
    appendHeaderSafe(headers, 'content-type', 'application/json');
    appendHeaderSafe(headers, 'origin', 'https://www.animeonsen.xyz');
    appendHeaderSafe(headers, 'priority', 'u=1, i');
    appendHeaderSafe(headers, 'referer', 'https://www.animeonsen.xyz/');
    appendHeaderSafe(headers, 'sec-fetch-dest', 'empty');
    appendHeaderSafe(headers, 'sec-fetch-mode', 'cors');
    appendHeaderSafe(headers, 'sec-fetch-site', 'same-site');
    appendHeaderSafe(
      headers,
      'x-meilisearch-client',
      'Meilisearch instant-meilisearch (v0.8.2) ; Meilisearch JavaScript (v0.27.0)',
    );
    appendHeaderSafe(
      headers,
      'user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    );
    return headers;
  }

  function buildVideoHeaders(videoBearerToken) {
    const headers = new Headers();
    appendHeaderSafe(headers, 'accept', 'application/json, text/plain, */*');
    appendHeaderSafe(headers, 'accept-language', 'en-US,en;q=0.9');
    appendHeaderSafe(headers, 'authorization', `Bearer ${videoBearerToken}`);
    appendHeaderSafe(headers, 'origin', 'https://www.animeonsen.xyz');
    appendHeaderSafe(headers, 'priority', 'u=1, i');
    appendHeaderSafe(headers, 'referer', 'https://www.animeonsen.xyz/');
    appendHeaderSafe(headers, 'sec-ch-ua', '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"');
    appendHeaderSafe(headers, 'sec-ch-ua-mobile', '?0');
    appendHeaderSafe(headers, 'sec-ch-ua-platform', '"Windows"');
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

  function buildSubtitleHeaders(videoBearerToken) {
    return {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      authorization: `Bearer ${videoBearerToken}`,
      origin: 'https://www.animeonsen.xyz',
      priority: 'u=1, i',
      referer: 'https://www.animeonsen.xyz/',
      'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    };
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
      throw new Error(`HTTP 429 cooldown active, retry after ${waitSeconds}s`);
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await api.fetch(url, {
          ...init,
          signal: api.signal,
          redirect: 'follow',
        });

        const bodyText = await response.text();
        const payload = parseJsonSafe(bodyText);
        const bodyPreview = String(bodyText || '').slice(0, 180).replace(/\s+/g, ' ').trim();

        if (!response.ok) {
          if (response.status === 429) {
            const retryAfterSeconds = parseRetryAfterSeconds(payload);
            const cooldownMs = toCooldownMs(retryAfterSeconds);
            const waitSeconds = Math.max(1, Math.ceil(cooldownMs / 1000));
            rateLimit.blockedUntil = Date.now() + cooldownMs;
            rateLimit.reason = 'animeonsen-rate-limit';
            lastError = new Error(`HTTP 429 ${bodyPreview}`.trim());
            logStep(`AnimeOnsen rate limited. Cooldown ${waitSeconds}s.`);
            break;
          }

          if (response.status === 401 || response.status === 403) {
            lastError = new Error(`HTTP ${response.status} unauthorized ${bodyPreview}`.trim());
            logStep(`AnimeOnsen auth rejected on ${url} (attempt ${attempt}/${attempts}).`);
            continue;
          }

          lastError = new Error(`HTTP ${response.status} ${bodyPreview}`.trim());
          logStep(`Request failed on ${url} (attempt ${attempt}/${attempts}): HTTP ${response.status}.`);
          continue;
        }

        if (!payload || typeof payload !== 'object') {
          lastError = new Error('Non-JSON payload');
          logStep(`Request returned non-JSON payload on ${url} (attempt ${attempt}/${attempts}).`);
          continue;
        }

        return payload;
      } catch (error) {
        lastError = error;
        const detail = error instanceof Error ? error.message : String(error);
        logStep(`Request error on ${url} (attempt ${attempt}/${attempts}): ${detail}.`);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Request failed after retries');
  }

  function getGlobalCache() {
    const root = typeof globalThis === 'object' && globalThis ? globalThis : {};
    if (!root.__myanime1996AnimeonsenResolveCache) {
      root.__myanime1996AnimeonsenResolveCache = {
        byQuery: {},
        byEpisode: {},
        rateLimit: {
          blockedUntil: 0,
          reason: '',
        },
        videoBearerToken: '',
        videoBearerTokenUpdatedAt: 0,
      };
    }

    const cache = root.__myanime1996AnimeonsenResolveCache;
    if (!cache.byQuery || typeof cache.byQuery !== 'object') cache.byQuery = {};
    if (!cache.byEpisode || typeof cache.byEpisode !== 'object') cache.byEpisode = {};
    if (!cache.rateLimit || typeof cache.rateLimit !== 'object') {
      cache.rateLimit = {
        blockedUntil: 0,
        reason: '',
      };
    }
    if (typeof cache.videoBearerToken !== 'string' || !cache.videoBearerToken.trim()) {
      cache.videoBearerToken = '';
    }
    if (!Number.isFinite(Number(cache.videoBearerTokenUpdatedAt || 0))) {
      cache.videoBearerTokenUpdatedAt = 0;
    }
    return cache;
  }

  function base64ToUtf8(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    try {
      if (typeof atob === 'function') {
        const binary = atob(normalized);
        const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
      }
    } catch {
      return '';
    }
    return '';
  }

  function decodeAoSessionToBearer(rawCookieValue) {
    const decodedCookie = decodeURIComponent(String(rawCookieValue || '').trim());
    if (!decodedCookie) return '';
    const baseText = base64ToUtf8(decodedCookie);
    if (!baseText) return '';
    return baseText
      .split('')
      .reduce((acc, ch) => acc + String.fromCharCode(ch.charCodeAt(0) + 1), '');
  }

  function parseAoSessionFromSetCookieHeader(setCookieHeaderValue) {
    const headerValue = String(setCookieHeaderValue || '');
    if (!headerValue) return '';
    const match = headerValue.match(/(?:^|,\s*)ao\.session=([^;]+)/i);
    return match ? String(match[1] || '').trim() : '';
  }

  async function refreshVideoBearerTokenFromWatchFlow(cache, contentId, episodeNumber, logStep, force) {
    const currentToken = String(cache.videoBearerToken || '').trim();
    const lastUpdatedAt = Number(cache.videoBearerTokenUpdatedAt || 0);
    const now = Date.now();
    const isFresh = now - lastUpdatedAt < VIDEO_BEARER_REFRESH_MS;
    if (!force && currentToken && isFresh) {
      return currentToken;
    }

    if (!contentId) {
      return currentToken;
    }

    if (!api || typeof api.nativeFetchText !== 'function') {
      logStep('Token refresh via watch flow skipped: native transport unavailable.');
      return currentToken;
    }

    const safeEpisode = Math.max(1, Number(episodeNumber || 1));
    const watchUrl = `https://www.animeonsen.xyz/watch/${encodeURIComponent(String(contentId))}?episode=${encodeURIComponent(String(safeEpisode))}`;

    try {
      logStep(
        force
          ? `Refreshing AnimeOnsen bearer token (forced) from watch flow for ${contentId} ep ${safeEpisode}.`
          : `Refreshing AnimeOnsen bearer token from watch flow (>=5 days) for ${contentId} ep ${safeEpisode}.`,
      );

      const watchResponse = await api.nativeFetchText(watchUrl, {
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        },
      });

      const setCookieHeader = String(watchResponse.headers?.['set-cookie'] || '');
      const aoSession = parseAoSessionFromSetCookieHeader(setCookieHeader);
      if (!aoSession) {
        logStep('Watch-flow token refresh did not expose ao.session cookie; keeping previous bearer token.');
        return currentToken;
      }

      const refreshedToken = decodeAoSessionToBearer(aoSession);
      if (!refreshedToken) {
        logStep('Watch-flow token refresh failed to decode ao.session cookie; keeping previous bearer token.');
        return currentToken;
      }

      cache.videoBearerToken = refreshedToken;
      cache.videoBearerTokenUpdatedAt = now;
      logStep('AnimeOnsen bearer token refreshed from watch flow.');
      return refreshedToken;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logStep(`Watch-flow token refresh error: ${detail}. Using previous bearer token.`);
      return currentToken;
    }
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

  function normalizeSearchHits(payload) {
    const hits = Array.isArray(payload?.hits) ? payload.hits : [];
    return hits
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const contentId = String(entry.content_id || '').trim();
        if (!contentId) return null;

        const romaji = String(entry.content_title || '').trim();
        const english = String(entry.content_title_en || '').trim();
        const japanese = String(entry.content_title_jp || '').trim();
        const display = english || romaji || japanese || contentId;

        return {
          contentId,
          title: display,
          titleRomaji: romaji,
          titleEnglish: english,
          titleJapanese: japanese,
          normalized: normalizeTitle(display),
        };
      })
      .filter(Boolean);
  }

  function pickBestMatch(candidates, title, titleEnglish, titleJapanese, logStep) {
    if (!candidates.length) return null;

    const normalizedTitle = normalizeTitle(title);
    const normalizedEnglish = normalizeTitle(titleEnglish);
    const normalizedJapanese = normalizeTitle(titleJapanese);

    const exact = candidates.find((entry) => {
      return (
        (normalizedTitle && entry.normalized === normalizedTitle) ||
        (normalizedEnglish && entry.normalized === normalizedEnglish) ||
        (normalizedJapanese && entry.normalized === normalizedJapanese)
      );
    });

    if (exact) {
      logStep(`Selected exact AnimeOnsen match: ${exact.contentId}.`);
      return exact;
    }

    let best = null;
    let bestScore = 0;

    for (const candidate of candidates) {
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

    if (best && bestScore >= 0.45) {
      logStep(`Selected approximate AnimeOnsen match (score=${bestScore.toFixed(2)}): ${best.contentId}.`);
      return best;
    }

    const fallback = candidates[0];
    logStep(`Selected fallback AnimeOnsen match: ${fallback.contentId}.`);
    return fallback;
  }

  function buildRankedCandidates(candidates, title, titleEnglish, titleJapanese) {
    const normalizedTitle = normalizeForScore(title);
    const normalizedEnglish = normalizeForScore(titleEnglish);
    const normalizedJapanese = normalizeForScore(titleJapanese);

    return [...candidates]
      .map((candidate) => {
        const candidateNormalized = normalizeForScore(candidate.normalized || candidate.title || '');
        const exact =
          (normalizedTitle && candidateNormalized === normalizedTitle) ||
          (normalizedEnglish && candidateNormalized === normalizedEnglish) ||
          (normalizedJapanese && candidateNormalized === normalizedJapanese);

        const similarity = Math.max(
          titleSimilarityScore(title, candidate.title),
          titleSimilarityScore(titleEnglish, candidate.title),
          titleSimilarityScore(titleJapanese, candidate.title),
        );

        return {
          candidate,
          score: similarity + (exact ? 1 : 0),
          exact,
          similarity,
        };
      })
      .sort((left, right) => right.score - left.score)
      .map((entry) => ({
        ...entry.candidate,
        _matchExact: entry.exact,
        _matchSimilarity: entry.similarity,
      }));
  }

  function isCandidateCompatibleWithRequest(metadata, requestedKind, requestedEpisodeNumber) {
    const isMovie = Boolean(metadata?.is_movie);
    const totalEpisodes = Number(metadata?.total_episodes || 0);

    if (requestedKind === 'movie') {
      // Movie requests can still map to single-episode metadata.
      return isMovie || totalEpisodes === 1 || totalEpisodes === 0;
    }

    // Series requests should not map to explicit movie metadata.
    if (isMovie) {
      return false;
    }

    // If provider returns episode count, ensure requested episode is in-range.
    if (totalEpisodes > 0 && requestedEpisodeNumber > totalEpisodes) {
      return false;
    }

    return true;
  }

  function toWebVttTimestamp(assTimestamp) {
    const raw = String(assTimestamp || '').trim();
    const match = raw.match(/^(\d+):(\d{1,2}):(\d{1,2})[\.\:](\d{1,2})$/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const centiseconds = Number(match[4]);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds) || !Number.isFinite(centiseconds)) {
      return null;
    }

    const ms = Math.max(0, Math.min(999, centiseconds * 10));
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function cleanAssText(value) {
    return String(value || '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/g, ' ')
      .replace(/\r/g, '')
      .trim();
  }

  function assToWebVtt(assText) {
    const lines = String(assText || '').split(/\n/);
    const cues = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('Dialogue:')) continue;

      const payload = trimmed.slice('Dialogue:'.length).trim();
      const fields = [];
      let buffer = '';
      let commas = 0;

      for (let index = 0; index < payload.length; index += 1) {
        const ch = payload[index];
        if (ch === ',' && commas < 9) {
          fields.push(buffer);
          buffer = '';
          commas += 1;
        } else {
          buffer += ch;
        }
      }
      fields.push(buffer);
      if (fields.length < 10) continue;

      const start = toWebVttTimestamp(fields[1]);
      const end = toWebVttTimestamp(fields[2]);
      const text = cleanAssText(fields[9]);
      if (!start || !end || !text) continue;

      cues.push({ start, end, text });
    }

    if (!cues.length) return null;

    const body = cues
      .map((cue, index) => `${index + 1}\n${cue.start} --> ${cue.end}\n${cue.text}`)
      .join('\n\n');
    return `WEBVTT\n\n${body}\n`;
  }

  function toTextDataUrl(text) {
    return `data:text/vtt;charset=utf-8,${encodeURIComponent(String(text || ''))}`;
  }

  function toEpisodeOneSubtitleUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    return value.replace(/\/v4\/subtitles\/([^/]+)\/([^/]+)\/\d+(\?.*)?$/i, '/v4/subtitles/$1/$2/1$3');
  }

  async function fetchSubtitleTrackUrl(rawUrl, videoBearerToken, logStep) {
    const url = String(rawUrl || '').trim();
    if (!url) return undefined;

    const tryFetchSubtitle = async (targetUrl) => {
      if (api && typeof api.nativeFetchText === 'function') {
        try {
          logStep(`Resolving subtitle via native runtime transport for ${targetUrl}.`);
          const result = await api.nativeFetchText(targetUrl, {
            method: 'GET',
            headers: buildSubtitleHeaders(videoBearerToken),
          });
          return {
            response: {
              ok: result.ok,
              status: result.status,
            },
            subtitleText: result.text,
            targetUrl,
          };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          logStep(`Native subtitle resolve failed for ${targetUrl}: ${detail}. Falling back to fetch.`);
        }
      }

      const response = await api.fetch(targetUrl, {
        method: 'GET',
        headers: buildSubtitleHeaders(videoBearerToken),
        signal: api.signal,
        redirect: 'follow',
      });
      const subtitleText = await response.text();
      return { response, subtitleText, targetUrl };
    };

    try {
      let { response, subtitleText, targetUrl } = await tryFetchSubtitle(url);

      if (!response.ok && (response.status === 401 || response.status === 403)) {
        const episodeOneUrl = toEpisodeOneSubtitleUrl(url);
        if (episodeOneUrl && episodeOneUrl !== url) {
          logStep(`Subtitle auth failed on episode URL, retrying with episode=1 fallback for ${url}.`);
          try {
            const fallback = await tryFetchSubtitle(episodeOneUrl);
            response = fallback.response;
            subtitleText = fallback.subtitleText;
            targetUrl = fallback.targetUrl;
          } catch {
            // Keep original failed response handling below.
          }
        }
      }

      if (!response.ok) {
        const preview = subtitleText.slice(0, 140).replace(/\s+/g, ' ').trim();
        logStep(`Subtitle request failed (${response.status}) for ${targetUrl}${preview ? `: ${preview}` : ''}.`);
        return undefined;
      }

      const trimmed = subtitleText.trim();
      if (!trimmed) {
        logStep(`Subtitle endpoint returned empty payload for ${url}.`);
        return undefined;
      }

      if (/^WEBVTT/i.test(trimmed)) {
        return toTextDataUrl(trimmed);
      }

      if (/\[Script Info\]|\[Events\]|^Dialogue:/im.test(trimmed)) {
        const converted = assToWebVtt(trimmed);
        if (converted) {
          logStep(`Converted ASS subtitles to WebVTT for ${targetUrl}.`);
          return toTextDataUrl(converted);
        }
      }

      logStep(`Subtitle payload format was not recognized as VTT/ASS for ${targetUrl}.`);
      return undefined;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logStep(`Subtitle fetch error for ${url}: ${detail}.`);
      return undefined;
    }
  }

  function normalizeSubtitleUrlForContent(rawUrl, metadata) {
    const url = String(rawUrl || '').trim();
    if (!url) return '';
    const isMovie = Boolean(metadata?.is_movie);
    const totalEpisodes = Number(metadata?.total_episodes || 0);
    if (isMovie || totalEpisodes === 1) {
      const forced = toEpisodeOneSubtitleUrl(url);
      return forced || url;
    }
    return url;
  }

  async function toSubtitleTracks(metadata, uri, videoBearerToken, logStep) {
    const subtitleNames = metadata && typeof metadata === 'object' && metadata.subtitles && typeof metadata.subtitles === 'object'
      ? metadata.subtitles
      : {};

    const subtitleUris = uri && typeof uri === 'object' && uri.subtitles && typeof uri.subtitles === 'object'
      ? uri.subtitles
      : {};

    const languages = new Set([...Object.keys(subtitleNames), ...Object.keys(subtitleUris)]);
    const tracks = [];

    const orderedLanguages = Array.from(languages).sort((left, right) => {
      const leftIsDefault = /^en-us$/i.test(left);
      const rightIsDefault = /^en-us$/i.test(right);
      return Number(rightIsDefault) - Number(leftIsDefault);
    });

    const preferredLanguage = orderedLanguages.find((language) => /^en-us$/i.test(language)) || orderedLanguages[0];
    if (!preferredLanguage) {
      return [];
    }

    for (const language of orderedLanguages) {
      if (language !== preferredLanguage) {
        continue;
      }
      const id = `animeonsen-sub-${language}`;
      const labelRaw = subtitleNames[language];
      const urlRaw = subtitleUris[language];
      const label = typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : language;
      const normalizedUrl = normalizeSubtitleUrlForContent(urlRaw, metadata);
      const isDefault = /^en-us$/i.test(language);
      const url = await fetchSubtitleTrackUrl(normalizedUrl, videoBearerToken, logStep);
      if (!url) {
        logStep(`Skipping subtitle track ${language} because secure fetch did not return a playable payload.`);
        continue;
      }
      tracks.push({
        id,
        language,
        label,
        url,
        isDefault,
      });
    }

    return tracks.sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
  }

  async function buildSourceOptionFromCandidate(resolveResult, scoreValue, rankOrder) {
    const content = resolveResult?.content || {};
    const videoPayload = resolveResult?.videoPayload || {};
    const contentId = String(content.contentId || '').trim();
    if (!contentId) return null;

    const metadata = videoPayload?.metadata && typeof videoPayload.metadata === 'object' ? videoPayload.metadata : {};
    const uri = videoPayload?.uri && typeof videoPayload.uri === 'object' ? videoPayload.uri : {};
    const streamUrl = typeof uri.stream === 'string' ? uri.stream.trim() : '';
    if (!streamUrl) return null;

    const subtitles = await toSubtitleTracks(metadata, uri, cache.videoBearerToken, logStep);
    const optionId = `animeonsen-${contentId}-ep-${episodeNumber}`;
    const scoreLabel = Number.isFinite(Number(scoreValue)) ? Number(scoreValue).toFixed(2) : '0.00';
    const titleLabel =
      String(metadata?.content_title_en || metadata?.content_title || content.title || contentId).trim() || contentId;

    return {
      id: optionId,
      type: 'direct',
      url: streamUrl,
      label: `AnimeOnsen ${titleLabel} (score ${scoreLabel})`,
      language: requestedAudioLanguage,
      server: 'animeonsen',
      controllable: true,
      subtitles,
      optionMeta: {
        provider: 'animeonsen',
        contentId,
        episodeNumber,
        subtitleSupport: Boolean(metadata?.subtitle_support),
        matchScore: Number(scoreLabel),
        matchRank: rankOrder,
      },
    };
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
  const title = String(item.title || '').trim();
  const titleEnglish = String(item.titleEnglish || '').trim();
  const titleJapanese = String(item.titleJapanese || '').trim();
  const queryText = titleEnglish || title || titleJapanese;
  const requestedAudioLanguage = toPreferredAudioLanguage(request?.preferences);

  if (!queryText) {
    return {
      noMatchReason: 'Missing title metadata for AnimeOnsen source resolution.',
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
    logStep(`AnimeOnsen rate-limit cooldown active. Wait ${waitSeconds}s.`);
    return {
      noMatchReason: `AnimeOnsen rate limit active. Retry after ${waitSeconds}s.`,
      steps,
    };
  }

  const queryKey = normalizeTitle(queryText);
  logStep(`Resolving AnimeOnsen source for ${queryText} episode ${episodeNumber}.`);
  logStep(`Requested audio preference: ${requestedAudioLanguage.toUpperCase()}.`);

  const isExactTitleMatch = (candidate) => {
    const candidateTitle = normalizeTitle(candidate?.title || '');
    if (!candidateTitle) return false;

    return Boolean(
      (title && candidateTitle === normalizeTitle(title)) ||
      (titleEnglish && candidateTitle === normalizeTitle(titleEnglish)) ||
      (titleJapanese && candidateTitle === normalizeTitle(titleJapanese)),
    );
  };

  const toCandidateSimilarity = (candidate) => {
    const candidateTitle = String(candidate?.title || '').trim();
    if (!candidateTitle) return 0;
    return Math.max(
      titleSimilarityScore(title, candidateTitle),
      titleSimilarityScore(titleEnglish, candidateTitle),
      titleSimilarityScore(titleJapanese, candidateTitle),
    );
  };

  const manualSelectionCandidates = [];
  let hasExactTitleCandidate = false;
  let maxExactTitleEpisodeCount = 0;

  const tryResolveCandidate = async (candidate, originLabel, scoreLabel) => {
    const contentId = String(candidate?.contentId || '').trim();
    if (!contentId) {
      return null;
    }

    if (isExactTitleMatch(candidate)) {
      hasExactTitleCandidate = true;
    }

    const scoreText = scoreLabel ? ` (${scoreLabel})` : '';
    logStep(`Validating candidate ${contentId}${scoreText} from ${originLabel}.`);

    const episodeKey = `${contentId}:${episodeNumber}`;
    let videoPayload = getCached(cache.byEpisode, episodeKey);
    if (!videoPayload) {
      const videoBearerToken = await refreshVideoBearerTokenFromWatchFlow(cache, contentId, episodeNumber, logStep, false);
      const videoUrl = `${VIDEO_ENDPOINT_BASE}/${encodeURIComponent(contentId)}/video/${encodeURIComponent(String(episodeNumber))}`;
      try {
        videoPayload = await fetchJsonWithRetries(
          videoUrl,
          {
            method: 'GET',
            headers: buildVideoHeaders(videoBearerToken),
          },
          2,
          logStep,
          cache,
        );
        setCached(cache.byEpisode, episodeKey, videoPayload);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (/401|403|unauthorized|forbidden/i.test(detail)) {
          const forcedToken = await refreshVideoBearerTokenFromWatchFlow(cache, contentId, episodeNumber, logStep, true);
          try {
            videoPayload = await fetchJsonWithRetries(
              videoUrl,
              {
                method: 'GET',
                headers: buildVideoHeaders(forcedToken),
              },
              1,
              logStep,
              cache,
            );
            setCached(cache.byEpisode, episodeKey, videoPayload);
          } catch (retryError) {
            const retryDetail = retryError instanceof Error ? retryError.message : String(retryError);
            logStep(`Skipped candidate ${contentId}${scoreText} (${originLabel}): video lookup failed after token refresh (${retryDetail}).`);
            return null;
          }
        } else {
        logStep(`Skipped candidate ${contentId}${scoreText} (${originLabel}): video lookup failed (${detail}).`);
        return null;
        }
      }
    } else {
      logStep(`AnimeOnsen cache hit for ${contentId} episode ${episodeNumber}${scoreText}.`);
    }

    const metadata = videoPayload?.metadata && typeof videoPayload.metadata === 'object' ? videoPayload.metadata : {};
    const uri = videoPayload?.uri && typeof videoPayload.uri === 'object' ? videoPayload.uri : {};
    const streamUrl = typeof uri.stream === 'string' ? uri.stream.trim() : '';
    if (!streamUrl) {
      logStep(`Skipped candidate ${contentId}${scoreText} (${originLabel}): missing stream URL.`);
      return null;
    }

    if (!isCandidateCompatibleWithRequest(metadata, kind, episodeNumber)) {
      const totalEpisodes = Number(metadata?.total_episodes || 0);
      const movieFlag = Boolean(metadata?.is_movie);
      if (isExactTitleMatch(candidate) && !movieFlag && totalEpisodes > 0) {
        maxExactTitleEpisodeCount = Math.max(maxExactTitleEpisodeCount, totalEpisodes);
      }
      logStep(
        `Skipped candidate ${contentId}${scoreText} (${originLabel}): incompatible metadata (is_movie=${movieFlag}, total_episodes=${totalEpisodes || 0}).`,
      );
      return null;
    }

    return {
      content: candidate,
      videoPayload,
    };
  };

  let resolvedCandidate = null;
  const cachedContent = getCached(cache.byQuery, queryKey);

  if (cachedContent) {
    const cachedSimilarity = toCandidateSimilarity(cachedContent);
    const cachedScoreLabel = `score=${cachedSimilarity.toFixed(2)}`;
    const cachedContentId = String(cachedContent?.contentId || '').trim() || 'unknown';
    logStep(`AnimeOnsen cache hit for search query: ${queryText}. Validating cached candidate (${cachedScoreLabel}).`);
    if (isExactTitleMatch(cachedContent)) {
      resolvedCandidate = await tryResolveCandidate(cachedContent, 'query-cache-exact', cachedScoreLabel);
      if (resolvedCandidate) {
        logStep(`Selected exact AnimeOnsen cache match: ${cachedContentId}.`);
      }
    } else {
      logStep(`Cached candidate ${cachedContentId} is not an exact title match. Preparing as manual option.`);
      if (cachedSimilarity > MIN_MANUAL_SELECTION_SIMILARITY) {
        const manualCached = await tryResolveCandidate(cachedContent, 'query-cache-manual', cachedScoreLabel);
        if (manualCached) {
          manualSelectionCandidates.push({
            ...manualCached,
            similarity: cachedSimilarity,
            rank: 0,
          });
        }
      } else {
        logStep(
          `Skipped cached non-exact candidate ${cachedContentId}: score ${cachedSimilarity.toFixed(2)} is below manual threshold ${MIN_MANUAL_SELECTION_SIMILARITY.toFixed(2)}.`,
        );
      }
    }
  }

  if (!resolvedCandidate) {
    let searchPayload;
    try {
      searchPayload = await fetchJsonWithRetries(
        SEARCH_ENDPOINT,
        {
          method: 'POST',
          headers: buildSearchHeaders(),
          body: JSON.stringify({
            q: queryText,
            attributesToHighlight: ['*'],
            highlightPreTag: '__ais-highlight__',
            highlightPostTag: '__/ais-highlight__',
            limit: 20,
          }),
        },
        3,
        logStep,
        cache,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        noMatchReason: `AnimeOnsen search failed: ${detail}.`,
        steps,
      };
    }

    const candidates = normalizeSearchHits(searchPayload);
    const rankedCandidates = buildRankedCandidates(candidates, title, titleEnglish, titleJapanese);
    if (!rankedCandidates.length) {
      return {
        noMatchReason: 'AnimeOnsen search returned no usable matches.',
        steps,
      };
    }

    const seen = new Set();
    const dedupedRankedCandidates = rankedCandidates.filter((candidate) => {
      const key = String(candidate.contentId || '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const maxCandidatesToProbe = dedupedRankedCandidates.length;
    for (let index = 0; index < maxCandidatesToProbe; index += 1) {
      if (manualSelectionCandidates.length >= MAX_MANUAL_SELECTION_OPTIONS) {
        break;
      }

      const candidate = dedupedRankedCandidates[index];
      const similarity = Number(candidate._matchSimilarity || 0);
      const scoreLabel = candidate._matchExact
        ? `exact, score=${similarity.toFixed(2)}`
        : `score=${similarity.toFixed(2)}`;
      const sourceLabel = candidate._matchExact
        ? `search-rank-${index + 1}/exact`
        : `search-rank-${index + 1}/score-${similarity.toFixed(2)}`;

      if (index === 0) {
        if (candidate._matchExact) {
          hasExactTitleCandidate = true;
          logStep(`Top AnimeOnsen candidate is an exact title match: ${candidate.contentId}.`);
        } else {
          logStep(`Top AnimeOnsen candidate score=${similarity.toFixed(2)}: ${candidate.contentId}.`);
        }
      }

      if (candidate._matchExact) {
        const attempt = await tryResolveCandidate(candidate, sourceLabel, scoreLabel);
        if (attempt) {
          resolvedCandidate = attempt;
          logStep(`Selected exact AnimeOnsen match after validation: ${candidate.contentId}.`);
          break;
        }
      } else if (similarity > MIN_MANUAL_SELECTION_SIMILARITY) {
        const manualAttempt = await tryResolveCandidate(
          candidate,
          `manual-rank-${index + 1}`,
          `manual, score=${similarity.toFixed(2)}`,
        );
        if (manualAttempt) {
          manualSelectionCandidates.push({
            ...manualAttempt,
            similarity,
            rank: index + 1,
          });
          logStep(
            `Prepared candidate ${candidate.contentId} as manual selection option (score=${similarity.toFixed(2)}).`,
          );
        }
      }
    }
  }

  if (!resolvedCandidate) {
    if (hasExactTitleCandidate && kind !== 'movie' && maxExactTitleEpisodeCount > 0 && episodeNumber > maxExactTitleEpisodeCount) {
      logStep(
        `Exact title match exists but episode ${episodeNumber} exceeds available AnimeOnsen episodes (${maxExactTitleEpisodeCount}).`,
      );
      return {
        noMatchReason: `Exact AnimeOnsen title was found, but episode ${episodeNumber} is not released yet (latest available is ${maxExactTitleEpisodeCount}).`,
        steps,
      };
    }

    if (hasExactTitleCandidate) {
      logStep('Exact AnimeOnsen title match exists, but no compatible source was found for this request.');
      return {
        noMatchReason: 'Exact AnimeOnsen title match exists, but no compatible source is available for this request.',
        steps,
      };
    }

    if (manualSelectionCandidates.length > 0) {
      const sourceOptions = [];
      const seenManualContentIds = new Set();
      for (let index = 0; index < manualSelectionCandidates.length; index += 1) {
        const entry = manualSelectionCandidates[index];
        const contentId = String(entry?.content?.contentId || '').trim();
        if (!contentId || seenManualContentIds.has(contentId)) {
          continue;
        }
        seenManualContentIds.add(contentId);
        const option = await buildSourceOptionFromCandidate(entry, entry.similarity, entry.rank || index + 1);
        if (option) {
          sourceOptions.push(option);
        }
      }

      if (sourceOptions.length > 0) {
        logStep(`No exact AnimeOnsen title match found. Prepared ${sourceOptions.length} selectable candidate(s).`);

        return {
          selectedOptionId: sourceOptions[0].id,
          sources: sourceOptions,
          message:
            'No exact AnimeOnsen title match was found. Please choose the correct entry from the Server selector.',
          steps,
        };
      }
    }

    return {
      noMatchReason: 'AnimeOnsen did not return an exact title match for this selected anime.',
      steps,
    };
  }

  const content = resolvedCandidate.content;
  const contentId = String(content.contentId || '').trim();

  setCached(cache.byQuery, queryKey, content);

  if (!contentId) {
    return {
      noMatchReason: 'AnimeOnsen match did not include a content id.',
      steps,
    };
  }

  const resolvedSimilarity = toCandidateSimilarity(resolvedCandidate.content);
  const selectedOption = await buildSourceOptionFromCandidate(resolvedCandidate, resolvedSimilarity, 1);
  if (!selectedOption) {
    return {
      noMatchReason: `AnimeOnsen did not provide a stream URL for ${contentId} episode ${episodeNumber}.`,
      steps,
    };
  }

  return {
    selectedOptionId: selectedOption.id,
    sources: [
      selectedOption,
    ],
    message: `Resolved AnimeOnsen source for ${contentId} episode ${episodeNumber}.`,
    steps,
  };
}

    const ANIMEONSEN_RESOLVER_CODE = resolveAnimeonsenSource.toString();

    const ANIMEONSEN_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 990.2 102.4" fill="currentColor">
    <path d="M125.64,565.89h-16V543h76.8V645.25H163.53V628H133.06l-4.61,17.28H104.9Zm37.89,39.17V565.89H149.19L139,605.06Z" transform="translate(-104.9 -542.85)"></path>
    <path d="M229.83,542.85v12.29l35.33,20.09V542.85h22.91v102.4H265.16V603.14L229.83,583v62.21H206.92V542.85Z" transform="translate(-104.9 -542.85)"></path>
    <path d="M331.59,542.85v23h-23v-23Zm0,36.22v66.18h-23V579.07Z" transform="translate(-104.9 -542.85)"></path>
    <path d="M352.07,645.25V542.85h50.17l9.35,11.39L420.16,543H469.7V645.25H446.92V567.68H428.87l-6.27,6.66v70.91H399.68V574.34l-6.52-6.66H375v77.57Z" transform="translate(-104.9 -542.85)"></path>
    <path d="M490.18,645.25V543h85.76l-10.63,63.74H513.09v15.74h57.34v22.79Zm22.91-61.44h32L548,565.89H513.09Z" transform="translate(-104.9 -542.85)"></path>
    <path d="M596.42,645.12V542.85h87v102.4Zm64.12-22.78V565.76H619.33v56.58Z" transform="translate(-104.9 -542.85)"></path>
    <path d="M726.85,542.85v12.29l35.33,20.09V542.85h22.91v102.4H762.18V603.14L726.85,583v62.21H703.94V542.85Z" transform="translate(-104.9 -542.85)"></path>
    <path d="M887.23,645.25H805.57V622.46h59v-17.4h-59V542.85h81.66v22.91H828.48v16.77h58.75Z" transform="translate(-104.9 -542.85)"></path>
    <path d="M907.71,645.25V543h85.76l-10.62,63.74H930.62v15.74H988v22.79Zm22.91-61.44h32l3-17.92h-35Z" transform="translate(-104.9 -542.85)"></path>
    <path d="M1036.86,542.85v12.29l35.33,20.09V542.85h22.91v102.4h-22.91V603.14L1036.86,583v62.21H1014V542.85Z" transform="translate(-104.9 -542.85)"></path>
    </svg>`;
    const ANIMEONSEN_LOGO_SVG_BASE64 = Buffer.from(ANIMEONSEN_LOGO_SVG, 'utf8').toString('base64');

    export const animeonsenPluginArtifact = {
      schemaVersion: 2,
      compatibilityApiVersion: '1.0',
      plugin: {
        id: 'animeonsen-source',
        name: 'AnimeOnsen Source',
        version: '1.0.14',
        compatibilityApiVersion: '1.0',
        iconSvg: {
          mimeType: 'image/svg+xml',
          dataBase64: ANIMEONSEN_LOGO_SVG_BASE64,
          width: 990,
          height: 102,
        },
        hostRequirements: {
          connectSrcOrigins: [
            'https://search.animeonsen.xyz',
            'https://api.animeonsen.xyz',
            'https://cdn.animeonsen.xyz',
            'https://www.animeonsen.xyz',
          ],
          frameSrcOrigins: ['https://www.animeonsen.xyz', 'https://cdn.animeonsen.xyz'],
          httpAllowlist: [
            'https://search.animeonsen.xyz/*',
            'https://api.animeonsen.xyz/*',
            'https://cdn.animeonsen.xyz/*',
            'https://www.animeonsen.xyz/*',
          ],
        },
        resolver: {
          kind: 'inline-js',
          code: ANIMEONSEN_RESOLVER_CODE,
          timeoutMs: 25000,
        },
      },
    };
