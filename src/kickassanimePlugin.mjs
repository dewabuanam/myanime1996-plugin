export async function resolveKickAssAnimeSource(request, api) {
  const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

  function normalizeTitle(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toSlug(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getGlobalCache() {
    const root = typeof globalThis === 'object' && globalThis ? globalThis : {};
    if (!root.__myanime1996KAAResolveCache) {
      root.__myanime1996KAAResolveCache = {
        createdAt: Date.now(),
        byQuery: {},
        byAnime: {},
      };
    } else {
      const current = root.__myanime1996KAAResolveCache;
      if (!current.byQuery || typeof current.byQuery !== 'object') {
        current.byQuery = {};
      }
      if (!current.byAnime || typeof current.byAnime !== 'object') {
        current.byAnime = {};
      }
    }
    return root.__myanime1996KAAResolveCache;
  }

  function getCachedEntry(cache, queryKey) {
    const hit = cache.byQuery?.[queryKey];
    if (!hit) return null;
    if (Date.now() - Number(hit.cachedAt || 0) > CACHE_TTL_MS) {
      delete cache.byQuery[queryKey];
      return null;
    }
    return hit;
  }

  function setCachedEntry(cache, queryKey, entry) {
    cache.byQuery[queryKey] = {
      ...entry,
      cachedAt: Date.now(),
    };
  }

  function removeCachedEntry(cache, queryKey) {
    if (!queryKey) return;
    if (!cache.byQuery || typeof cache.byQuery !== 'object') return;
    delete cache.byQuery[queryKey];
  }

  function titlesLookRelated(left, right) {
    const a = normalizeTitle(left);
    const b = normalizeTitle(right);
    if (!a || !b) return true;
    return a === b || a.includes(b) || b.includes(a);
  }

  function tokenizeTitle(value) {
    const stop = new Set(['the', 'of', 'and', 'a', 'an', 'season', 'part', 'movie', 'tv']);
    return normalizeTitle(value)
      .split(' ')
      .map((part) => part.trim())
      .filter((part) => part.length >= 2 && !stop.has(part));
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

  function getAnimeCacheEntry(cache, animeSlug) {
    if (!animeSlug) return null;
    const hit = cache.byAnime?.[animeSlug];
    if (!hit) return null;
    if (Date.now() - Number(hit.cachedAt || 0) > CACHE_TTL_MS) {
      delete cache.byAnime[animeSlug];
      return null;
    }
    return hit;
  }

  function setAnimeCacheEntry(cache, animeSlug, entry) {
    if (!animeSlug) return;
    cache.byAnime[animeSlug] = {
      ...(cache.byAnime?.[animeSlug] || {}),
      ...entry,
      cachedAt: Date.now(),
    };
  }

  function getCachedEpisodeSlug(cache, animeSlug, episodeNumber) {
    const anime = getAnimeCacheEntry(cache, animeSlug);
    if (!anime) return '';
    const key = String(Math.max(1, Number(episodeNumber || 1)));
    const byEpisode = anime.byEpisode && typeof anime.byEpisode === 'object' ? anime.byEpisode : {};
    const value = byEpisode[key];
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  function setCachedEpisodeSlug(cache, animeSlug, episodeNumber, episodeSlug) {
    if (!animeSlug || !episodeSlug) return;
    const key = String(Math.max(1, Number(episodeNumber || 1)));
    const existing = getAnimeCacheEntry(cache, animeSlug) || {};
    const byEpisode = existing.byEpisode && typeof existing.byEpisode === 'object' ? existing.byEpisode : {};
    setAnimeCacheEntry(cache, animeSlug, {
      byEpisode: {
        ...byEpisode,
        [key]: episodeSlug,
      },
    });
  }

  function toPreferredAudioLanguage(preferences) {
    return preferences?.audioLanguage === 'dub' ? 'dub' : 'sub';
  }

  function toEpisodesLangParam(audioLanguage) {
    return audioLanguage === 'dub' ? 'en-US' : 'ja-JP';
  }

  function buildEpisodesUrl(animeSlug, audioLanguage, episodeNumber) {
    const encodedSlug = encodeURIComponent(String(animeSlug || '').trim());
    const langParam = toEpisodesLangParam(audioLanguage);
    const hasEpisode = Number.isFinite(Number(episodeNumber)) && Number(episodeNumber) > 0;
    const epParam = hasEpisode ? `&ep=${encodeURIComponent(String(Math.max(1, Number(episodeNumber))))}` : '';
    return `https://kaa.lt/api/show/${encodedSlug}/episodes?lang=${encodeURIComponent(langParam)}${epParam}`;
  }

  function buildSearchReferer(query) {
    return `https://kaa.lt/search?q=${encodeURIComponent(String(query || '').trim())}`;
  }

  function appendHeaderSafe(headers, name, value) {
    try {
      headers.append(name, value);
    } catch {
      // Some browser environments block unsafe headers (sec-*, user-agent, etc.).
    }
  }

  function buildSearchHeaders(query) {
    const headers = new Headers();
    appendHeaderSafe(headers, 'accept', 'application/json, text/plain, */*');
    appendHeaderSafe(headers, 'accept-language', 'en-US,en;q=0.9,id;q=0.8');
    appendHeaderSafe(headers, 'content-type', 'application/json');
    appendHeaderSafe(headers, 'origin', 'https://kaa.lt');
    appendHeaderSafe(headers, 'priority', 'u=1, i');
    appendHeaderSafe(headers, 'referer', buildSearchReferer(query));
    appendHeaderSafe(headers, 'sec-ch-ua', '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"');
    appendHeaderSafe(headers, 'sec-ch-ua-mobile', '?0');
    appendHeaderSafe(headers, 'sec-ch-ua-platform', '"Windows"');
    appendHeaderSafe(headers, 'sec-fetch-dest', 'empty');
    appendHeaderSafe(headers, 'sec-fetch-mode', 'cors');
    appendHeaderSafe(headers, 'sec-fetch-site', 'same-origin');
    appendHeaderSafe(
      headers,
      'user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    );
    appendHeaderSafe(headers, 'x-origin', 'kaa.lt');
    return headers;
  }

  function parseJsonSafe(text) {
    try {
      return JSON.parse(String(text || ''));
    } catch {
      return null;
    }
  }

  function uniqueByKey(items, keyFn) {
    const out = [];
    const seen = new Set();
    for (const item of items) {
      const key = keyFn(item);
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function collectArrays(value, depth = 0) {
    if (depth > 4 || value == null) return [];
    if (Array.isArray(value)) return [value];
    if (typeof value !== 'object') return [];

    const arrays = [];
    for (const entry of Object.values(value)) {
      arrays.push(...collectArrays(entry, depth + 1));
    }
    return arrays;
  }

  function toObjectArray(value) {
    const arrays = collectArrays(value);
    const objects = [];
    for (const arr of arrays) {
      for (const item of arr) {
        if (item && typeof item === 'object') objects.push(item);
      }
    }
    return objects;
  }

  function getStringField(obj, keys) {
    for (const key of keys) {
      const value = obj?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  function getNestedStringField(obj, paths) {
    for (const path of paths) {
      let current = obj;
      let ok = true;
      for (const part of path) {
        if (!current || typeof current !== 'object' || !(part in current)) {
          ok = false;
          break;
        }
        current = current[part];
      }
      if (ok && typeof current === 'string' && current.trim()) {
        return current.trim();
      }
    }
    return '';
  }

  function extractCandidate(item) {
    const title =
      getStringField(item, ['title', 'name', 'en_title', 'english_title', 'romaji', 'anime_title']) ||
      getNestedStringField(item, [
        ['title', 'en'],
        ['title', 'english'],
        ['title', 'romaji'],
        ['titles', 'en'],
        ['titles', 'romaji'],
      ]);

    const slug =
      getStringField(item, ['slug', 'anime_slug']) ||
      (() => {
        const urlLike = getStringField(item, ['url', 'link', 'href']);
        if (!urlLike) return '';
        try {
          const parsed = new URL(urlLike, 'https://kaa.lt');
          const chunks = parsed.pathname.split('/').filter(Boolean);
          const animeIndex = chunks.indexOf('anime');
          if (animeIndex >= 0 && chunks[animeIndex + 1]) return chunks[animeIndex + 1];
          return chunks[chunks.length - 1] || '';
        } catch {
          return '';
        }
      })();

    const id = getStringField(item, ['id', 'anime_id', '_id']);

    const normalizedTitle = normalizeTitle(title);
    const normalizedSlug = toSlug(slug || title);

    if (!normalizedSlug) return null;

    return {
      title: title || normalizedSlug,
      normalizedTitle,
      slug: normalizedSlug,
      id,
    };
  }

  async function resolveAnimeByTitle(api, searchTitle, normalizedTitle, logStep) {
    const MIN_SIMILARITY = 0.5;

    try {
      const searchResponse = await api.fetch('https://kaa.lt/api/search', {
        method: 'POST',
        headers: buildSearchHeaders(searchTitle),
        body: JSON.stringify({ query: searchTitle }),
        redirect: 'follow',
        signal: api.signal,
      });

      if (!searchResponse.ok) {
        logStep(`KAA /api/search failed: HTTP ${searchResponse.status}.`);
        return null;
      }

      const parsedSearch = parseJsonSafe(await searchResponse.text());
      const searchCandidates = uniqueByKey(
        toObjectArray(parsedSearch)
          .map(extractCandidate)
          .filter(Boolean),
        (entry) => entry.slug,
      );

      const exactSearch = searchCandidates.find((entry) => entry.normalizedTitle === normalizedTitle);
      if (exactSearch) {
        logStep(`Selected exact KAA /api/search match: ${exactSearch.slug}.`);
        return exactSearch;
      }

      let bestSearchCandidate = null;
      let bestSearchScore = 0;
      for (const candidate of searchCandidates) {
        const score = titleSimilarityScore(normalizedTitle, candidate.normalizedTitle);
        if (score > bestSearchScore) {
          bestSearchScore = score;
          bestSearchCandidate = candidate;
        }
      }

      if (bestSearchCandidate && bestSearchScore >= MIN_SIMILARITY) {
        logStep(
          `Selected approximate KAA /api/search match (score=${bestSearchScore.toFixed(2)}): ${bestSearchCandidate.slug}.`,
        );
        return bestSearchCandidate;
      }

      if (bestSearchCandidate) {
        logStep(
          `Rejected weak KAA /api/search match (score=${bestSearchScore.toFixed(2)}): ${bestSearchCandidate.slug}.`,
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logStep(`KAA /api/search failed: ${detail}.`);
      logStep('Likely browser CORS/preflight rejection: KAA OPTIONS preflight can return 404 while direct POST works in Postman.');
    }

    return null;
  }

  function makeSources(slug, episodeNumber, episodeSlug, audioLanguage) {
    const episode = Math.max(1, Number(episodeNumber || 1));
    const encodedEpisodeSlug = encodeURIComponent(String(episodeSlug || '').trim());
    if (!encodedEpisodeSlug) return [];
    const episodeById = `https://kaa.lt/${slug}/ep-${episode}-${encodedEpisodeSlug}`;

    return [
      {
        id: `${slug}-ep-${episode}-id`,
        type: 'embed',
        url: episodeById,
        label: `KickAssAnime Episode ${episode}`,
        language: audioLanguage === 'dub' ? 'dub' : 'sub',
        controllable: false,
      },
    ];
  }

  async function resolveEpisodeSlug(api, animeSlug, episodeNumber, audioLanguage, logStep) {
    async function fetchEpisodeItems(endpoint) {
      let response;
      try {
        response = await api.fetch(endpoint, {
          method: 'GET',
          headers: {
            accept: 'application/json, text/plain, */*',
          },
          signal: api.signal,
        });
      } catch (error) {
        logStep(`KAA episodes fetch failed: ${error instanceof Error ? error.message : String(error)}.`);
        return null;
      }

      if (!response.ok) {
        const preview = (await response.text()).slice(0, 120).replace(/\s+/g, ' ').trim();
        logStep(`KAA episodes failed: HTTP ${response.status}${preview ? ` ${preview}` : ''}.`);
        return null;
      }

      const parsed = parseJsonSafe(await response.text());
      if (!parsed || typeof parsed !== 'object') {
        logStep('KAA episodes returned non-JSON payload.');
        return null;
      }

      return Array.isArray(parsed?.result) ? parsed.result : [];
    }

    const wantedEpisode = Math.max(1, Number(episodeNumber || 1));
    const endpoint = buildEpisodesUrl(animeSlug, audioLanguage);
    const endpointLang = toEpisodesLangParam(audioLanguage);
    logStep(`Using KAA episodes language: ${audioLanguage.toUpperCase()} -> ${endpointLang}.`);
    logStep(`Fetching KAA episodes for slug ${animeSlug}: ${endpoint}.`);

    let episodeItems = await fetchEpisodeItems(endpoint);
    if (!episodeItems) return '';
    logStep(`KAA episodes count=${episodeItems.length}.`);

    if (episodeItems.length < wantedEpisode) {
      const fallbackEndpoint = buildEpisodesUrl(animeSlug, audioLanguage, wantedEpisode);
      logStep(
        `KAA episodes count (${episodeItems.length}) is below requested episode ${wantedEpisode}; retrying with ep parameter: ${fallbackEndpoint}.`,
      );
      const fallbackItems = await fetchEpisodeItems(fallbackEndpoint);
      if (fallbackItems) {
        episodeItems = fallbackItems;
        logStep(`KAA episodes count with ep=${wantedEpisode}: ${episodeItems.length}.`);
      }
    }

    const hit = episodeItems.find((item) => {
      const asNumber = Number(item?.episode_number);
      if (Number.isFinite(asNumber) && asNumber === wantedEpisode) return true;

      const asString = String(item?.episode_string || '').trim();
      if (!asString) return false;
      const normalized = Number(asString.replace(/^0+/, '') || '0');
      return Number.isFinite(normalized) && normalized === wantedEpisode;
    });

    const slug = String(hit?.slug || '').trim();
    if (!slug) {
      logStep(`No KAA episode slug found for episode ${wantedEpisode}.`);
      return '';
    }

    logStep(`Resolved KAA episode slug=${slug} for episode ${wantedEpisode}.`);
    return slug;
  }

  function pickSourceOption(options, preferences) {
    if (!Array.isArray(options) || options.length === 0) return null;

    const requestedLanguage =
      preferences?.audioLanguage === 'dub' ? 'dub' : preferences?.audioLanguage === 'sub' ? 'sub' : undefined;

    if (requestedLanguage) {
      const byLanguage = options.find((option) => option.language === requestedLanguage);
      if (byLanguage) return byLanguage;
    }

    return options[0] || null;
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
      // Keep resolver robust even if host runtime rejects log forwarding.
    }
  };

  const episodeNumber = Number(request?.item?.episodeNumber || 1) || 1;
  const searchTitle = String(request?.item?.title || '').trim();
  const itemKind = String(request?.item?.kind || '').toLowerCase();
  const requestedAudioLanguage = toPreferredAudioLanguage(request?.preferences);

  if (!searchTitle) {
    return {
      noMatchReason: 'Missing title metadata for KickAssAnime source resolution.',
      steps,
    };
  }

  if (!['episode', 'movie', 'ova', 'ona', 'special'].includes(itemKind)) {
    return {
      noMatchReason: `Unsupported media kind: ${itemKind || 'unknown'}.`,
      steps,
    };
  }

  const normalizedTitle = normalizeTitle(searchTitle);
  logStep(`Resolving KickAssAnime source for episode ${episodeNumber}.`);
  logStep(`Searching KAA using title only: ${searchTitle}.`);
  logStep('Using KAA search endpoint: https://kaa.lt/api/search.');

  const cache = getGlobalCache();
  const queryKey = normalizedTitle;
  let cached = getCachedEntry(cache, queryKey);
  if (cached?.slug && cached?.title && !titlesLookRelated(cached.title, searchTitle)) {
    removeCachedEntry(cache, queryKey);
    logStep(`Ignored stale cache entry for query: ${searchTitle}.`);
    cached = null;
  }
  let selectedSlug = cached?.slug || '';
  let usedQueryCache = Boolean(cached?.slug);

  if (selectedSlug) {
    logStep(`Cache hit for query: ${searchTitle}.`);
  } else {
    try {
      const matched = await resolveAnimeByTitle(api, searchTitle, normalizedTitle, logStep);
      if (!matched) {
        return {
          noMatchReason: 'KickAssAnime source could not be resolved from KAA catalog pages.',
          steps,
        };
      }

      selectedSlug = matched.slug;
      setCachedEntry(cache, queryKey, { slug: selectedSlug, id: matched.id, title: matched.title });
      setAnimeCacheEntry(cache, selectedSlug, { id: matched.id, title: matched.title });
      logStep(`Selected KAA anime slug=${selectedSlug} (${matched.title}).`);
    } catch (error) {
      logStep(`KAA search failed: ${error instanceof Error ? error.message : String(error)}.`);
      return {
        noMatchReason: 'KickAssAnime source search failed.',
        steps,
      };
    }
  }

  if (!selectedSlug) {
    return {
      noMatchReason: 'KickAssAnime source could not be resolved from catalog search.',
      steps,
    };
  }

  let episodeSlug = getCachedEpisodeSlug(cache, selectedSlug, episodeNumber);
  if (episodeSlug) {
    logStep(`Episode cache hit for ${selectedSlug} ep ${episodeNumber}: ${episodeSlug}.`);
  } else {
    logStep(`Episode cache miss for ${selectedSlug} ep ${episodeNumber}.`);
    episodeSlug = await resolveEpisodeSlug(api, selectedSlug, episodeNumber, requestedAudioLanguage, logStep);
    if (episodeSlug) {
      setCachedEpisodeSlug(cache, selectedSlug, episodeNumber, episodeSlug);
    } else if (usedQueryCache) {
      logStep('Episode slug not found for cached anime slug. Re-running title search for cache recovery.');
      removeCachedEntry(cache, queryKey);
      usedQueryCache = false;
      const rematched = await resolveAnimeByTitle(api, searchTitle, normalizedTitle, logStep);
      if (rematched && rematched.slug && rematched.slug !== selectedSlug) {
        selectedSlug = rematched.slug;
        setCachedEntry(cache, queryKey, { slug: selectedSlug, id: rematched.id, title: rematched.title });
        setAnimeCacheEntry(cache, selectedSlug, { id: rematched.id, title: rematched.title });
        logStep(`Recovered KAA anime slug=${selectedSlug} (${rematched.title}).`);
        episodeSlug = await resolveEpisodeSlug(api, selectedSlug, episodeNumber, requestedAudioLanguage, logStep);
        if (episodeSlug) {
          setCachedEpisodeSlug(cache, selectedSlug, episodeNumber, episodeSlug);
        }
      }
    }
  }

  if (!episodeSlug) {
    return {
      noMatchReason: `KickAssAnime episode slug not found for ${selectedSlug} episode ${episodeNumber}.`,
      steps,
    };
  }

  const sources = makeSources(selectedSlug, episodeNumber, episodeSlug, requestedAudioLanguage);
  if (!sources.length) {
    return {
      noMatchReason: `KickAssAnime source URL could not be generated for ${selectedSlug} episode ${episodeNumber}.`,
      steps,
    };
  }
  const selected = pickSourceOption(sources, request?.preferences);
  logStep('Generated KAA episode URL from anime slug and episode slug.');
  if (selected) {
    logStep(`Selected option: ${selected.label}.`);
  }

  return {
    selectedOptionId: selected?.id,
    sources,
    message: 'Resolved KickAssAnime watch options from direct KAA search.',
    steps,
  };
}

const KICKASSANIME_RESOLVER_CODE = resolveKickAssAnimeSource.toString();
const KICKASSANIME_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAh0AAACqCAYAAAAJMP0DAAAACXBIWXMAAAsTAAALEwEAmpwYAAAE7mlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNy4xLWMwMDAgNzkuOWNjYzRkZSwgMjAyMi8wMy8xNC0xMToyNjoxOSAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczpkYz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iIHhtbG5zOnBob3Rvc2hvcD0iaHR0cDovL25zLmFkb2JlLmNvbS9waG90b3Nob3AvMS4wLyIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0RXZ0PSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VFdmVudCMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIDIzLjMgKFdpbmRvd3MpIiB4bXA6Q3JlYXRlRGF0ZT0iMjAyMy0wMi0xN1QxOToyNzoyMyswNTozMCIgeG1wOk1vZGlmeURhdGU9IjIwMjMtMDItMTdUMTk6Mjk6MjkrMDU6MzAiIHhtcDpNZXRhZGF0YURhdGU9IjIwMjMtMDItMTdUMTk6Mjk6MjkrMDU6MzAiIGRjOmZvcm1hdD0iaW1hZ2UvcG5nIiBwaG90b3Nob3A6Q29sb3JNb2RlPSIzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjUyNjYzNzY1LTYxMTQtNGU0NC1hYzM3LTQ3MWI0NGYyZTJiNyIgeG1wTU06RG9jdW1lbnRJRD0i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';

export const kickAssAnimePluginArtifact = {
  schemaVersion: 2,
  compatibilityApiVersion: '1.0',
  plugin: {
    id: 'kickassanime-source',
    name: 'KickAssAnime Source',
    version: '1.0.0',
    compatibilityApiVersion: '1.0',
    iconPng: {
      mimeType: 'image/png',
      dataBase64: KICKASSANIME_ICON_BASE64,
      width: 541,
      height: 170,
    },
    hostRequirements: {
      connectSrcOrigins: ['https://kaa.lt'],
      frameSrcOrigins: ['https://kaa.lt'],
      httpAllowlist: ['https://kaa.lt/*'],
    },
    resolver: {
      kind: 'inline-js',
      code: KICKASSANIME_RESOLVER_CODE,
      timeoutMs: 25000,
    },
  },
};
