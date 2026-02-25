// ==UserScript==
// @name         Anime1.me Enhancer
// @namespace    https://github.com/zjjscwt/tampermonkey-script
// @version      1.1.0
// @description  為 Anime1.me 打造現代化UI：首頁卡片式封面展示（TMDB）+ 播放頁單播放器選集模式
// @author       Antigravity
// @match        https://anime1.me/*
// @match        https://anime1.in/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.themoviedb.org
// @connect      image.tmdb.org
// @connect      anime1.me
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ===================== CONFIG =====================
    const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days
    const TMDB_API_APPLY_URL = 'https://www.themoviedb.org/settings/api';
    const TMDB_API_STORAGE_KEY = 'tmdb_api_key';
    const TMDB_API_HINT_SHOWN_KEY = 'tmdb_api_hint_shown_v1';
    let TMDB_API_KEY = getStoredTmdbApiKey();
    const TMDB_API_URL = 'https://api.themoviedb.org/3';
    const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
    const TMDB_IMAGE_ORIGINAL_BASE = 'https://image.tmdb.org/t/p/original';
    const API_RATE_INTERVAL = 300; // ms between requests

    function getStoredTmdbApiKey() {
        try {
            return (GM_getValue(TMDB_API_STORAGE_KEY, '') || '').trim();
        } catch {
            return '';
        }
    }

    function setStoredTmdbApiKey(key) {
        TMDB_API_KEY = (key || '').trim();
        try { GM_setValue(TMDB_API_STORAGE_KEY, TMDB_API_KEY); } catch { /* ignore */ }
    }

    function maybeShowApiSetupHint() {
        if (TMDB_API_KEY) return;
        let shown = false;
        try { shown = !!GM_getValue(TMDB_API_HINT_SHOWN_KEY, false); } catch { /* ignore */ }
        if (shown) return;

        alert(
            '尚未設定 TMDB API Key。\n' +
            '請點擊右上角主題切換按鈕旁的「設定」圖示來輸入 API。\n' +
            'TMDB 申請入口：' + TMDB_API_APPLY_URL
        );
        try { GM_setValue(TMDB_API_HINT_SHOWN_KEY, true); } catch { /* ignore */ }
    }

    function openTmdbApiSettingsDialog() {
        const current = getStoredTmdbApiKey();
        const input = prompt(
            '請輸入/修改 TMDB API Key（留空可清除）\n申請入口：' + TMDB_API_APPLY_URL,
            current
        );
        if (input === null) return;
        const next = input.trim();

        if (!next && current) {
            const ok = confirm('確定要清除目前的 TMDB API Key 嗎？');
            if (!ok) return;
        }

        setStoredTmdbApiKey(next);
        alert(next ? 'TMDB API Key 已更新，頁面將重新整理。' : 'TMDB API Key 已清除，頁面將重新整理。');
        location.reload();
    }

    // ===================== FONT =====================
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;600;700&display=swap';
    document.head.appendChild(fontLink);

    // ===================== UTILITIES =====================
    function injectCSS(css) {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function isDarkModeActive() {
        const darkCss = document.getElementById('darkmode-css');
        return !!(darkCss && !darkCss.disabled);
    }

    function syncThemeClass() {
        const root = document.documentElement;
        const dark = isDarkModeActive();
        root.classList.toggle('ae-dark', dark);
        root.classList.toggle('ae-light', !dark);
    }

    function initThemeSync() {
        syncThemeClass();

        const mo = new MutationObserver(() => {
            syncThemeClass();
        });
        mo.observe(document.head || document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['id', 'disabled', 'media', 'rel', 'href']
        });

        // Theme buttons toggle state via page scripts; re-sync right after interaction.
        document.addEventListener('click', (e) => {
            const btn = e.target && e.target.closest
                ? e.target.closest('#darkmodebtn, #lightmodebtn')
                : null;
            if (btn) {
                setTimeout(syncThemeClass, 0);
                setTimeout(syncThemeClass, 120);
            }
        }, true);
    }

    function mountThemeControlToHeader() {
        const control = document.querySelector('.darkmode-control');
        const headerHost = document.querySelector('#masthead .header-content') || document.querySelector('#masthead');
        if (!control || !headerHost) return;
        if (control.parentElement !== headerHost) {
            headerHost.appendChild(control);
        }
        ensureApiSettingsButton(control);
    }

    function ensureApiSettingsButton(controlRoot) {
        if (!controlRoot || controlRoot.querySelector('#ae-tmdb-settings-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'ae-tmdb-settings-btn';
        btn.className = 'darkmodebtns';
        btn.type = 'button';
        btn.title = 'TMDB API 設定';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" class="inline-svg" aria-hidden="true">
                <path fill="currentColor" d="M19.14 12.94a7.43 7.43 0 0 0 .05-.94 7.43 7.43 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.27 7.27 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58a7.43 7.43 0 0 0-.05.94 7.43 7.43 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z"></path>
            </svg>
            <span>TMDB 設定</span>
        `;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openTmdbApiSettingsDialog();
        });

        controlRoot.appendChild(btn);
    }

    function getCacheKey(name) {
        return 'tmdb_v4_' + name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 80);
    }

    function getCachedData(name) {
        try {
            const raw = GM_getValue(getCacheKey(name), null);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (Date.now() - data.timestamp > CACHE_EXPIRY) return null;
            return data.value;
        } catch { return null; }
    }

    function setCachedData(name, value) {
        try {
            GM_setValue(getCacheKey(name), JSON.stringify({ timestamp: Date.now(), value }));
        } catch { /* quota exceeded, ignore */ }
    }

    // TMDB request queue for rate limiting
    let apiQueue = [];
    let apiProcessing = false;

    function processApiQueue() {
        if (apiProcessing || apiQueue.length === 0) return;
        apiProcessing = true;
        const { url, resolve } = apiQueue.shift();

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            headers: { 'Accept': 'application/json' },
            onload(res) {
                try {
                    const data = JSON.parse(res.responseText);
                    resolve(data);
                } catch { resolve(null); }
                setTimeout(() => { apiProcessing = false; processApiQueue(); }, API_RATE_INTERVAL);
            },
            onerror() {
                resolve(null);
                setTimeout(() => { apiProcessing = false; processApiQueue(); }, API_RATE_INTERVAL);
            }
        });
    }

    function tmdbRequest(endpoint, params = {}) {
        return new Promise(resolve => {
            if (!TMDB_API_KEY) {
                console.warn('[Anime1 Enhancer] 尚未設定 TMDB API Key');
                resolve(null);
                return;
            }
            const queryParams = new URLSearchParams({
                api_key: TMDB_API_KEY,
                language: 'zh-TW',
                include_adult: 'true',
                ...params
            });
            const url = `${TMDB_API_URL}${endpoint}?${queryParams.toString()}`;
            apiQueue.push({ url, resolve });
            processApiQueue();
        });
    }

    async function searchTmdb(animeName) {
        if (!TMDB_API_KEY) {
            return { poster: null, banner: null, score: null, genres: [], title: animeName };
        }

        const cached = getCachedData(animeName);
        if (cached !== null) return cached;

        // Clean name for search
        const cleanName = animeName
            .replace(/第[一二三四五六七八九十百\d]+季/g, '')
            .replace(/第[一二三四五六七八九十百\d]+部/g, '')
            .replace(/Season\s*\d+/gi, '')
            .replace(/Part\s*\d+/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        const data = await tmdbRequest('/search/tv', { query: cleanName });

        if (data && data.results && data.results.length > 0) {
            // Prefer entries with posters; fallback to the first result.
            const media = data.results.find(item => item && item.poster_path) || data.results[0];
            const result = {
                poster: media.poster_path ? `${TMDB_IMAGE_BASE}${media.poster_path}` : null,
                banner: media.backdrop_path ? `${TMDB_IMAGE_ORIGINAL_BASE}${media.backdrop_path}` : null,
                score: media.vote_average ? media.vote_average.toFixed(1) : null,
                genres: [], // Search result doesn't give genre names, only IDs. Skipping for now.
                title: media.name || media.original_name || animeName,
                episodes: null, // Search result doesn't include episode count
                status: null // Search result doesn't include status
            };
            setCachedData(animeName, result);
            return result;
        } else {
            // Cache miss result too to avoid re-querying
            const empty = { poster: null, banner: null, score: null, genres: [], title: animeName };
            setCachedData(animeName, empty);
            return empty;
        }
    }

    // ===================== GLOBAL STYLES =====================
    injectCSS(`
        /* ===== Base overrides ===== */
        body {
            font-family: 'Noto Sans TC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        }

        /* Hide ads */
        #ad-1, #ad-2, #ad-3, #ad-4, #ad-5,
        .sidebar-discord,
        [id^="ad-"] > a > img {
            display: none !important;
        }

        /* ===== Scrollbar ===== */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.4); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(139,92,246,0.6); }

        /* ===== Header ===== */
        #site-navigation,
        .main-navigation,
        #primary-menu {
            display: none !important;
        }
        #masthead {
            position: relative !important;
            background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%) !important;
            box-shadow: 0 4px 30px rgba(0,0,0,0.3) !important;
            border-bottom: 1px solid rgba(139,92,246,0.3) !important;
        }
        #masthead .header-content {
            position: relative !important;
            padding-top: 8px !important;
            padding-bottom: 8px !important;
            min-height: 56px !important;
        }
        #masthead .header-content.inline .site-title {
            padding: 6px 14px !important;
        }
        #masthead .header-content.inline .main-navigation {
            padding: 0 !important;
        }
        #masthead .site-title,
        #masthead .site-title h1 {
            margin: 0 !important;
            line-height: 1.15 !important;
        }
        #masthead .site-title h1 {
            font-size: 1.75rem !important;
        }
        .site-title h1 a {
            background: linear-gradient(135deg, #a78bfa, #c084fc, #e879f9) !important;
            -webkit-background-clip: text !important;
            -webkit-text-fill-color: transparent !important;
            font-weight: 700 !important;
            letter-spacing: 1px !important;
            line-height: 1.15 !important;
        }
        #primary-menu a {
            color: rgba(255,255,255,0.85) !important;
            transition: all 0.3s ease !important;
            position: relative !important;
        }
        #primary-menu a:hover { color: #c084fc !important; }
        #primary-menu a::after {
            content: ''; position: absolute; bottom: -2px; left: 50%;
            width: 0; height: 2px;
            background: linear-gradient(90deg, #a78bfa, #e879f9);
            transition: all 0.3s ease; transform: translateX(-50%);
        }
        #primary-menu a:hover::after { width: 80%; }

        /* ===== Footer ===== */
        #colophon {
            background: linear-gradient(135deg, #0f0c29, #1a1640) !important;
            border-top: 1px solid rgba(139,92,246,0.2) !important;
        }

        /* Footer utilities: move controls to floating corners and hide footer info */
        #colophon {
            background: transparent !important;
            border-top: none !important;
            min-height: 0 !important;
            padding: 0 !important;
        }
        #colophon .site-info,
        #colophon .social-url {
            display: none !important;
        }

        /* Back-to-top button -> fixed bottom-right */
        #colophon .scroll-top {
            position: fixed !important;
            right: 18px !important;
            bottom: 18px !important;
            z-index: 9999 !important;
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
        }
        #colophon #scrolltop {
            width: 42px !important;
            height: 42px !important;
            border-radius: 999px !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            text-decoration: none !important;
            background: linear-gradient(135deg, #7c3aed, #a855f7) !important;
            color: #fff !important;
            box-shadow: 0 8px 22px rgba(124,58,237,0.35) !important;
            border: none !important;
            outline: none !important;
        }
        #colophon .scroll-top::before,
        #colophon .scroll-top::after,
        #colophon #scrolltop::before,
        #colophon #scrolltop::after {
            display: none !important;
            border: none !important;
        }

        /* Dark mode controls -> fixed top-right icon-only */
        #masthead .darkmode-control {
            position: absolute !important;
            top: 50% !important;
            right: 14px !important;
            transform: translateY(-50%) !important;
            z-index: 9999 !important;
            display: flex !important;
            gap: 0 !important;
            margin: 0 !important;
            padding: 4px !important;
            border-radius: 999px !important;
            border: 1px solid rgba(148,163,184,0.45) !important;
            background: rgba(30,41,59,0.35) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 3px 10px rgba(2,6,23,0.22) !important;
            backdrop-filter: blur(6px) !important;
        }
        #masthead .darkmode-control .darkmodebtns {
            width: 34px !important;
            height: 34px !important;
            border-radius: 999px !important;
            padding: 0 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            border: none !important;
            background: transparent !important;
            color: #9aa8c4 !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
            transition: all 0.2s ease !important;
            cursor: pointer !important;
        }
        #masthead .darkmode-control #darkmodebtn,
        #masthead .darkmode-control #lightmodebtn {
            display: inline-flex !important;
        }
        #masthead .darkmode-control #automodebtn {
            display: none !important;
        }
        #masthead .darkmode-control #ae-tmdb-settings-btn {
            display: inline-flex !important;
        }
        #masthead .darkmode-control .darkmodebtns > span {
            display: none !important;
        }
        #masthead .darkmode-control .darkmodebtns .inline-svg {
            width: 17px !important;
            height: 17px !important;
            margin: 0 !important;
        }
        #masthead .darkmode-control .darkmodebtns .inline-svg path[stroke] {
            stroke: currentColor !important;
            fill: none !important;
        }
        #masthead .darkmode-control .darkmodebtns .inline-svg path:not([stroke]) {
            fill: currentColor !important;
        }
        #masthead .darkmode-control .darkmodebtns.active {
            background: #ffffff !important;
            color: #0f172a !important;
            box-shadow: 0 2px 7px rgba(15,23,42,0.28) !important;
            pointer-events: none !important;
            cursor: default !important;
        }
        #masthead .darkmode-control .darkmodebtns:hover {
            color: #c7d2fe !important;
        }
        #masthead .darkmode-control .darkmodebtns.active:hover {
            color: #0f172a !important;
        }
    `);

    // ===================== HOMEPAGE =====================
    function isHomePage() {
        return document.body.classList.contains('home') ||
            (location.pathname === '/' && document.querySelector('#table-list'));
    }

    async function enhanceHomePage() {
        // Hide original content immediately
        const article = document.querySelector('article');
        const entryContent = article?.querySelector('.entry-content');
        if (!entryContent) return;

        injectCSS(HOMEPAGE_CSS);

        // Hide sidebar, full width
        const primary = document.querySelector('#primary');
        const secondary = document.querySelector('#secondary');
        if (primary) primary.style.cssText = 'width:100%!important;max-width:1400px!important;margin:0 auto!important;float:none!important;';
        if (secondary) secondary.style.display = 'none';
        const siteContent = document.querySelector('.site-content');
        if (siteContent) siteContent.style.cssText = 'max-width:1400px!important;margin:0 auto!important;padding:0 20px!important;';

        // Show loading state
        entryContent.innerHTML = `
            <div id="anime-enhanced-home">
                <div class="ae-loading">
                    <div class="ae-spinner"></div>
                    <p>正在載入動畫列表...</p>
                </div>
            </div>
        `;

        // Fetch anime list directly from API
        let animeList = [];
        try {
            const jsonData = await fetchAnimeList();
            animeList = jsonData
                .filter(item => item[0] !== 0) // Filter out 18+ external links
                .map(item => ({
                    catId: item[0],
                    name: item[1],
                    url: `https://anime1.me/?cat=${item[0]}`,
                    episodes: item[2] || '',
                    year: item[3] || '',
                    season: item[4] || '',
                    sub: item[5] || ''
                }));
        } catch (e) {
            console.error('[Anime1 Enhancer] Failed to load anime list:', e);
            document.getElementById('anime-enhanced-home').innerHTML = `
                <div class="ae-error">載入失敗，請重新整理頁面。</div>
            `;
            return;
        }

        if (animeList.length === 0) {
            document.getElementById('anime-enhanced-home').innerHTML = `
                <div class="ae-error">無法取得動畫列表資料。</div>
            `;
            return;
        }

        // Build UI
        const container = document.getElementById('anime-enhanced-home');
        container.innerHTML = `
            <div class="ae-search-section">
                <div class="ae-search-wrapper">
                    <svg class="ae-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>
                    </svg>
                    <input type="text" id="ae-search-input" placeholder="搜尋動畫名稱..." autocomplete="off">
                    <div class="ae-search-count"><span id="ae-visible-count">${animeList.length}</span> 部動畫</div>
                </div>
                <div class="ae-filter-pills">
                    <button class="ae-pill active" data-filter="all">全部</button>
                    <button class="ae-pill" data-filter="airing">連載中</button>
                    <button class="ae-pill" data-filter="completed">已完結</button>
                    <div class="ae-season-filters" id="ae-season-filters"></div>
                </div>
            </div>
            <div class="ae-grid" id="ae-grid"></div>
            <div class="ae-pagination" id="ae-pagination"></div>
        `;

        // Build season filters dynamically
        const seasons = new Set();
        animeList.forEach(a => { if (a.year && a.season) seasons.add(`${a.year}年${a.season}季`); });
        const seasonArr = [...seasons].sort().reverse().slice(0, 6);
        const seasonContainer = document.getElementById('ae-season-filters');
        seasonArr.forEach(s => {
            const btn = document.createElement('button');
            btn.className = 'ae-pill ae-pill-season';
            btn.dataset.season = s;
            btn.textContent = s;
            btn.addEventListener('click', () => {
                const isActive = btn.classList.contains('active');
                document.querySelectorAll('.ae-pill-season').forEach(b => b.classList.remove('active'));
                if (!isActive) {
                    btn.classList.add('active');
                    currentSeason = s;
                } else {
                    currentSeason = '';
                }
                filterAndRender();
            });
            seasonContainer.appendChild(btn);
        });

        const grid = document.getElementById('ae-grid');
        let currentPage = 1;
        const perPage = 24;
        let filteredList = [...animeList];
        let currentFilter = 'all';
        let currentSeason = '';

        function filterAndRender() {
            const query = document.getElementById('ae-search-input')?.value?.toLowerCase() || '';
            filteredList = animeList.filter(a => {
                const matchesSearch = !query || a.name.toLowerCase().includes(query);
                const matchesFilter = currentFilter === 'all' ||
                    (currentFilter === 'airing' && a.episodes.includes('連載中')) ||
                    (currentFilter === 'completed' && !a.episodes.includes('連載中'));
                const matchesSeason = !currentSeason || `${a.year}年${a.season}季` === currentSeason;
                return matchesSearch && matchesFilter && matchesSeason;
            });
            document.getElementById('ae-visible-count').textContent = filteredList.length;
            currentPage = 1;
            renderPage();
        }

        function renderPage() {
            const start = (currentPage - 1) * perPage;
            const pageItems = filteredList.slice(start, start + perPage);

            grid.innerHTML = '';
            pageItems.forEach((anime, idx) => {
                grid.appendChild(createCard(anime, start + idx));
            });

            renderPagination(Math.ceil(filteredList.length / perPage));

            // Fetch covers
            pageItems.forEach((anime, idx) => {
                loadCover(anime.name, start + idx);
            });
        }

        function createCard(anime, index) {
            const card = document.createElement('a');
            card.href = anime.url;
            card.className = 'ae-card';
            card.dataset.index = index;
            card.style.animationDelay = `${(index % perPage) * 0.03}s`;

            const isAiring = anime.episodes.includes('連載中');
            const epMatch = anime.episodes.match(/\((\d+)\)/) || anime.episodes.match(/^(\d[\d-]*)$/);
            const epText = epMatch ? epMatch[1] : anime.episodes;

            card.innerHTML = `
                <div class="ae-card-poster">
                    <div class="ae-card-poster-placeholder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                        </svg>
                    </div>
                    <img class="ae-card-img" data-name="${anime.name}" alt="${anime.name}" loading="lazy">
                    <div class="ae-card-overlay"></div>
                    ${isAiring
                    ? '<span class="ae-badge ae-badge-airing">● 連載中</span>'
                    : '<span class="ae-badge ae-badge-done">已完結</span>'}
                    ${epText ? `<span class="ae-badge ae-badge-ep">${isAiring ? 'EP ' : ''}${epText}</span>` : ''}
                    <div class="ae-card-rating" id="ae-rating-${index}" style="display:none;">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                        <span class="ae-rating-val"></span>
                    </div>
                </div>
                <div class="ae-card-info">
                    <h3 class="ae-card-title">${anime.name}</h3>
                    <div class="ae-card-meta">
                        <span class="ae-meta-tag">${anime.year}${anime.season ? '·' + anime.season : ''}</span>
                        ${anime.sub ? `<span class="ae-meta-sub">${anime.sub}</span>` : ''}
                    </div>
                </div>
            `;
            return card;
        }

        async function loadCover(name, index) {
            const card = grid.querySelector(`.ae-card[data-index="${index}"]`);
            if (!card) return;
            const img = card.querySelector('.ae-card-img');
            const placeholder = card.querySelector('.ae-card-poster-placeholder');
            const ratingEl = card.querySelector(`#ae-rating-${index}`);

            const data = await searchTmdb(name);

            if (data && data.poster) {
                const showImage = (src) => {
                    img.onload = () => {
                        placeholder.style.display = 'none';
                        img.classList.add('ae-loaded');
                    };
                    img.style.display = 'block';
                    img.src = src;
                };

                const gmFallback = () => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: data.poster,
                        // `blob:` URLs can be blocked in some userscript sandboxes.
                        // Convert to data URL directly for maximum compatibility.
                        responseType: 'arraybuffer',
                        onload: (response) => {
                            if (response.status === 200 && response.response) {
                                try {
                                    const bytes = new Uint8Array(response.response);
                                    let binary = '';
                                    const chunk = 0x8000;
                                    for (let i = 0; i < bytes.length; i += chunk) {
                                        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                                    }
                                    const contentType = response.responseHeaders?.match(/content-type:\s*([^\r\n;]+)/i)?.[1] || 'image/jpeg';
                                    const dataUrl = `data:${contentType};base64,${btoa(binary)}`;
                                    img.onerror = (ev) => {
                                        console.error('[Anime1 Enhancer] Data URL render failed:', { name, index, ev });
                                    };
                                    showImage(dataUrl);
                                } catch (e) {
                                    console.error('[Anime1 Enhancer] Failed to convert image to data URL:', e);
                                }
                            } else {
                                console.error(`[Anime1 Enhancer] Failed to load image: ${response.status}`);
                            }
                        },
                        onerror: (e) => {
                            console.error('[Anime1 Enhancer] Image load error:', e);
                        }
                    });
                };

                // Direct image URL works on most environments and avoids binary decoding issues.
                img.referrerPolicy = 'origin';
                img.onerror = () => {
                    // Fallback to GM_xmlhttpRequest for environments with strict page CSP / CORS behavior.
                    gmFallback();
                    img.onerror = null;
                };
                showImage(data.poster);
            }

            if (data && data.score && ratingEl) {
                ratingEl.querySelector('.ae-rating-val').textContent = data.score;
                ratingEl.style.display = 'flex';
            }
        }

        function renderPagination(totalPages) {
            const pag = document.getElementById('ae-pagination');
            if (totalPages <= 1) { pag.innerHTML = ''; return; }
            let html = '';
            html += `<button class="ae-page-btn ${currentPage === 1 ? 'disabled' : ''}" data-page="${currentPage - 1}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M15 18l-6-6 6-6"/></svg></button>`;
            const maxV = 7;
            let s = Math.max(1, currentPage - Math.floor(maxV / 2));
            let e = Math.min(totalPages, s + maxV - 1);
            if (e - s < maxV - 1) s = Math.max(1, e - maxV + 1);
            if (s > 1) { html += `<button class="ae-page-btn" data-page="1">1</button>`; if (s > 2) html += `<span class="ae-page-dots">…</span>`; }
            for (let i = s; i <= e; i++) html += `<button class="ae-page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            if (e < totalPages) { if (e < totalPages - 1) html += `<span class="ae-page-dots">…</span>`; html += `<button class="ae-page-btn" data-page="${totalPages}">${totalPages}</button>`; }
            html += `<button class="ae-page-btn ${currentPage === totalPages ? 'disabled' : ''}" data-page="${currentPage + 1}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9 18l6-6-6-6"/></svg></button>`;
            pag.innerHTML = html;
            pag.querySelectorAll('.ae-page-btn:not(.disabled)').forEach(btn => {
                btn.addEventListener('click', () => {
                    currentPage = parseInt(btn.dataset.page);
                    renderPage();
                    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            });
        }

        // Events
        document.getElementById('ae-search-input')?.addEventListener('input', debounce(filterAndRender, 300));
        document.querySelectorAll('.ae-pill:not(.ae-pill-season)').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.ae-pill:not(.ae-pill-season)').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                currentFilter = pill.dataset.filter;
                filterAndRender();
            });
        });

        renderPage();
    }

    function fetchAnimeList() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://anime1.me/animelist.json',
                onload(res) {
                    try {
                        resolve(JSON.parse(res.responseText));
                    } catch (e) { reject(e); }
                },
                onerror: reject
            });
        });
    }

    function debounce(fn, delay) {
        let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); };
    }

    const HOMEPAGE_CSS = `
        .entry-header { display: none !important; }

        /* Loading */
        .ae-loading {
            display: flex; flex-direction: column; align-items: center;
            justify-content: center; padding: 80px 20px; color: rgba(255,255,255,0.5);
        }
        .ae-spinner {
            width: 40px; height: 40px; border: 3px solid rgba(139,92,246,0.2);
            border-top-color: #a78bfa; border-radius: 50%;
            animation: ae-spin 0.8s linear infinite; margin-bottom: 16px;
        }
        @keyframes ae-spin { to { transform: rotate(360deg); } }
        .ae-error {
            text-align: center; padding: 60px 20px; color: rgba(255,255,255,0.5);
            font-size: 15px;
        }

        /* Search */
        .ae-search-section { margin-bottom: 28px; }
        .ae-search-wrapper {
            position: relative; display: flex; align-items: center;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(139,92,246,0.2);
            border-radius: 16px; padding: 0 20px;
            transition: all 0.3s ease; backdrop-filter: blur(12px);
        }
        .ae-search-wrapper:focus-within {
            border-color: rgba(139,92,246,0.6);
            box-shadow: 0 0 0 3px rgba(139,92,246,0.15), 0 8px 32px rgba(139,92,246,0.1);
            background: rgba(255,255,255,0.1);
        }
        .ae-search-icon { width: 20px; height: 20px; color: rgba(139,92,246,0.7); flex-shrink: 0; }
        #ae-search-input {
            flex: 1; background: none!important; border: none!important; outline: none!important;
            padding: 16px 14px!important; font-size: 15px!important; color: inherit!important;
            font-family: inherit!important;
        }
        #ae-search-input::placeholder { color: rgba(255,255,255,0.35); }
        .ae-search-count {
            font-size: 13px; color: rgba(255,255,255,0.4); white-space: nowrap;
            padding-left: 12px; border-left: 1px solid rgba(255,255,255,0.1);
        }

        /* Filters */
        .ae-filter-pills { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; align-items: center; }
        .ae-season-filters { display: contents; }
        .ae-pill {
            padding: 7px 18px; border-radius: 20px;
            border: 1px solid rgba(139,92,246,0.25); background: rgba(139,92,246,0.08);
            color: rgba(255,255,255,0.7); font-size: 13px; cursor: pointer;
            transition: all 0.25s ease; font-family: inherit;
        }
        .ae-pill:hover { background: rgba(139,92,246,0.2); border-color: rgba(139,92,246,0.4); }
        .ae-pill.active {
            background: linear-gradient(135deg, #7c3aed, #a855f7);
            border-color: transparent; color: #fff; font-weight: 500;
            box-shadow: 0 4px 15px rgba(139,92,246,0.35);
        }
        .ae-pill-season {
            font-size: 12px; padding: 5px 14px;
            border-color: rgba(139,92,246,0.15);
            background: rgba(139,92,246,0.04);
        }

        /* Grid */
        .ae-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 20px;
        }
        @media (min-width: 768px) { .ae-grid { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 22px; } }
        @media (min-width: 1200px) { .ae-grid { grid-template-columns: repeat(6, 1fr); gap: 24px; } }

        /* Card */
        .ae-card {
            display: flex; flex-direction: column; border-radius: 14px; overflow: hidden;
            background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
            text-decoration: none!important; color: inherit!important;
            transition: all 0.35s cubic-bezier(0.4,0,0.2,1);
            animation: ae-fadeUp 0.5s ease forwards; opacity: 0; transform: translateY(20px);
        }
        @keyframes ae-fadeUp { to { opacity: 1; transform: translateY(0); } }
        .ae-card:hover {
            transform: translateY(-6px) scale(1.02);
            box-shadow: 0 20px 40px rgba(139,92,246,0.2), 0 0 0 1px rgba(139,92,246,0.3);
            border-color: rgba(139,92,246,0.4);
        }

        /* Poster */
        .ae-card-poster {
            position: relative; width: 100%; padding-top: 142%; overflow: hidden;
            background: linear-gradient(145deg, #1a1040, #0d0a1a);
        }
        .ae-card-poster-placeholder {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0;
            display: flex; align-items: center; justify-content: center;
        }
        .ae-card-poster-placeholder svg { width: 40px; height: 40px; color: rgba(139,92,246,0.25); }
        .ae-card-img {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            object-fit: cover; transition: transform 0.5s cubic-bezier(0.4,0,0.2,1), opacity 0.4s ease;
            opacity: 0;
        }
        .ae-card-img.ae-loaded { opacity: 1; }
        .ae-card:hover .ae-card-img { transform: scale(1.08); }
        .ae-card-overlay {
            position: absolute; bottom: 0; left: 0; right: 0; height: 60%;
            background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%);
            pointer-events: none; opacity: 0; transition: opacity 0.3s ease;
        }
        .ae-card:hover .ae-card-overlay { opacity: 1; }

        /* Badges */
        .ae-badge {
            position: absolute; font-size: 11px; font-weight: 600; padding: 3px 8px;
            border-radius: 6px; z-index: 2; backdrop-filter: blur(8px); letter-spacing: 0.3px;
        }
        .ae-badge-airing {
            top: 8px; left: 8px; background: rgba(16,185,129,0.85); color: #fff;
            box-shadow: 0 2px 8px rgba(16,185,129,0.3);
        }
        .ae-badge-done { top: 8px; left: 8px; background: rgba(107,114,128,0.8); color: #e5e7eb; }
        .ae-badge-ep {
            top: 8px; right: 8px; background: rgba(139,92,246,0.85); color: #fff;
            box-shadow: 0 2px 8px rgba(139,92,246,0.3);
        }
        .ae-card-rating {
            position: absolute; bottom: 8px; right: 8px;
            display: flex; align-items: center; gap: 3px;
            padding: 3px 8px; border-radius: 6px;
            background: rgba(0,0,0,0.65); color: #fbbf24;
            font-size: 12px; font-weight: 600; backdrop-filter: blur(8px); z-index: 2;
        }
        .ae-card-rating svg { width: 12px; height: 12px; }

        /* Card Info */
        .ae-card-info { padding: 12px 12px 14px; }
        .ae-card-title {
            font-size: 13.5px!important; font-weight: 600!important; line-height: 1.4!important;
            margin: 0 0 6px!important; display: -webkit-box; -webkit-line-clamp: 2;
            -webkit-box-orient: vertical; overflow: hidden; color: rgba(255,255,255,0.92)!important;
        }
        .ae-card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .ae-meta-tag {
            font-size: 11px; color: rgba(139,92,246,0.8);
            background: rgba(139,92,246,0.1); padding: 2px 8px; border-radius: 4px;
        }
        .ae-meta-sub { font-size: 11px; color: rgba(255,255,255,0.45); }

        /* Pagination */
        .ae-pagination {
            display: flex; justify-content: center; align-items: center;
            gap: 6px; margin-top: 36px; padding-bottom: 20px;
        }
        .ae-page-btn {
            min-width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
            border-radius: 10px; border: 1px solid rgba(255,255,255,0.1);
            background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.7);
            font-size: 13px; cursor: pointer; transition: all 0.2s ease; font-family: inherit;
        }
        .ae-page-btn:hover:not(.disabled):not(.active) { background: rgba(139,92,246,0.2); border-color: rgba(139,92,246,0.4); }
        .ae-page-btn.active {
            background: linear-gradient(135deg, #7c3aed, #a855f7);
            border-color: transparent; color: #fff; font-weight: 600;
            box-shadow: 0 4px 15px rgba(139,92,246,0.35);
        }
        .ae-page-btn.disabled { opacity: 0.3; cursor: not-allowed; }
        .ae-page-dots { color: rgba(255,255,255,0.3); font-size: 14px; padding: 0 4px; }

        /* Light mode */
        :root.ae-light .ae-search-wrapper { background: rgba(0,0,0,0.03); border-color: rgba(139,92,246,0.15); }
        :root.ae-light .ae-search-wrapper:focus-within { background: rgba(0,0,0,0.05); }
        :root.ae-light #ae-search-input::placeholder { color: rgba(0,0,0,0.35); }
        :root.ae-light .ae-search-count { color: rgba(0,0,0,0.4); border-left-color: rgba(0,0,0,0.1); }
        :root.ae-light .ae-pill { color: rgba(0,0,0,0.65); background: rgba(139,92,246,0.05); }
        :root.ae-light .ae-card { background: #fff; border-color: rgba(0,0,0,0.08); box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
        :root.ae-light .ae-card:hover { box-shadow: 0 20px 40px rgba(139,92,246,0.15), 0 0 0 1px rgba(139,92,246,0.2); }
        :root.ae-light .ae-card-title { color: #1a1a2e!important; }
        :root.ae-light .ae-card-poster { background: linear-gradient(145deg, #f0ecff, #e8e4f4); }
        :root.ae-light .ae-card-poster-placeholder svg { color: rgba(139,92,246,0.2); }
        :root.ae-light .ae-page-btn { background: #fff; border-color: rgba(0,0,0,0.1); color: #333; }
        :root.ae-light .ae-meta-sub { color: rgba(0,0,0,0.4); }

        :root.ae-dark #ae-search-input { color: rgba(255,255,255,0.92)!important; }
        :root.ae-dark #ae-search-input::placeholder { color: rgba(255,255,255,0.4)!important; }
        :root.ae-dark .ae-search-count { color: rgba(255,255,255,0.55)!important; }
        :root.ae-dark .ae-pill { color: rgba(255,255,255,0.85)!important; }
        :root.ae-dark .ae-meta-sub { color: rgba(255,255,255,0.6)!important; }
        :root.ae-dark .ae-card {
            background: rgba(255,255,255,0.04)!important;
            border-color: rgba(255,255,255,0.10)!important;
            box-shadow: none !important;
        }
    `;

    // ===================== PLAY PAGE =====================
    function isPlayPage() {
        return document.body.classList.contains('archive') &&
            document.body.classList.contains('category') &&
            document.querySelectorAll('article').length > 0;
    }

    function enhancePlayPage() {
        const articles = [...document.querySelectorAll('#main > article')];
        if (articles.length === 0) return;

        injectCSS(PLAYPAGE_CSS);

        // Parse episodes
        const episodes = [];
        articles.forEach(art => {
            const titleEl = art.querySelector('.entry-title a');
            const vjsContainer = art.querySelector('.vjscontainer');
            if (!titleEl) return;

            const title = titleEl.textContent.trim();
            const epMatch = title.match(/\[(\d+)\]/);
            const epNum = epMatch ? parseInt(epMatch[1]) : episodes.length + 1;
            const postUrl = titleEl.href;

            episodes.push({ title, epNum, postUrl, vjsContainer });
        });

        episodes.reverse(); // Chronological order: [01] first

        // Keep original players hidden; only one real player node is mounted into wrapper at a time.
        episodes.forEach(ep => {
            if (ep.vjsContainer) {
                ep.vjsContainer._originalParent = ep.vjsContainer.parentElement;
                ep.vjsContainer.style.display = 'none';
            }
        });

        if (episodes.length === 0) return;

        const pageTitle = document.querySelector('.page-header .page-title')?.textContent?.trim() || '';
        const main = document.getElementById('main');
        const primaryDiv = document.getElementById('primary');

        // Hide original content
        articles.forEach(a => a.style.display = 'none');
        document.querySelectorAll('#main > .pagination, #main > nav').forEach(el => el.style.display = 'none');

        // Full width
        const secondary = document.querySelector('#secondary');
        if (secondary) secondary.style.display = 'none';
        if (primaryDiv) primaryDiv.style.cssText = 'width:100%!important;max-width:1100px!important;margin:0 auto!important;float:none!important;';
        const siteContent = document.querySelector('.site-content');
        if (siteContent) siteContent.style.cssText = 'max-width:1200px!important;margin:0 auto!important;padding:0 20px!important;';

        // Build player UI
        const section = document.createElement('div');
        section.className = 'ap-player-section';
        section.innerHTML = `
            <div class="ap-title-bar" id="ap-title-bar">
                <div class="ap-anime-info">
                    <h1 class="ap-anime-title">${pageTitle}</h1>
                    <div class="ap-now-playing">
                        <span class="ap-now-label">正在播放</span>
                        <span class="ap-now-ep" id="ap-current-ep-label"></span>
                    </div>
                </div>
                <a class="ap-back-link" href="https://anime1.me/">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M15 18l-6-6 6-6"/></svg>
                    返回列表
                </a>
            </div>
            <div class="ap-video-wrapper" id="ap-video-wrapper"></div>
            <div class="ap-controls-bar">
                <button class="ap-nav-btn" id="ap-prev-ep">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M15 18l-6-6 6-6"/></svg>
                    上一集
                </button>
                <div class="ap-ep-info-center" id="ap-ep-info-center"></div>
                <button class="ap-nav-btn" id="ap-next-ep">
                    下一集
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M9 18l6-6-6-6"/></svg>
                </button>
            </div>
            <div class="ap-episode-section">
                <div class="ap-ep-header">
                    <h2 class="ap-ep-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                        </svg>
                        選集列表
                    </h2>
                    <span class="ap-ep-count">共 ${episodes.length} 集</span>
                </div>
                <div class="ap-ep-grid" id="ap-ep-grid"></div>
            </div>
        `;
        main.insertBefore(section, main.firstChild);

        // Render episode buttons
        const epGrid = document.getElementById('ap-ep-grid');
        episodes.forEach((ep, idx) => {
            const btn = document.createElement('button');
            btn.className = 'ap-ep-btn';
            btn.dataset.index = idx;
            btn.textContent = String(ep.epNum).padStart(2, '0');
            btn.title = ep.title;
            btn.addEventListener('click', () => switchEp(idx));
            epGrid.appendChild(btn);
        });

        let currentIdx = 0;
        let mountedVjs = null;
        let playPoster = null;

        function pauseVideoIn(container) {
            if (!container) return;
            const video = container.querySelector('video');
            if (!video) return;
            try { video.pause(); } catch { /* ignore */ }
        }

        function applyEpisodePoster(container, posterUrl) {
            if (!container || !posterUrl) return;
            const videoJsRoot = container.querySelector('.video-js');
            const video = container.querySelector('video');
            const posterEl = container.querySelector('.vjs-poster');

            if (videoJsRoot) videoJsRoot.setAttribute('poster', posterUrl);
            if (video) video.setAttribute('poster', posterUrl);
            if (posterEl) posterEl.style.backgroundImage = `url("${posterUrl}")`;
        }

        function switchEp(index) {
            if (index < 0 || index >= episodes.length) return;
            currentIdx = index;
            const ep = episodes[index];

            // Update buttons
            epGrid.querySelectorAll('.ap-ep-btn').forEach((btn, i) => btn.classList.toggle('active', i === index));
            document.getElementById('ap-current-ep-label').textContent = ep.title;
            document.getElementById('ap-ep-info-center').textContent = `${index + 1} / ${episodes.length}`;
            document.getElementById('ap-prev-ep').disabled = index === 0;
            document.getElementById('ap-next-ep').disabled = index === episodes.length - 1;

            // Pause every episode player first to prevent background playback.
            episodes.forEach(item => pauseVideoIn(item.vjsContainer));

            // Unmount previous mounted player node.
            const wrapper = document.getElementById('ap-video-wrapper');
            if (mountedVjs && mountedVjs !== ep.vjsContainer && mountedVjs._originalParent) {
                mountedVjs.style.display = 'none';
                mountedVjs._originalParent.appendChild(mountedVjs);
            }
            wrapper.innerHTML = '';

            if (ep.vjsContainer) {
                ep.vjsContainer.style.display = '';
                wrapper.appendChild(ep.vjsContainer);
                mountedVjs = ep.vjsContainer;
                applyEpisodePoster(ep.vjsContainer, playPoster);
            }

            // Scroll
            const activeBtn = epGrid.querySelector('.ap-ep-btn.active');
            activeBtn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }

        document.getElementById('ap-prev-ep').addEventListener('click', () => switchEp(currentIdx - 1));
        document.getElementById('ap-next-ep').addEventListener('click', () => switchEp(currentIdx + 1));

        function centerPlayerOnOpen() {
            const wrapper = document.getElementById('ap-video-wrapper');
            if (!wrapper) return;
            const rect = wrapper.getBoundingClientRect();
            const targetY = window.scrollY + rect.top - Math.max(0, (window.innerHeight - rect.height) / 2);
            window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
        }

        // Start from first episode by default, but still respect URL-specified episode.
        let startIdx = 0;
        const urlP = new URLSearchParams(location.search).get('p');
        if (urlP) {
            const found = episodes.findIndex(ep => ep.postUrl.includes('/' + urlP));
            if (found >= 0) startIdx = found;
        }
        switchEp(startIdx);
        requestAnimationFrame(() => {
            setTimeout(centerPlayerOnOpen, 60);
        });

        // Fetch banner
        if (pageTitle) {
            searchTmdb(pageTitle).then(data => {
                if (data?.poster) {
                    playPoster = data.poster;
                    applyEpisodePoster(mountedVjs, playPoster);
                }
                if (data?.banner) {
                    const bar = document.getElementById('ap-title-bar');
                    bar.style.backgroundImage = `linear-gradient(135deg, rgba(15,12,41,0.92), rgba(48,43,99,0.88), rgba(36,36,62,0.92)), url(${data.banner})`;
                    bar.style.backgroundSize = 'cover, cover';
                    bar.style.backgroundPosition = 'center, center';
                }
            });
        }
    }

    const PLAYPAGE_CSS = `
        .page-header { display: none !important; }

        .ap-player-section {
            margin: 0 auto;
            max-width: 100%;
            display: block !important;
            clear: both !important;
            position: relative !important;
            z-index: 1 !important;
        }

        /* Prevent nested scroll containers from site/theme CSS on play page */
        html, body, #page, #content, .site-content, #primary, #main {
            overflow-x: hidden !important;
        }
        #content, .site-content, #primary, #main {
            overflow-y: visible !important;
            height: auto !important;
            max-height: none !important;
        }

        .ap-title-bar {
            display: flex; align-items: center; justify-content: space-between;
            padding: 20px 24px;
            background: linear-gradient(135deg, rgba(15,12,41,0.95), rgba(48,43,99,0.9), rgba(36,36,62,0.95));
            border-radius: 16px 16px 0 0;
            border: 1px solid rgba(139,92,246,0.2); border-bottom: none;
            flex-wrap: wrap; gap: 12px;
        }
        .ap-anime-title {
            font-size: 22px!important; font-weight: 700!important; margin: 0 0 6px!important;
            background: linear-gradient(135deg, #e2d9f3, #c084fc);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; line-height: 1.3!important;
        }
        .ap-now-playing { display: flex; align-items: center; gap: 8px; }
        .ap-now-label {
            font-size: 12px; padding: 3px 10px;
            background: rgba(139,92,246,0.35); border-radius: 4px; color: #c4b5fd; font-weight: 500;
        }
        .ap-now-ep { font-size: 14px; color: rgba(255,255,255,0.75); }
        .ap-back-link {
            display: flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 10px;
            background: rgba(139,92,246,0.15); border: 1px solid rgba(139,92,246,0.3);
            color: #c4b5fd!important; text-decoration: none!important; font-size: 13px;
            transition: all 0.25s ease; white-space: nowrap;
        }
        .ap-back-link:hover { background: rgba(139,92,246,0.3); transform: translateX(-2px); }

        .ap-video-wrapper {
            background: #000;
            border-left: 1px solid rgba(139,92,246,0.2);
            border-right: 1px solid rgba(139,92,246,0.2);
            position: relative !important;
            overflow: hidden !important;
            width: 100% !important;
        }
        .ap-video-wrapper::before {
            content: '';
            display: block;
            width: 100%;
            padding-top: 56.25%; /* 16:9 */
        }
        .ap-video-wrapper + .ap-controls-bar {
            position: static !important;
            z-index: auto !important;
            margin-top: 0;
        }
        .ap-video-wrapper .vjscontainer {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            display: block !important;
            max-width: none !important;
            overflow: hidden !important;
        }
        .ap-video-wrapper .video-js {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            max-width: none !important;
        }
        .ap-video-wrapper .video-js.vjs-fluid {
            padding-top: 0 !important;
        }
        .ap-video-wrapper .video-js:not(.vjs-fluid),
        .ap-video-wrapper .video-js .vjs-tech,
        .ap-video-wrapper .video-js video {
            width: 100% !important;
            height: 100% !important;
        }
        .ap-video-wrapper .video-js .vjs-control-bar {
            z-index: 30 !important;
        }

        .ap-controls-bar {
            display: flex; align-items: center; justify-content: space-between; padding: 12px 20px;
            background: rgba(15,12,41,0.9);
            border-left: 1px solid rgba(139,92,246,0.2); border-right: 1px solid rgba(139,92,246,0.2);
            backdrop-filter: blur(12px);
            position: static !important;
            overflow: visible !important;
            z-index: auto !important;
        }
        .ap-ep-info-center {
            font-size: 14px; color: rgba(255,255,255,0.5); font-weight: 500;
            font-variant-numeric: tabular-nums;
        }
        .ap-nav-btn {
            display: flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 10px;
            border: 1px solid rgba(139,92,246,0.25); background: rgba(139,92,246,0.1);
            color: #c4b5fd; font-size: 13px; cursor: pointer; transition: all 0.25s ease; font-family: inherit;
        }
        .ap-nav-btn:hover:not(:disabled) { background: rgba(139,92,246,0.25); border-color: rgba(139,92,246,0.5); transform: scale(1.03); }
        .ap-nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .ap-episode-section {
            padding: 20px 24px 28px;
            background: rgba(15,12,41,0.6);
            border: 1px solid rgba(139,92,246,0.2); border-top: none;
            border-radius: 0 0 16px 16px; backdrop-filter: blur(12px);
            position: static !important;
            overflow: visible !important;
            z-index: auto !important;
            margin-top: 0 !important;
        }
        .ap-ep-header {
            display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;
        }
        .ap-ep-title {
            display: flex; align-items: center; gap: 8px;
            font-size: 16px!important; font-weight: 600!important; color: rgba(255,255,255,0.9)!important; margin: 0!important;
        }
        .ap-ep-title svg { color: #a78bfa; }
        .ap-ep-count { font-size: 13px; color: rgba(255,255,255,0.4); }

        .ap-ep-grid { display: flex; flex-wrap: wrap; gap: 8px; }
        .ap-ep-btn {
            min-width: 52px; height: 40px; display: flex; align-items: center; justify-content: center;
            border-radius: 10px; border: 1px solid rgba(255,255,255,0.1);
            background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.7);
            cursor: pointer; transition: all 0.25s ease; font-family: inherit;
            padding: 0 12px; font-size: 14px; font-weight: 500;
        }
        .ap-ep-btn:hover:not(.active) { background: rgba(139,92,246,0.15); border-color: rgba(139,92,246,0.35); transform: translateY(-2px); }
        .ap-ep-btn.active {
            background: linear-gradient(135deg, #7c3aed, #a855f7);
            border-color: transparent; color: #fff; font-weight: 600;
            box-shadow: 0 4px 15px rgba(139,92,246,0.4); transform: scale(1.05);
        }

        /* Light mode */
        :root.ae-light .ap-title-bar { background: linear-gradient(135deg, #f8f6ff, #eee8ff, #f3f0ff); }
        :root.ae-light .ap-anime-title { background: linear-gradient(135deg, #4c1d95, #7c3aed); -webkit-background-clip: text; }
        :root.ae-light .ap-controls-bar { background: #f5f3ff; }
        :root.ae-light .ap-episode-section { background: #faf8ff; border-color: rgba(139,92,246,0.15); }
        :root.ae-light .ap-now-ep { color: #4a4a6a; }
        :root.ae-light .ap-ep-title { color: #1a1a2e!important; }
        :root.ae-light .ap-ep-btn { background: #fff; border-color: rgba(0,0,0,0.1); color: #4a4a6a; }
        :root.ae-light .ap-nav-btn { color: #6d28d9; border-color: rgba(139,92,246,0.25); }
        :root.ae-light .ap-back-link { color: #6d28d9!important; }
        :root.ae-light .ap-ep-info-center { color: #666; }

        @media (max-width: 640px) {
            .ap-title-bar { padding: 14px 16px; }
            .ap-anime-title { font-size: 18px!important; }
            .ap-controls-bar { padding: 10px 14px; }
            .ap-nav-btn { padding: 6px 12px; font-size: 12px; }
            .ap-episode-section { padding: 14px 16px 20px; }
            .ap-ep-btn { min-width: 44px; height: 36px; font-size: 13px; }
        }
    `;

    // ===================== INIT =====================
    mountThemeControlToHeader();
    setTimeout(mountThemeControlToHeader, 120);
    initThemeSync();
    maybeShowApiSetupHint();

    if (isHomePage()) {
        enhanceHomePage();
    } else if (isPlayPage()) {
        enhancePlayPage();
    }

})();
