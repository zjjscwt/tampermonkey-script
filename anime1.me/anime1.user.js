// ==UserScript==
// @name         Anime1.me 增強2026
// @version      3.3.0
// @description  UI重構+封麵顯示+收藏夾+首頁無限滾動+觀看記錄+播放記憶+獨立播放頁跳轉+選集整合+播放器快捷鍵
// @author       Ryan
// @match        https://anime1.me/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @connect      api.bgm.tv
// @connect      *.bgm.tv
// @connect      anime1.me
// @run-at       document-idle
// @icon         https://anime1.me/favicon-32x32.png
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ===================== CORE HELPERS =====================
    const Store = {
        get: (key, def = null) => { try { const v = GM_getValue(key); const p = v ? (typeof v === 'string' ? JSON.parse(v) : v) : def; return (p && typeof p === 'object') ? p : def; } catch { return def; } },
        set: (key, val) => { try { GM_setValue(key, typeof val === 'string' ? val : JSON.stringify(val)); } catch { } }
    };
    const requestAsync = (url, options = {}) => new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: options.method || 'GET', url, responseType: options.responseType, headers: options.headers, onload: (r) => {
                if (options.json) { try { resolve(JSON.parse(r.responseText)); } catch { resolve(null); } }
                else resolve(r);
            }, onerror: () => options.json ? resolve(null) : reject()
        });
    });
    const createBaseModal = ({ id, width, title, content, onActionHTML, onActionClick, onInit }) => {
        const existing = document.getElementById(id); if (existing) existing.remove();
        const overlay = document.createElement('div'); overlay.id = id; overlay.className = 'ae-modal-overlay';
        overlay.innerHTML = `<div class="ae-modal-panel ae-fav-modal-panel" style="max-width:${width || 420}px" role="dialog" aria-modal="true">
            <button type="button" class="ae-modal-close" aria-label="關閉">×</button>
            <h2 class="ae-modal-title ae-fav-modal-title">${title}</h2>
            ${content}
            ${onActionHTML ? `<div class="ae-modal-footer" style="display:flex; justify-content:space-between; margin-top:16px;">${onActionHTML}</div>` : ''}
        </div>`;
        document.body.appendChild(overlay);
        const close = () => { overlay.remove(); };
        overlay.querySelector('.ae-modal-close').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
        if (onActionClick) onActionClick(overlay, close);
        if (onInit) onInit(overlay, close);
    };
    // ===================== CONFIG =====================
    const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days
    const BGM_API_URL = 'https://api.bgm.tv/v0';
    const BGM_CACHE_PREFIX = 'bgm_v1_';
    const BGM_USER_AGENT = 'Anime1Enhancer/3.0.1 (https://anime1.me/)';
    const API_RATE_INTERVAL = 300; // ms between requests
    const WATCH_PROGRESS_STORAGE_KEY = 'ae_watch_progress_v1';
    const FAVORITES_STORAGE_KEY = 'ae_favorites_v1';

    function openGeneralSettingsDialog() {
        const existing = document.getElementById('ae-general-modal');
        if (existing) return;

        const overlay = document.createElement('div');
        overlay.id = 'ae-general-modal';
        overlay.className = 'ae-modal-overlay';
        overlay.innerHTML = `
            <div class="ae-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ae-modal-title">
                <button type="button" class="ae-modal-close" aria-label="關閉">×</button>
                <h2 class="ae-modal-title" id="ae-modal-title">Anime1 增強設定</h2>
                <div class="ae-modal-field">
                    <p style="font-size:13px; color:var(--ae-text-secondary); line-height:1.6; margin-bottom:12px;">已成功切換至 Bangumi (BGM.tv) 封面源，無需手動設定 API Key。</p>
                    <div class="ae-modal-shortcuts">
                        <h3>播放器快捷鍵說明：</h3>
                        <ul>
                            <li><b>W</b>：切換/退出 網頁全屏</li>
                            <li><b>S 鍵</b>：輪流切換播放倍速</li>
                            <li><b>S + ↑ / ↓</b>：微調倍速 (+/- 0.1x)</li>
                            <li><b>Space</b>：播放 / 暫停</li>
                            <li><b>F</b>：進入 / 退出 系統全屏</li>
                            <li><b>M</b>：靜音 / 取消靜音</li>
                            <li><b>← / →</b>：快退 / 快進 5 秒</li>
                            <li><b>↑ / ↓</b>：增加 / 減少 音量</li>
                        </ul>
                    </div>
                </div>
                <div id="ae-modal-status" class="ae-modal-status"></div>
                <div class="ae-modal-actions">
                    <button type="button" id="ae-clear-bgm-cache" class="ae-modal-btn ae-modal-btn-danger">清除封面及評分緩存</button>
                    <span class="ae-modal-actions-spacer"></span>
                    <button type="button" id="ae-close-settings" class="ae-modal-btn ae-modal-btn-primary">確定</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = () => {
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
        };
        const onKeydown = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKeydown);

        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('.ae-modal-close').addEventListener('click', close);
        overlay.querySelector('#ae-close-settings').addEventListener('click', close);

        overlay.querySelector('#ae-clear-bgm-cache').addEventListener('click', () => {
            if (confirm('確定要清除所有已緩存的 Bangumi 封面數據嗎？')) {
                try {
                    const keys = GM_listValues();
                    let count = 0;
                    keys.forEach(k => {
                        if (k.startsWith(BGM_CACHE_PREFIX)) {
                            GM_deleteValue(k);
                            count++;
                        }
                    });
                    alert(`成功清除 ${count} 項封面，頁面即將重新整理。`);
                    location.reload();
                } catch (e) {
                    alert('清除失敗，請檢查權限或手动清理油猴數據：' + e.message);
                }
            }
        });
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

    let toastTimer = null;
    function showToast(message, iconSvg = '') {
        // Find the player root element (the one that actually goes fullscreen)
        const player = document.querySelector('.video-js') || document.querySelector('.vjscontainer');
        const parent = player || document.body;
        let toast = document.getElementById('ae-global-toast');

        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ae-global-toast';
            toast.className = 'ae-toast';
            parent.appendChild(toast);
        } else if (toast.parentElement !== parent) {
            // Re-mount if parent changed (e.g. entering player page)
            parent.appendChild(toast);
        }

        toast.innerHTML = (iconSvg ? `<span class="ae-toast-icon">${iconSvg}</span>` : '') + `<span>${message}</span>`;
        toast.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1600);
    }

    function formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function forceDarkMode() {
        const root = document.documentElement;
        root.classList.add('ae-dark');
        root.classList.remove('ae-light');

        try {
            localStorage.setItem('auto_darkmode', '0');
            localStorage.setItem('darkmode', '1');
        } catch { /* ignore */ }

        let darkCss = document.getElementById('darkmode-css');
        if (!darkCss) {
            darkCss = document.createElement('link');
            darkCss.rel = 'stylesheet';
            darkCss.id = 'darkmode-css';
            darkCss.href = '/wp-content/themes/basic-shop-child/css/dark.min.css?ver=9';
            darkCss.media = 'all';
            (document.head || document.documentElement).appendChild(darkCss);
        }
        darkCss.disabled = false;
    }

    function initForcedDarkMode() {
        forceDarkMode();

        // Site scripts may mutate dark-mode stylesheet state after load; force it back.
        const mo = new MutationObserver(() => {
            forceDarkMode();
        });
        mo.observe(document.head || document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['id', 'disabled', 'media', 'rel', 'href']
        });
    }

    function mountSettingsFloatingButton() {
        const root = document.body || document.documentElement;
        ensureApiSettingsButton(root);
        ensureCustomScrollTopButton();
    }

    function ensureCustomScrollTopButton() {
        if (document.getElementById('ae-scroll-top-btn-cloned')) return;

        const themeScroller = document.querySelector('.scroll-top');
        if (!themeScroller) return;

        const clone = themeScroller.cloneNode(true);
        clone.id = 'ae-scroll-top-btn-cloned';
        clone.className = 'ae-settings-fab';

        // Hide original permanently
        themeScroller.style.setProperty('display', 'none', 'important');
        themeScroller.style.setProperty('opacity', '0', 'important');
        themeScroller.style.setProperty('pointer-events', 'none', 'important');

        themeScroller.parentNode.insertBefore(clone, themeScroller.nextSibling);

        clone.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    function ensureApiSettingsButton(controlRoot) {
        if (!controlRoot || document.getElementById('ae-settings-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'ae-settings-btn';
        btn.className = 'ae-settings-fab';
        btn.type = 'button';
        btn.title = '腳本設定';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" class="inline-svg" aria-hidden="true">
                <path fill="currentColor" d="M19.14 12.94a7.43 7.43 0 0 0 .05-.94 7.43 7.43 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.27 7.27 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58a7.43 7.43 0 0 0-.05.94 7.43 7.43 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z"></path>
            </svg>
        `;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openGeneralSettingsDialog();
        });

        controlRoot.appendChild(btn);
    }

    function getCacheKey(name) {
        return BGM_CACHE_PREFIX + name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 80);
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

    function normalizeAnimeName(name) {
        return String(name || '').trim().toLowerCase();
    }

    function getWatchProgressMap() {
        try {
            const raw = GM_getValue(WATCH_PROGRESS_STORAGE_KEY, '{}');
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch {
            return {};
        }
    }

    function setWatchProgressMap(progressMap) {
        try {
            GM_setValue(WATCH_PROGRESS_STORAGE_KEY, JSON.stringify(progressMap || {}));
        } catch { /* ignore */ }
    }

    function getWatchProgressForAnime(anime, progressMap = null) {
        const map = progressMap || getWatchProgressMap();
        const catKey = anime?.catId ? `cat:${anime.catId}` : '';
        const nameKey = anime?.name ? `name:${normalizeAnimeName(anime.name)}` : '';
        return (catKey && map[catKey]) || (nameKey && map[nameKey]) || null;
    }

    function saveWatchProgress({ catId, animeName, epNum, epTitle, postUrl, positionSec, durationSec }) {
        if (!animeName) return;
        const map = getWatchProgressMap();
        const nameKey = `name:${normalizeAnimeName(animeName)}`;
        const catKey = Number.isFinite(catId) ? `cat:${catId}` : '';
        const prev = (catKey && map[catKey]) || map[nameKey] || {};
        const record = {
            ...prev,
            catId: Number.isFinite(catId) ? catId : (prev.catId || null),
            animeName: animeName || prev.animeName || '',
            lastEpisode: Number.isFinite(epNum) ? epNum : (prev.lastEpisode ?? null),
            lastEpisodeLabel: epTitle || prev.lastEpisodeLabel || '',
            postUrl: postUrl || prev.postUrl || '',
            updatedAt: Date.now()
        };
        if (Number.isFinite(positionSec)) {
            record.positionSec = Math.max(0, Math.floor(positionSec));
        }
        if (Number.isFinite(durationSec) && durationSec > 0) {
            record.durationSec = Math.floor(durationSec);
            if (Number.isFinite(record.positionSec) && record.positionSec >= record.durationSec - 2) {
                record.positionSec = 0;
            }
        }
        map[nameKey] = record;
        if (record.catId) map[`cat:${record.catId}`] = record;
        setWatchProgressMap(map);
    }

    function deleteWatchProgressForAnime({ catId, animeName }) {
        const map = getWatchProgressMap();
        if (Number.isFinite(catId) && catId > 0) delete map[`cat:${catId}`];
        if (animeName) delete map[`name:${normalizeAnimeName(animeName)}`];
        setWatchProgressMap(map);
    }

    // ===================== FAVORITES =====================
    function getFavoritesData() {
        try {
            const raw = GM_getValue(FAVORITES_STORAGE_KEY, null);
            if (!raw) return initFavoritesData();
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!parsed || !Array.isArray(parsed.categories) || typeof parsed.items !== 'object') return initFavoritesData();
            if (!parsed.categories.find(c => c.id === 'default')) {
                parsed.categories.unshift({ id: 'default', name: '默認分類', isDefault: true });
            }
            return parsed;
        } catch { return initFavoritesData(); }
    }

    function initFavoritesData() {
        const data = { categories: [{ id: 'default', name: '默認分類', isDefault: true }], items: {} };
        setFavoritesData(data);
        return data;
    }

    function setFavoritesData(data) {
        try { GM_setValue(FAVORITES_STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
    }

    function isAnimeFavorited(catId) {
        if (!catId) return false;
        const data = getFavoritesData();
        return !!(data.items[`cat:${catId}`] && data.items[`cat:${catId}`].length > 0);
    }

    function getAnimeFavoriteCategories(catId) {
        if (!catId) return [];
        return getFavoritesData().items[`cat:${catId}`] || [];
    }

    function toggleAnimeInCategory(catId, animeName, categoryId) {
        const data = getFavoritesData();
        const key = `cat:${catId}`;
        if (!data.items[key]) data.items[key] = [];
        const idx = data.items[key].indexOf(categoryId);
        if (idx >= 0) { data.items[key].splice(idx, 1); }
        else { data.items[key].push(categoryId); }
        if (data.items[key].length === 0) delete data.items[key];
        setFavoritesData(data);
    }

    function addFavoriteCategory(name) {
        const data = getFavoritesData();
        const id = 'fav_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        data.categories.push({ id, name });
        setFavoritesData(data);
        return id;
    }

    function deleteFavoriteCategory(categoryId) {
        if (categoryId === 'default') return false;
        const data = getFavoritesData();
        data.categories = data.categories.filter(c => c.id !== categoryId);
        for (const key of Object.keys(data.items)) {
            data.items[key] = data.items[key].filter(cid => cid !== categoryId);
            if (data.items[key].length === 0) delete data.items[key];
        }
        setFavoritesData(data);
        return true;
    }

    function renameFavoriteCategory(categoryId, newName) {
        if (categoryId === 'default') return false;
        const data = getFavoritesData();
        const cat = data.categories.find(c => c.id === categoryId);
        if (cat) { cat.name = newName; setFavoritesData(data); return true; }
        return false;
    }

    function deleteFavoriteAnime(catId) {
        if (!catId) return;
        const data = getFavoritesData();
        delete data.items[`cat:${catId}`];
        setFavoritesData(data);
    }

    function moveAnimeToCategory(catId, fromCategoryId, toCategoryId) {
        const data = getFavoritesData();
        const key = `cat:${catId}`;
        if (!data.items[key]) return;
        data.items[key] = data.items[key].filter(cid => cid !== fromCategoryId);
        if (!data.items[key].includes(toCategoryId)) data.items[key].push(toCategoryId);
        if (data.items[key].length === 0) delete data.items[key];
        setFavoritesData(data);
    }

    function getCurrentCategoryId() {
        const qsCat = parseInt(new URLSearchParams(location.search).get('cat') || '', 10);
        if (Number.isFinite(qsCat) && qsCat > 0) return qsCat;
        const bodyCatClass = [...(document.body?.classList || [])].find(cls => /^category-\d+$/.test(cls));
        if (!bodyCatClass) return null;
        const classCat = parseInt(bodyCatClass.replace('category-', ''), 10);
        return (Number.isFinite(classCat) && classCat > 0) ? classCat : null;
    }

    // Bangumi request queue
    let apiQueue = [];
    let apiProcessing = false;

    function clearApiQueue() {
        // Resolve all pending tasks with null to avoid hanging promises
        apiQueue.forEach(item => item.resolve(null));
        apiQueue = [];
    }

    function processApiQueue() {
        if (apiProcessing || apiQueue.length === 0) return;
        apiProcessing = true;
        const item = apiQueue.shift();
        if (!item) { apiProcessing = false; return; }
        const { method, url, body, resolve } = item;

        GM_xmlhttpRequest({
            method: method || 'GET',
            url: url,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': BGM_USER_AGENT
            },
            data: body ? JSON.stringify(body) : null,
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

    function bgmRequest(endpoint, body = null) {
        return new Promise(resolve => {
            const url = `${BGM_API_URL}${endpoint}`;
            apiQueue.push({ method: 'POST', url, body, resolve });
            processApiQueue();
        });
    }

    async function searchBangumi(animeName, year) {
        const cached = getCachedData(animeName);
        if (cached !== null) return cached;

        const yearNum = parseInt(String(year || '').match(/\d+/)?.[0]);
        const body = {
            keyword: animeName,
            filter: {
                type: [2],
                nsfw: false
            },
            limit: 3
        };

        if (Number.isFinite(yearNum)) {
            body.filter.air_date = [
                `>=${yearNum}-01-01`,
                `<${yearNum + 1}-01-01`
            ];
        }

        const data = await bgmRequest('/search/subjects', body);

        // If data is null (cancelled/error), just exit without caching failure
        if (!data) return null;

        if (data.data && data.data.length > 0) {
            const media = data.data[0];
            const result = {
                poster: media.images?.large || media.images?.common || null,
                score: media.rating?.score || null,
                title: media.name_cn || media.name || animeName
            };

            // Only cache if we actually found a poster URL
            if (result.poster) {
                setCachedData(animeName, result);
            }
            return result;
        } else {
            // Found nothing on Bangumi: don't cache to allow future retries
            return { poster: null, score: null, title: animeName };
        }
    }

    // ===================== GLOBAL STYLES =====================
    injectCSS(`
        /* ===== Variables & Core ===== */
        :root {
            --ae-primary: #8b5cf6;
            --ae-primary-rgb: 139, 92, 246;
            --ae-primary-grad: linear-gradient(135deg, #7c3aed, #a855f7);
            --ae-gold: #fbbf24;
            --ae-gold-rgb: 251, 191, 36;
            --ae-success-rgb: 16, 185, 129;
            --ae-danger-rgb: 239, 68, 68;
            --ae-bg-base: #0b0b16;
            --ae-bg-panel: linear-gradient(135deg, rgba(15,12,41,0.98), rgba(36,36,62,0.96));
            --ae-bg-surface: rgba(255,255,255,0.04);
            --ae-bg-hover: rgba(255,255,255,0.08);
            --ae-bg-input: rgba(30,41,59,0.4);
            --ae-border-light: rgba(255,255,255,0.08);
            --ae-border-primary: rgba(139,92,246,0.3);
            --ae-text-primary: rgba(255,255,255,0.92);
            --ae-text-secondary: rgba(255,255,255,0.7);
            --ae-text-muted: rgba(255,255,255,0.45);
        }

        /* ===== Layout Utility ===== */
        .ae-flex-center { display: flex; align-items: center; justify-content: center; }
        .ae-flex-row { display: flex; align-items: center; gap: 8px; }

        body, #page, #content, .site-content, #primary, #main {
            font-family: 'Noto Sans TC', sans-serif !important;
            background: var(--ae-bg-base) !important;
            min-height: 100vh;
        }

        /* Hide ads & default UI */
        #ad-1, #ad-2, #ad-3, #ad-4, #ad-5, .sidebar-discord, [id^="ad-"] > a > img,
        #site-navigation, .main-navigation, #primary-menu,
        #colophon .site-info, #colophon .social-url, .darkmode-control, #colophon .scroll-top:not(#ae-scroll-top-btn-cloned) {
            display: none !important;
        }

        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(var(--ae-primary-rgb),0.4); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(var(--ae-primary-rgb),0.6); }



        /* Footer reset */
        #colophon { background: transparent !important; border: none !important; padding: 0 !important; }

        /* Common FAB Button */
        .ae-settings-fab {
            position: fixed !important; right: 18px !important; z-index: 9999 !important;
            width: 44px !important; height: 44px !important; border-radius: 999px !important;
            color: #f8fafc !important; cursor: pointer !important; text-decoration: none !important;
            background: radial-gradient(circle at 28% 22%, rgba(196,181,253,0.35), rgba(124,58,237,0.42) 46%, rgba(15,23,42,0.84) 100%) !important;
            border: 1px solid rgba(196,181,253,0.42) !important;
            box-shadow: 0 10px 24px rgba(76,29,149,0.36), inset 0 1px 0 rgba(255,255,255,0.16) !important;
            backdrop-filter: blur(10px) saturate(1.1) !important;
            transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease !important;
            display: inline-flex; align-items: center; justify-content: center;
        }
        .ae-settings-fab:hover { transform: scale(1.04) !important; }
        .ae-page-jump-ball:hover { transform: translateY(-50%) scale(1.04) !important; }
        .ae-settings-fab:hover, .ae-page-jump-ball:hover {
            border-color: rgba(216,180,254,0.7) !important;
            box-shadow: 0 14px 30px rgba(109,40,217,0.45), inset 0 1px 0 rgba(255,255,255,0.24) !important;
        }
        #ae-settings-btn { bottom: 74px !important; }
        #ae-scroll-top-btn-cloned { bottom: 18px !important; }
        #ae-scroll-top-btn-cloned *, #ae-scroll-top-btn-cloned { color: #f8fafc !important; fill: #f8fafc !important; display: inline-flex !important; }
        #ae-settings-btn.ae-settings-fab > span { display: none !important; }
        #ae-settings-btn.ae-settings-fab .inline-svg { width: 17px !important; height: 17px !important; margin: 0 !important; fill: currentColor !important; }

        /* Common Modal Overlay & Panel */
        .ae-modal-overlay {
            position: fixed; inset: 0; z-index: 2147483647; background: rgba(2, 6, 23, 0.72);
            backdrop-filter: blur(4px); padding: 16px; display: flex; align-items: center; justify-content: center;
        }
        .ae-modal-panel {
            width: min(640px, 100%); background: var(--ae-bg-panel); border: 1px solid var(--ae-border-primary);
            border-radius: 16px; box-shadow: 0 22px 52px rgba(0,0,0,0.55); padding: 18px; color: var(--ae-text-primary); position: relative;
        }
        .ae-modal-title { margin: 0 0 8px !important; font-size: 22px !important; font-weight: 700 !important; color: #ddd6fe !important; }
        .ae-modal-tip, .ae-modal-status, .ae-modal-steps { color: var(--ae-text-secondary); font-size: 13px; margin: 0 0 10px; line-height:1.6; }
        .ae-modal-steps a { color: var(--ae-primary); text-decoration: underline; }
        .ae-meta-sub { font-size: 11px; color: rgba(255,255,255,0.35); }

        /* Form Controls */
        .ae-modal-field input, .ae-fav-rename-input {
            width: 100%; height: 38px; border-radius: 10px; border: 1px solid var(--ae-border-primary);
            background: var(--ae-bg-input); color: var(--ae-text-primary); padding: 0 12px; outline: none; font-family: inherit;
        }
        .ae-modal-field input:focus, .ae-fav-rename-input:focus { border-color: var(--ae-primary); box-shadow: 0 0 0 3px rgba(var(--ae-primary-rgb), 0.2); }
        .ae-modal-btn { height: 36px; border-radius: 10px; border: 1px solid transparent; padding: 0 12px; font-weight: 600; cursor: pointer; transition: 0.2s; background: rgba(30,41,59,0.48); color: var(--ae-text-primary); }
        .ae-modal-btn-primary { background: var(--ae-primary-grad); color: #fff; }
        .ae-modal-btn-primary:hover { filter: brightness(1.1); }
        .ae-modal-btn:hover { background: rgba(51,65,85,0.7); }
        .ae-modal-close { position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; border-radius: 50%; border: 1px solid rgba(148,163,184,0.45); background: rgba(30,41,59,0.52); color: var(--ae-text-primary); cursor: pointer; font-size: 19px; display: inline-flex; align-items: center; justify-content: center; }

        /* Generic shared lists */
        .ae-fav-cat-list, .ae-fav-manage-list { max-height: 300px; overflow-y: auto; margin-bottom: 14px; display: flex; flex-direction: column; gap: 4px; }
        .ae-fav-cat-item, .ae-fav-manage-item { padding: 10px 14px; border-radius: 10px; background: var(--ae-bg-surface); border: 1px solid var(--ae-border-light); display: flex; align-items: center; gap: 10px; transition: 0.2s; cursor: pointer; }
        .ae-fav-cat-item:hover, .ae-fav-manage-item:hover { background: var(--ae-bg-hover); border-color: rgba(var(--ae-gold-rgb), 0.3); }
        .ae-fav-cat-label, .ae-fav-manage-name { flex: 1; font-size: 14px; }
        .ae-fav-cat-check { accent-color: var(--ae-gold); width: 16px; height: 16px; cursor: pointer; }
        .ae-fav-manage-count { font-size: 12px; color: var(--ae-text-muted); }
        .ae-fav-act-btn { width: 30px; height: 30px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.3); background: rgba(30,41,59,0.5); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }

        .ae-fav-star {
            position: absolute; bottom: 8px; right: 8px; width: 32px; height: 32px; border-radius: 50%;
            background: rgba(0,0,0,0.55); backdrop-filter: blur(8px); color: rgba(255,255,255,0.5); border: none; z-index: 3;
            display: inline-flex; align-items: center; justify-content: center; transition: 0.25s; cursor: pointer;
        }
        .ae-fav-star svg { fill: none; stroke: currentColor; stroke-width: 1.8; transition: 0.25s; }
        .ae-fav-star:hover, .ae-fav-star.is-favorited { color: var(--ae-gold); background: rgba(0,0,0,0.75); }
        .ae-fav-star:hover svg, .ae-fav-star.is-favorited svg { fill: currentColor; stroke: currentColor; }

        /* Unified Shortcut Help Styles */
        .ae-modal-shortcuts { margin-top:16px; border-top:1px solid var(--ae-border-light); padding-top:12px; }
        .ae-modal-shortcuts h3 { font-size:14px; color:#ddd6fe; margin-bottom:10px; font-weight:600; }
        .ae-modal-shortcuts ul { font-size:12px; color:var(--ae-text-secondary); list-style:none; padding:0; margin:0; line-height:2.0; }
        .ae-modal-shortcuts b { color:var(--ae-primary); font-weight:700; width:65px; display:inline-block; font-family: inherit; }

        /* Global Toast */
        .ae-toast {
            position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%) translateY(20px);
            padding: 10px 24px; border-radius: 999px; font-size: 14px; font-weight: 600;
            background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(12px);
            border: 1px solid rgba(var(--ae-primary-rgb), 0.45); color: #fff;
            box-shadow: 0 15px 45px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1);
            z-index: 2147483647; pointer-events: none; opacity: 0;
            transition: all 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
            display: flex; align-items: center; gap: 10px;
        }
        .ae-toast.is-visible { opacity: 1; transform: translateX(-50%) translateY(0); }
        .ae-toast-icon { display: flex; align-items: center; color: var(--ae-primary); }

        /* Fullscreen Support: Must be inside the element that requests fullscreen (the .video-js div) */
        .video-js .ae-toast { position: absolute; bottom: 85px; z-index: 2147483647 !important; }
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
                    <button class="ae-pill" data-filter="continue">继续观看</button>
                    <button class="ae-pill" data-filter="favorites">⭐ 收藏夾</button>
                    <button class="ae-pill" data-filter="airing">連載中</button>
                    <button class="ae-pill" data-filter="completed">已完結</button>
                    <div class="ae-season-filters" id="ae-season-filters"></div>
                </div>
                <div class="ae-fav-panel" id="ae-fav-panel" style="display:none;">
                    <div class="ae-fav-tabs" id="ae-fav-tabs"></div>
                    <button type="button" class="ae-fav-manage-btn" id="ae-fav-manage-btn">分類管理</button>
                </div>
            </div>
            <div class="ae-grid" id="ae-grid"></div>
            <div class="ae-infinite-status" id="ae-infinite-status"></div>
            <div class="ae-scroll-sentinel" id="ae-scroll-sentinel" aria-hidden="true"></div>
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
        const statusEl = document.getElementById('ae-infinite-status');
        const sentinelEl = document.getElementById('ae-scroll-sentinel');
        const batchSize = 24;
        let pageInputEl = null;
        let filteredList = [...animeList];
        let currentFilter = 'all';
        let currentSeason = '';
        let currentFavCategory = '';
        let continueMetaByCat = new Map();
        let renderCursor = 0;
        let loadingMore = false;

        function ensurePageJumpBall() {
            let ball = document.getElementById('ae-page-jump-ball');
            if (!ball) {
                ball = document.createElement('div');
                ball.id = 'ae-page-jump-ball';
                ball.className = 'ae-page-jump-ball';
                ball.innerHTML = `
                    <input id="ae-page-jump-input" class="ae-page-jump-input" type="text" inputmode="numeric" value="1" aria-label="跳转页码">
                `;
                document.body.appendChild(ball);
            }
            pageInputEl = ball.querySelector('#ae-page-jump-input');
        }

        function getTotalPages() {
            return Math.max(1, Math.ceil(filteredList.length / batchSize));
        }

        function getCurrentPageByScroll() {
            if (!grid) return 1;
            const cards = grid.querySelectorAll('.ae-card');
            if (!cards.length) return 1;
            const pivot = 90;
            for (const card of cards) {
                const rect = card.getBoundingClientRect();
                if (rect.bottom > pivot) {
                    const idx = parseInt(card.dataset.index || '0', 10);
                    if (Number.isFinite(idx)) return Math.floor(idx / batchSize) + 1;
                    break;
                }
            }
            return Math.max(1, Math.ceil(renderCursor / batchSize));
        }

        function syncPageJumpBall(force = false) {
            if (!pageInputEl) return;
            const totalPages = getTotalPages();
            if (!force && document.activeElement === pageInputEl) return;
            pageInputEl.value = String(Math.min(getCurrentPageByScroll(), totalPages));
        }

        function jumpToPage(pageNumber) {
            const totalPages = getTotalPages();
            const targetPage = Math.min(totalPages, Math.max(1, pageNumber));
            while (renderCursor < targetPage * batchSize) {
                renderNextBatch();
                if (loadingMore) break;
            }
            const startIndex = (targetPage - 1) * batchSize;
            requestAnimationFrame(() => {
                const card = grid.querySelector(`.ae-card[data-index="${startIndex}"]`);
                if (card) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                syncPageJumpBall(true);
            });
        }

        function filterAndRender() {
            clearApiQueue();
            const watchMap = getWatchProgressMap();
            continueMetaByCat = new Map();
            const query = document.getElementById('ae-search-input')?.value?.toLowerCase() || '';
            filteredList = animeList.filter(a => {
                const progress = getWatchProgressForAnime(a, watchMap);
                if (progress) continueMetaByCat.set(a.catId, progress);
                const matchesSearch = !query || a.name.toLowerCase().includes(query);
                const matchesFilter = currentFilter === 'all' ||
                    (currentFilter === 'continue' && !!progress) ||
                    (currentFilter === 'favorites' && isAnimeFavorited(a.catId) && (!currentFavCategory || getAnimeFavoriteCategories(a.catId).includes(currentFavCategory))) ||
                    (currentFilter === 'airing' && a.episodes.includes('連載中')) ||
                    (currentFilter === 'completed' && !a.episodes.includes('連載中'));
                const matchesSeason = !currentSeason || `${a.year}年${a.season}季` === currentSeason;
                return matchesSearch && matchesFilter && matchesSeason;
            });
            if (currentFilter === 'continue') {
                filteredList.sort((a, b) => {
                    const ta = continueMetaByCat.get(a.catId)?.updatedAt || 0;
                    const tb = continueMetaByCat.get(b.catId)?.updatedAt || 0;
                    return tb - ta;
                });
            }
            document.getElementById('ae-visible-count').textContent = filteredList.length;
            renderCursor = 0;
            grid.innerHTML = '';
            updateStatus();
            renderNextBatch();
            syncPageJumpBall(true);
            refreshFavoritesPanel();
            setupFavDragDrop();
        }

        function updateStatus() {
            if (!statusEl) return;
            if (filteredList.length === 0) {
                statusEl.textContent = '沒有符合條件的動畫';
                return;
            }
            if (loadingMore) {
                statusEl.textContent = '正在載入更多動畫...';
                return;
            }
            if (renderCursor >= filteredList.length) {
                statusEl.textContent = `已載入全部 ${filteredList.length} 部動畫`;
                return;
            }
            statusEl.textContent = '向下捲動以載入更多';
        }

        function renderNextBatch() {
            if (loadingMore || renderCursor >= filteredList.length) {
                updateStatus();
                return;
            }
            loadingMore = true;
            updateStatus();

            const start = renderCursor;
            const batchItems = filteredList.slice(start, start + batchSize);
            const frag = document.createDocumentFragment();

            batchItems.forEach((anime, idx) => {
                frag.appendChild(createCard(anime, start + idx));
            });
            grid.appendChild(frag);

            batchItems.forEach((anime, idx) => {
                const cardKey = `${anime.catId}-${start + idx}`;
                loadCover(anime, cardKey);
            });

            renderCursor += batchItems.length;
            loadingMore = false;
            updateStatus();
            syncPageJumpBall();
        }

        function createCard(anime, index) {
            const card = document.createElement('a');
            const cardKey = `${anime.catId}-${index}`;
            card.href = anime.url;
            card.className = 'ae-card';
            card.dataset.index = index;
            card.dataset.cardKey = cardKey;
            card.style.animationDelay = `${(index % batchSize) * 0.03}s`;

            const isAiring = anime.episodes.includes('連載中');
            const epMatch = anime.episodes.match(/\((\d+)\)/) || anime.episodes.match(/^(\d[\d-]*)$/);
            const epText = epMatch ? epMatch[1] : anime.episodes;
            const progress = continueMetaByCat.get(anime.catId);
            const progressText = progress?.lastEpisode
                ? `上次觀看到 EP ${String(progress.lastEpisode).padStart(2, '0')}`
                : (progress?.lastEpisodeLabel ? `上次觀看到 ${progress.lastEpisodeLabel}` : '');

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
                    <span class="ae-badge ae-badge-score" style="display:none;"></span>
                    ${progressText ? `<span class="ae-badge ae-badge-progress">${progressText}</span>` : ''}
                    ${(progressText && currentFilter === 'continue') ? '<button type="button" class="ae-progress-delete" title="刪除觀看記錄" aria-label="刪除觀看記錄">×</button>' : ''}
                    ${currentFilter === 'favorites' ? `<button type="button" class="ae-progress-delete ae-fav-delete" title="取消收藏" aria-label="取消收藏" data-cat-id="${anime.catId}">×</button>` : ''}
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

        async function loadCover(anime, cardKey) {
            const card = grid.querySelector(`.ae-card[data-card-key="${cardKey}"]`);
            if (!card) return;
            const img = card.querySelector('.ae-card-img');
            const placeholder = card.querySelector('.ae-card-poster-placeholder');
            const scoreBadge = card.querySelector('.ae-badge-score');

            const data = await searchBangumi(anime.name, anime.year);

            if (data) {
                // Show Rating if available
                if (data.score && scoreBadge) {
                    const scoreValue = typeof data.score === 'number' ? data.score.toFixed(1) : data.score;
                    scoreBadge.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${scoreValue}`;
                    scoreBadge.style.display = 'flex';
                }

                if (data.poster) {
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
                            responseType: 'arraybuffer',
                            headers: { 'User-Agent': BGM_USER_AGENT },
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
                                        showImage(dataUrl);
                                    } catch (e) { console.error('[Anime1 Enhancer] Failed to convert image:', e); }
                                }
                            }
                        });
                    };

                    img.referrerPolicy = 'no-referrer';
                    img.onerror = () => { gmFallback(); img.onerror = null; };
                    showImage(data.poster);
                }
            }
        }

        // Events
        document.getElementById('ae-search-input')?.addEventListener('input', debounce(filterAndRender, 300));
        document.querySelectorAll('.ae-pill:not(.ae-pill-season)').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.ae-pill:not(.ae-pill-season)').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                currentFilter = pill.dataset.filter;
                if (currentFilter !== 'favorites') currentFavCategory = '';
                filterAndRender();
            });
        });
        document.getElementById('ae-fav-manage-btn')?.addEventListener('click', () => {
            openFavManageModal(() => { filterAndRender(); });
        });
        grid.addEventListener('click', (event) => {
            // Delete favorite click (when in favorites filter)
            const favDelBtn = event.target.closest('.ae-fav-delete');
            if (favDelBtn) {
                event.preventDefault();
                event.stopPropagation();
                const card = favDelBtn.closest('.ae-card');
                if (!card) return;
                const index = Number(card.dataset.index);
                const anime = Number.isFinite(index) ? filteredList[index] : null;
                if (!anime) return;
                if (confirm(`確定要取消收藏「${anime.name}」吗？`)) {
                    deleteFavoriteAnime(anime.catId);
                    filterAndRender();
                }
                return;
            }
            // Delete progress click
            const btn = event.target.closest('.ae-progress-delete');
            if (!btn) return;
            event.preventDefault();
            event.stopPropagation();
            const card = btn.closest('.ae-card');
            if (!card) return;
            const index = Number(card.dataset.index);
            const anime = Number.isFinite(index) ? filteredList[index] : null;
            if (!anime) return;
            const ok = confirm(`確定要刪除「${anime.name}」的觀看記錄嗎？`);
            if (!ok) return;
            deleteWatchProgressForAnime({ catId: anime.catId, animeName: anime.name });
            filterAndRender();
        });

        if ('IntersectionObserver' in window && sentinelEl) {
            const loadObserver = new IntersectionObserver((entries) => {
                const shouldLoad = entries.some(entry => entry.isIntersecting);
                if (shouldLoad) renderNextBatch();
            }, { root: null, rootMargin: '800px 0px', threshold: 0 });
            loadObserver.observe(sentinelEl);
        } else {
            window.addEventListener('scroll', debounce(() => {
                if (!sentinelEl) return;
                const rect = sentinelEl.getBoundingClientRect();
                if (rect.top < window.innerHeight + 800) renderNextBatch();
            }, 100));
        }

        ensurePageJumpBall();
        if (pageInputEl) {
            pageInputEl.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const raw = (pageInputEl.value || '').trim();
                const page = parseInt(raw, 10);
                if (!Number.isFinite(page)) {
                    syncPageJumpBall(true);
                    return;
                }
                jumpToPage(page);
            });
            pageInputEl.addEventListener('blur', () => syncPageJumpBall(true));
        }
        window.addEventListener('scroll', debounce(() => syncPageJumpBall(), 80));

        function refreshFavoritesPanel() {
            const panel = document.getElementById('ae-fav-panel');
            if (!panel) return;
            if (currentFilter !== 'favorites') {
                panel.style.display = 'none';
                return;
            }
            panel.style.display = '';
            const tabsContainer = document.getElementById('ae-fav-tabs');
            if (!tabsContainer) return;
            tabsContainer.innerHTML = '';
            const data = getFavoritesData();

            // "All" tab
            const allTab = document.createElement('button');
            allTab.type = 'button';
            allTab.className = 'ae-fav-cat-tab' + (!currentFavCategory ? ' active' : '');
            allTab.textContent = '全部';
            allTab.addEventListener('click', () => { currentFavCategory = ''; filterAndRender(); });
            allTab.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; allTab.classList.add('ae-drag-over'); });
            allTab.addEventListener('dragleave', () => allTab.classList.remove('ae-drag-over'));
            allTab.addEventListener('drop', e => { e.preventDefault(); allTab.classList.remove('ae-drag-over'); });
            tabsContainer.appendChild(allTab);

            data.categories.forEach(cat => {
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.className = 'ae-fav-cat-tab' + (currentFavCategory === cat.id ? ' active' : '');
                tab.dataset.catId = cat.id;
                const count = Object.values(data.items).filter(arr => arr.includes(cat.id)).length;
                tab.textContent = `${cat.name} (${count})`;
                tab.addEventListener('click', () => { currentFavCategory = (currentFavCategory === cat.id) ? '' : cat.id; filterAndRender(); });

                // Drop target for drag
                tab.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tab.classList.add('ae-drag-over'); });
                tab.addEventListener('dragleave', () => tab.classList.remove('ae-drag-over'));
                tab.addEventListener('drop', e => {
                    e.preventDefault();
                    tab.classList.remove('ae-drag-over');
                    try {
                        const info = JSON.parse(e.dataTransfer.getData('text/plain'));
                        if (info.catId && info.fromCategory && cat.id !== info.fromCategory) {
                            moveAnimeToCategory(info.catId, info.fromCategory, cat.id);
                            filterAndRender();
                        }
                    } catch { /* ignore */ }
                });
                tabsContainer.appendChild(tab);
            });
        }

        function setupFavDragDrop() {
            if (currentFilter !== 'favorites' || !currentFavCategory) {
                grid.querySelectorAll('.ae-card').forEach(c => { c.draggable = false; c.classList.remove('ae-draggable'); });
                return;
            }
            grid.querySelectorAll('.ae-card').forEach(card => {
                card.draggable = true;
                card.classList.add('ae-draggable');
            });

            // Only bind once
            if (!grid.dataset.favDragBound) {
                grid.dataset.favDragBound = '1';
                grid.addEventListener('dragstart', e => {
                    const card = e.target.closest('.ae-card');
                    if (!card) return;
                    const star = card.querySelector('.ae-fav-star');
                    if (!star) return;
                    e.dataTransfer.setData('text/plain', JSON.stringify({
                        catId: parseInt(star.dataset.catId, 10),
                        animeName: star.dataset.animeName,
                        fromCategory: currentFavCategory
                    }));
                    e.dataTransfer.effectAllowed = 'move';
                    card.classList.add('ae-dragging');
                });
                grid.addEventListener('dragend', e => {
                    const card = e.target.closest('.ae-card');
                    if (card) card.classList.remove('ae-dragging');
                    document.querySelectorAll('.ae-fav-cat-tab').forEach(t => t.classList.remove('ae-drag-over'));
                });
            }
        }

        filterAndRender();
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

    function updateCardFavoriteStar(catId) {
        document.querySelectorAll(`.ae-fav-star[data-cat-id="${catId}"]`).forEach(star => {
            const isFav = isAnimeFavorited(catId);
            star.classList.toggle('is-favorited', isFav);
            star.title = isFav ? '已收藏' : '收藏';
        });
        const playBtn = document.getElementById('ap-fav-btn');
        if (playBtn && parseInt(playBtn.dataset.catId, 10) === catId) {
            const isFav = isAnimeFavorited(catId);
            playBtn.classList.toggle('is-favorited', isFav);
            const textEl = playBtn.querySelector('.ap-fav-text');
            if (textEl) textEl.textContent = isFav ? '取消收藏' : '加入收藏';
        }
    }

    function openFavoritesModal(anime) {
        const key = `cat:${anime.catId}`;
        const buildCatList = () => {
            const d = getFavoritesData(); const checked = d.items[key] || [];
            return d.categories.map(c => `
                <label class="ae-fav-cat-item">
                    <input type="checkbox" class="ae-fav-cat-check" data-cat-id="${c.id}" ${checked.includes(c.id) ? 'checked' : ''}>
                    <span class="ae-fav-cat-label">${c.name}</span>${c.isDefault ? '<span class="ae-fav-cat-badge">默認</span>' : ''}
                </label>`).join('');
        };
        createBaseModal({
            id: 'ae-fav-modal', width: 420,
            title: `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#fbbf24" stroke="#fbbf24" stroke-width="1"/></svg>收藏 — ${anime.name}`,
            content: `<div class="ae-fav-cat-list" id="ae-fav-cat-list">${buildCatList()}</div>`,
            onActionHTML: `<button type="button" id="ae-fav-add-cat-btn" class="ae-modal-btn ae-modal-btn-ghost">新增</button>
                           <button type="button" id="ae-fav-save-btn" class="ae-modal-btn ae-modal-btn-primary">保存</button>`,
            onActionClick: (overlay, close) => {
                overlay.querySelector('#ae-fav-save-btn').addEventListener('click', close);
                overlay.querySelector('#ae-fav-cat-list').addEventListener('change', e => {
                    const check = e.target.closest('.ae-fav-cat-check'); if (!check) return;
                    toggleAnimeInCategory(anime.catId, anime.name, check.dataset.catId);
                    updateCardFavoriteStar(anime.catId);
                });
                overlay.querySelector('#ae-fav-add-cat-btn').addEventListener('click', () => {
                    const listEl = overlay.querySelector('#ae-fav-cat-list'); if (listEl.querySelector('.ae-fav-inline-add')) return;
                    const addRow = document.createElement('div'); addRow.className = 'ae-fav-cat-item ae-fav-inline-add'; addRow.style.padding = '6px 12px';
                    addRow.innerHTML = `<input type="text" class="ae-fav-rename-input ae-inline-add-input" placeholder="新增分類名稱..." maxlength="30" style="flex:1;">
                        <button type="button" class="ae-fav-act-btn ae-fav-confirm-add-btn" title="确认" style="flex-shrink:0;">✓</button>
                        <button type="button" class="ae-fav-act-btn ae-fav-cancel-add-btn" title="取消" style="flex-shrink:0;">✗</button>`;
                    listEl.appendChild(addRow); const input = addRow.querySelector('input'); input.focus();
                    const doAdd = () => { const name = input.value.trim(); if (name) addFavoriteCategory(name); listEl.innerHTML = buildCatList(); };
                    addRow.querySelector('.ae-fav-confirm-add-btn').addEventListener('click', doAdd);
                    addRow.querySelector('.ae-fav-cancel-add-btn').addEventListener('click', () => listEl.innerHTML = buildCatList());
                    input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); if (e.key === 'Escape') listEl.innerHTML = buildCatList(); });
                    listEl.scrollTop = listEl.scrollHeight;
                });
            }
        });
    }

    function openFavManageModal(onClose) {
        const buildList = () => {
            const d = getFavoritesData();
            return d.categories.map(c => {
                const count = Object.values(d.items).filter(arr => arr.includes(c.id)).length;
                return `<div class="ae-fav-manage-item" data-cat-id="${c.id}"><span class="ae-fav-manage-name">${c.name}</span><span class="ae-fav-manage-count">${count} 部</span>
                        <div class="ae-fav-manage-actions">${c.isDefault ? '<span class="ae-fav-manage-default">系統默認</span>' : `<button type="button" class="ae-fav-act-btn ae-fav-rename-btn" data-cat-id="${c.id}" title="重命名">✏️</button><button type="button" class="ae-fav-act-btn ae-fav-delete-btn" data-cat-id="${c.id}" title="刪除">🗑️</button>`}</div>
                    </div>`;
            }).join('');
        };
        createBaseModal({
            id: 'ae-fav-manage-modal', width: 480, title: '管理收藏分類',
            content: `<div class="ae-fav-manage-list" id="ae-fav-manage-list">${buildList()}</div>`,
            onActionHTML: `<button type="button" id="ae-fav-manage-add-btn" class="ae-modal-btn ae-modal-btn-ghost">新增</button>
                           <button type="button" id="ae-fav-manage-save-btn" class="ae-modal-btn ae-modal-btn-primary">保存</button>`,
            onActionClick: (overlay, close) => {
                const origClose = close;
                close = () => { origClose(); if (typeof onClose === 'function') onClose(); };
                overlay.querySelector('.ae-modal-close').addEventListener('click', close);
                overlay.querySelector('#ae-fav-manage-save-btn').addEventListener('click', close);
                const listEl = overlay.querySelector('#ae-fav-manage-list');
                listEl.addEventListener('click', e => {
                    const delBtn = e.target.closest('.ae-fav-delete-btn'), renBtn = e.target.closest('.ae-fav-rename-btn');
                    if (delBtn) {
                        const cId = delBtn.dataset.catId, d = getFavoritesData(), cat = d.categories.find(c => c.id === cId), count = Object.values(d.items).filter(arr => arr.includes(cId)).length;
                        if (confirm(`確定要刪除分类「${cat?.name || ''}」嗎？\n將同時刪除該分類下的 ${count} 部收藏。`)) { deleteFavoriteCategory(cId); listEl.innerHTML = buildList(); }
                    } else if (renBtn) {
                        const cId = renBtn.dataset.catId, item = listEl.querySelector(`.ae-fav-manage-item[data-cat-id="${cId}"]`), nameEl = item?.querySelector('.ae-fav-manage-name');
                        if (!nameEl) return;
                        const cur = nameEl.textContent, input = document.createElement('input'); input.type = 'text'; input.value = cur; input.className = 'ae-fav-rename-input';
                        nameEl.replaceWith(input); input.focus(); input.select();
                        const finish = () => { const n = input.value.trim(); if (n && n !== cur) renameFavoriteCategory(cId, n); listEl.innerHTML = buildList(); };
                        input.addEventListener('blur', finish); input.addEventListener('keydown', ev => { if (ev.key === 'Enter') finish(); if (ev.key === 'Escape') listEl.innerHTML = buildList(); });
                    }
                });
                overlay.querySelector('#ae-fav-manage-add-btn').addEventListener('click', () => {
                    if (listEl.querySelector('.ae-fav-inline-add')) return;
                    const addRow = document.createElement('div'); addRow.className = 'ae-fav-manage-item ae-fav-inline-add'; addRow.style.padding = '6px 14px';
                    addRow.innerHTML = `<input type="text" class="ae-fav-rename-input ae-inline-add-input" placeholder="新增分类名称..." maxlength="30" style="flex:1;">
                        <div class="ae-fav-manage-actions" style="flex-shrink:0;"><button type="button" class="ae-fav-act-btn ae-fav-confirm-add-btn" title="确认">✓</button><button type="button" class="ae-fav-act-btn ae-fav-cancel-add-btn" title="取消">✗</button></div>`;
                    listEl.appendChild(addRow); const input = addRow.querySelector('input'); input.focus();
                    const doAdd = () => { const name = input.value.trim(); if (name) addFavoriteCategory(name); listEl.innerHTML = buildList(); };
                    addRow.querySelector('.ae-fav-confirm-add-btn').addEventListener('click', doAdd);
                    addRow.querySelector('.ae-fav-cancel-add-btn').addEventListener('click', () => listEl.innerHTML = buildList());
                    input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); if (e.key === 'Escape') listEl.innerHTML = buildList(); });
                    listEl.scrollTop = listEl.scrollHeight;
                });
            }
        });
    }

    const HOMEPAGE_CSS = `
        #masthead, .entry-header { display: none !important; }

        /* Jump Ball */
        .ae-page-jump-ball {
            position: fixed; right: 14px; top: 50%; transform: translateY(-50%); z-index: 9999;
            width: 44px; height: 44px; border-radius: 50%;
            background: radial-gradient(circle at 28% 22%, rgba(196,181,253,0.35), rgba(124,58,237,0.42) 46%, rgba(15,23,42,0.84) 100%);
            border: 1px solid rgba(196,181,253,0.42);
            box-shadow: 0 10px 24px rgba(76,29,149,0.36), inset 0 1px 0 rgba(255,255,255,0.16);
            backdrop-filter: blur(10px) saturate(1.1); transition: 0.2s;
            display: flex; align-items: center; justify-content: center;
        }
        .ae-page-jump-input {
            width: 100% !important; height: 100% !important; border: none !important; background: transparent !important;
            color: #fff !important; text-align: center !important; font-size: 14px !important; font-weight: 700 !important;
            outline: none !important; padding: 0 !important; text-shadow: 0 1px 2px rgba(15,23,42,0.75);
        }

        /* Loading */
        .ae-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 20px; color: var(--ae-text-secondary); }
        .ae-spinner { width: 40px; height: 40px; border: 3px solid rgba(var(--ae-primary-rgb),0.2); border-top-color: var(--ae-primary); border-radius: 50%; animation: ae-spin 0.8s linear infinite; margin-bottom: 16px; }
        @keyframes ae-spin { to { transform: rotate(360deg); } }

        /* Search & Filters */
        .ae-search-section { margin-bottom: 28px; }
        .ae-search-wrapper {
            display: flex; align-items: center; background: var(--ae-bg-surface); border: 1px solid var(--ae-border-primary);
            border-radius: 16px; padding: 0 20px; transition: 0.3s; backdrop-filter: blur(12px);
        }
        .ae-search-wrapper:focus-within { border-color: rgba(var(--ae-primary-rgb),0.6); box-shadow: 0 0 0 3px rgba(var(--ae-primary-rgb),0.15); background: var(--ae-bg-hover); }
        .ae-search-icon { width: 20px; color: var(--ae-primary); }
        #ae-search-input { flex: 1; background: none!important; border: none!important; outline: none!important; padding: 16px 14px!important; font-size: 15px!important; color: inherit!important; font-family: inherit!important; }
        #ae-search-input::placeholder { color: var(--ae-text-muted); }

        .ae-filter-pills { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; align-items: center; }
        .ae-pill {
            padding: 7px 18px; border-radius: 20px; border: 1px solid rgba(var(--ae-primary-rgb),0.25);
            background: rgba(var(--ae-primary-rgb),0.08); color: var(--ae-text-secondary); font-size: 13px; cursor: pointer; transition: 0.25s;
        }
        .ae-pill:hover { background: rgba(var(--ae-primary-rgb),0.2); }
        .ae-pill.active { background: var(--ae-primary-grad); border-color: transparent; color: #fff; box-shadow: 0 4px 15px rgba(var(--ae-primary-rgb),0.35); }
        .ae-pill[data-filter="continue"] { border-color: rgba(var(--ae-success-rgb),0.46); background: rgba(var(--ae-success-rgb),0.16); color: #bbf7d0; }
        .ae-pill[data-filter="favorites"] { border-color: rgba(var(--ae-gold-rgb),0.4); background: rgba(var(--ae-gold-rgb),0.1); color: var(--ae-gold); }

        /* Favorites Panel */
        .ae-fav-panel { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; padding: 10px 14px; background: rgba(var(--ae-gold-rgb),0.06); border: 1px solid rgba(var(--ae-gold-rgb),0.18); border-radius: 12px; }
        .ae-fav-tabs { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }
        .ae-fav-cat-tab { padding: 5px 14px; border-radius: 16px; border: 1px solid rgba(var(--ae-gold-rgb),0.2); background: rgba(var(--ae-gold-rgb),0.06); color: var(--ae-text-secondary); font-size: 12px; cursor: pointer; transition: 0.2s; white-space: nowrap; }
        .ae-fav-cat-tab:hover { background: rgba(var(--ae-gold-rgb),0.15); }
        .ae-fav-cat-tab.active { background: var(--ae-gold-grad); color: #fff; border-color: transparent; box-shadow: 0 3px 12px rgba(var(--ae-gold-rgb),0.3); }
        .ae-fav-manage-btn { padding: 5px 14px; border-radius: 16px; border: 1px solid rgba(148,163,184,0.35); background: rgba(30,41,59,0.5); color: var(--ae-text-secondary); font-size: 12px; cursor: pointer; transition: 0.2s; }

        /* Grid */
        .ae-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; }
        @media (max-width: 480px) { .ae-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; } }

        /* Card */
        .ae-card {
            display: flex; flex-direction: column; border-radius: 14px; overflow: hidden;
            background: var(--ae-bg-surface); border: 1px solid var(--ae-border-light);
            text-decoration: none!important; color: inherit!important;
            transition: 0.35s cubic-bezier(0.4,0,0.2,1); opacity: 0; animation: ae-fadeUp 0.5s ease forwards;
        }
        @keyframes ae-fadeUp { from { transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .ae-card:hover { transform: translateY(-6px) scale(1.02); box-shadow: 0 20px 40px rgba(var(--ae-primary-rgb),0.2); border-color: rgba(var(--ae-primary-rgb),0.4); }

        .ae-card-poster { position: relative; width: 100%; padding-top: 142%; background: linear-gradient(145deg, #1a1040, #0d0a1a); }
        .ae-card-poster-placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 0; }
        .ae-card-poster-placeholder svg { width: 40px; height: 40px; color: rgba(var(--ae-primary-rgb),0.25); }
        .ae-card-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: transform 0.5s, opacity 0.4s; z-index: 1; }
        .ae-card-img.ae-loaded { opacity: 1; }
        .ae-card:hover .ae-card-img { transform: scale(1.08); }

        /* Badges */
        .ae-badge { 
            position: absolute; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 8px; z-index: 2; 
            backdrop-filter: blur(14px) saturate(1.2); border: 1px solid rgba(255,255,255,0.18); 
            box-shadow: 0 4px 15px rgba(0,0,0,0.35);
        }
        .ae-badge-airing { top: 8px; left: 8px; background: rgba(var(--ae-success-rgb),0.72); color: #fff; }
        .ae-badge-done { top: 8px; left: 8px; background: rgba(107,114,128,0.68); color: #e5e7eb; }
        .ae-badge-ep { bottom: 8px; left: 8px; background: rgba(var(--ae-primary-rgb),0.72); color: #fff; }
        .ae-badge-score { 
            bottom: 8px; right: 8px; 
            background: linear-gradient(135deg, rgba(245, 158, 11, 0.82), rgba(217, 119, 6, 0.85)); 
            color: #fff; display: flex; align-items: center; gap: 4px; 
            box-shadow: 0 4px 18px rgba(217, 119, 6, 0.35); 
        }
        .ae-badge-score svg { width: 11px; height: 11px; fill: currentColor; margin-bottom: 1px; }
        .ae-badge-progress { bottom: 34px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 16px); background: rgba(15,23,42,0.75); border: 1px solid rgba(148,163,184,0.3); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #e2e8f0; }

        /* Deletions */
        .ae-progress-delete { position: absolute; top: 8px; right: 8px; width: 22px; height: 22px; border-radius: 50%; border: 1px solid rgba(var(--ae-danger-rgb),0.6); background: rgba(var(--ae-danger-rgb),0.72); color: #fff; display: inline-flex; align-items: center; justify-content: center; z-index: 3; transition: 0.2s; padding: 0; cursor: pointer; }
        .ae-progress-delete:hover { background: rgba(var(--ae-danger-rgb),0.9); }

        .ae-card-info { padding: 12px; }
        .ae-card-title { font-size: 13.5px!important; font-weight: 600!important; margin: 0 0 6px!important; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--ae-text-primary)!important; }
        .ae-card-meta { display: flex; gap: 6px; flex-wrap: wrap; }
        .ae-meta-tag { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: rgba(var(--ae-primary-rgb),0.1); color: rgba(var(--ae-primary-rgb),0.8); }

        /* Dark mode generic overrides */
        :root.ae-dark #ae-search-input { color: var(--ae-text-primary)!important; }
        :root.ae-dark .ae-card { background: var(--ae-bg-surface)!important; border-color: var(--ae-border-light)!important; }
    `;

    // ===================== PLAY PAGE =====================

    // Detect category archive page (the old "play page")
    function isCategoryPlayPage() {
        return document.body.classList.contains('archive') &&
            document.body.classList.contains('category') &&
            document.querySelectorAll('article').length > 0;
    }

    // Detect single post page (独立播放页, e.g. https://anime1.me/28432)
    function isSinglePostPage() {
        return document.body.classList.contains('single') &&
            document.body.classList.contains('single-post') &&
            !!document.querySelector('#main > article .vjscontainer');
    }

    function isPlayPage() {
        return isCategoryPlayPage() || isSinglePostPage();
    }

    // Extract post ID from a single post page URL like https://anime1.me/28432
    function extractPostIdFromUrl(url) {
        const m = String(url || '').match(/anime1\.me\/(\d+)/);
        return m ? m[1] : null;
    }

    // Extract category ID from a single post page's article element
    function getCategoryIdFromArticle(articleEl) {
        if (!articleEl) return null;
        const cls = [...articleEl.classList].find(c => /^category-\d+$/.test(c));
        if (cls) {
            const id = parseInt(cls.replace('category-', ''), 10);
            if (Number.isFinite(id) && id > 0) return id;
        }
        // Fallback: look for the "全集連結" link
        const catLink = articleEl.querySelector('a[href*="?cat="]');
        if (catLink) {
            const m = catLink.href.match(/[?&]cat=(\d+)/);
            if (m) return parseInt(m[1], 10);
        }
        return null;
    }

    // Fetch a single page HTML and parse articles from it
    function fetchPageArticles(url) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload(res) {
                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(res.responseText, 'text/html');
                        const articles = [...doc.querySelectorAll('#main > article')];
                        const eps = [];
                        articles.forEach(art => {
                            const titleEl = art.querySelector('.entry-title a') || art.querySelector('.entry-title');
                            if (!titleEl) return;
                            const title = titleEl.textContent.trim();
                            const epMatch = title.match(/\[(\d+)\]/);
                            const epNum = epMatch ? parseInt(epMatch[1]) : null;
                            const href = titleEl.href || titleEl.closest('a')?.href || '';
                            const postId = extractPostIdFromUrl(href);
                            const postUrl = postId ? `https://anime1.me/${postId}` : href;
                            eps.push({ title, epNum, postUrl, postId });
                        });
                        // Check for next page (WordPress post navigation: "上一頁" = older posts = earlier episodes)
                        const nextLink = doc.querySelector('.nav-previous a');
                        const nextUrl = nextLink?.getAttribute('href') || null;
                        resolve({ eps, nextUrl });
                    } catch {
                        resolve({ eps: [], nextUrl: null });
                    }
                },
                onerror() { resolve({ eps: [], nextUrl: null }); }
            });
        });
    }

    // Fetch all episodes from a category, handling pagination
    async function fetchAllCategoryEpisodes(catId) {
        const allEps = [];
        let pageUrl = `https://anime1.me/?cat=${catId}`;
        const maxPages = 20; // safety limit
        for (let i = 0; i < maxPages; i++) {
            const { eps, nextUrl } = await fetchPageArticles(pageUrl);
            allEps.push(...eps);
            if (!nextUrl) break;
            pageUrl = nextUrl;
        }
        // Assign fallback epNum for episodes that didn't have one
        allEps.forEach((ep, idx) => {
            if (!Number.isFinite(ep.epNum)) ep.epNum = allEps.length - idx;
        });
        // Reverse to chronological order: [01] first
        allEps.reverse();
        return allEps;
    }

    // Get anime title from single post page (strip episode number suffix)
    function getAnimeTitleFromSinglePost() {
        // Try the category tag in the footer of the article
        const catTag = document.querySelector('#main > article .cat-links a');
        if (catTag) return catTag.textContent.trim();
        // Fallback: parse from page title
        const pageTitle = document.title.replace(/\s*–\s*Anime1\.me.*$/i, '').trim();
        return pageTitle.replace(/\s*\[\d+\]\s*$/, '').trim();
    }

    // ---- Category page redirect logic ----
    function handleCategoryPageRedirect() {
        const articles = [...document.querySelectorAll('#main > article')];
        if (articles.length === 0) return;

        const catId = getCurrentCategoryId();
        const pageTitle = document.querySelector('.page-header .page-title')?.textContent?.trim() || '';
        const storedProgress = getWatchProgressForAnime({ catId, name: pageTitle });

        // If we have stored progress, redirect immediately
        if (storedProgress && storedProgress.postUrl) {
            const postId = extractPostIdFromUrl(storedProgress.postUrl);
            if (postId) {
                location.replace(`https://anime1.me/${postId}`);
                return;
            }
        }

        // No stored progress — need to find episode 1.
        // Show a loading overlay while we fetch all episode pages.
        const overlay = document.createElement('div');
        overlay.id = 'ap-category-loading-overlay';
        overlay.innerHTML = `
            <style>
                #ap-category-loading-overlay {
                    position: fixed; inset: 0; z-index: 2147483647;
                    background: linear-gradient(135deg, #0f0a1e 0%, #1a1145 50%, #0d0b2e 100%);
                    display: flex; flex-direction: column;
                    align-items: center; justify-content: center;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                .ap-loading-spinner {
                    width: 48px; height: 48px;
                    border: 3px solid rgba(139,92,246,0.15);
                    border-top-color: #a78bfa;
                    border-radius: 50%;
                    animation: ap-spin 0.8s linear infinite;
                }
                @keyframes ap-spin { to { transform: rotate(360deg); } }
                .ap-loading-text {
                    margin-top: 24px;
                    color: rgba(255,255,255,0.75);
                    font-size: 16px; font-weight: 400;
                    letter-spacing: 0.5px;
                    animation: ap-text-pulse 1.8s ease-in-out infinite;
                }
                @keyframes ap-text-pulse {
                    0%, 100% { opacity: 0.55; }
                    50% { opacity: 1; }
                }
                .ap-loading-sub {
                    margin-top: 10px;
                    color: rgba(255,255,255,0.35);
                    font-size: 13px;
                }
            </style>
            <div class="ap-loading-spinner"></div>
            <div class="ap-loading-text">加載整理中，請稍後...</div>
            <div class="ap-loading-sub">正在獲取完整選集列表</div>
        `;
        document.body.appendChild(overlay);

        // Fetch all episodes from the category (handles pagination automatically)
        fetchAllCategoryEpisodes(catId).then(episodes => {
            if (episodes.length > 0) {
                // episodes is in chronological order ([01] first), so episodes[0] is ep 1
                const ep1 = episodes[0];
                const postId = extractPostIdFromUrl(ep1.postUrl);
                if (postId) {
                    location.replace(`https://anime1.me/${postId}`);
                    return;
                }
                // Fallback: use the URL directly
                location.replace(ep1.postUrl);
            } else {
                // Fallback: redirect to the first article link on the page (latest episode)
                const firstLink = articles[0]?.querySelector('.entry-title a');
                if (firstLink) location.replace(firstLink.href);
            }
        });
    }

    // ---- Single post page enhancement ----
    function enhancePlayPage() {
        // If on category page, redirect to single post page
        if (isCategoryPlayPage()) {
            handleCategoryPageRedirect();
            return;
        }

        // We are on a single post page
        const article = document.querySelector('#main > article');
        if (!article) return;

        injectCSS(PLAYPAGE_CSS);

        const vjsContainer = article.querySelector('.vjscontainer');
        const catId = getCategoryIdFromArticle(article);
        const currentPostId = extractPostIdFromUrl(location.href);
        const currentPostUrl = currentPostId ? `https://anime1.me/${currentPostId}` : location.href;

        // Parse current episode info from the article
        const entryTitle = article.querySelector('.entry-title')?.textContent?.trim() || '';
        const currentEpMatch = entryTitle.match(/\[(\d+)\]/);
        const currentEpNum = currentEpMatch ? parseInt(currentEpMatch[1]) : null;

        const animeName = getAnimeTitleFromSinglePost();
        const playCatId = catId || getCurrentCategoryId();

        // Hide original article content but keep comments
        article.style.display = 'none';
        document.querySelectorAll('#main > #ad-1, #main > #ad-2').forEach(el => el.style.display = 'none');

        // Full width layout
        const secondary = document.querySelector('#secondary');
        if (secondary) secondary.style.display = 'none';
        const primaryDiv = document.getElementById('primary');
        if (primaryDiv) primaryDiv.style.cssText = 'width:100%!important;max-width:1100px!important;margin:0 auto!important;float:none!important;';
        const siteContent = document.querySelector('.site-content');
        if (siteContent) siteContent.style.cssText = 'max-width:1200px!important;margin:0 auto!important;padding:0!important;';

        // Move play title/info into site header
        const headerHost = document.querySelector('#masthead .header-content') || document.querySelector('#masthead');
        if (headerHost) {
            // Hide default site title
            const siteBranding = headerHost.querySelector('#site-branding');
            if (siteBranding) siteBranding.style.display = 'none';

            let playHeader = headerHost.querySelector('#ap-play-header-panel');
            if (!playHeader) {
                playHeader = document.createElement('div');
                playHeader.id = 'ap-play-header-panel';
                playHeader.innerHTML = `
                    <div class="ap-header-main">
                        <h1 class="ap-anime-title">${animeName}</h1>
                        <div class="ap-now-playing">
                            <span class="ap-now-label">正在播放</span>
                            <span class="ap-now-ep" id="ap-current-ep-label">${entryTitle}</span>
                        </div>
                    </div>
                    <div class="ap-header-actions">
                        <a class="ap-back-link" href="https://anime1.me/">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M15 18l-6-6 6-6"/></svg>
                            返回列表
                        </a>
                    </div>
                `;
                headerHost.appendChild(playHeader);
            }
        }

        // Build player UI
        const main = document.getElementById('main');
        const section = document.createElement('div');
        section.className = 'ap-player-section';
        section.innerHTML = `
            <div class="ap-main-layout">
                <div class="ap-player-column">
                    <div class="ap-content-row">
                        <div class="ap-left-stack">
                            <div class="ap-video-wrapper" id="ap-video-wrapper"></div>
                        </div>
                        <div class="ap-episode-section">
                            <div class="ap-ep-header">
                                <div style="display:flex; align-items:center; gap:16px;">
                                    <h2 class="ap-ep-title">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                                            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                                        </svg>
                                        選集列表
                                    </h2>
                                    <button type="button" class="ap-fav-btn ${playCatId && isAnimeFavorited(playCatId) ? 'is-favorited' : ''}" id="ap-fav-btn" data-cat-id="${playCatId}">
                                        <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                                        <span class="ap-fav-text">${playCatId && isAnimeFavorited(playCatId) ? '取消收藏' : '加入收藏'}</span>
                                    </button>
                                </div>
                                <span class="ap-ep-count" id="ap-ep-count">載入中...</span>
                            </div>
                            <div class="ap-ep-grid" id="ap-ep-grid">
                                <div class="ap-ep-loading">正在載入選集列表...</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        main.insertBefore(section, main.firstChild);

        const favBtn = document.getElementById('ap-fav-btn');
        if (favBtn && playCatId) {
            favBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isAnimeFavorited(playCatId)) {
                    if (confirm(`確定要取消收藏「${animeName}」嗎？`)) {
                        deleteFavoriteAnime(playCatId);
                        updateCardFavoriteStar(playCatId);
                    }
                } else {
                    openFavoritesModal({ catId: playCatId, name: animeName });
                }
            });
        }

        // Mount current episode's player
        const wrapper = document.getElementById('ap-video-wrapper');
        if (vjsContainer) {
            vjsContainer.style.display = '';
            wrapper.appendChild(vjsContainer);
        }

        // Web fullscreen
        let webFullscreenActive = false;
        let webFullscreenShortcutBound = false;
        const WEB_FULLSCREEN_CLASS = 'ae-web-fullscreen';
        let isSDown = false;

        function syncWebFullscreenButtons() {
            document.querySelectorAll('.ae-webfs-btn').forEach((btn) => {
                const active = !!webFullscreenActive;
                btn.classList.toggle('is-active', active);
                btn.setAttribute('aria-pressed', active ? 'true' : 'false');
                btn.title = active ? '退出网页全屏 (W)' : '网页全屏 (W)';
                const textNode = btn.querySelector('.vjs-control-text');
                if (textNode) textNode.textContent = active ? '退出网页全屏' : '网页全屏';
                const iconPath = btn.querySelector('.ae-webfs-icon path');
                if (iconPath) {
                    iconPath.setAttribute('d', active
                        ? 'M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5'
                        : 'M9 3H3v6M15 3h6v6M9 21H3v-6M21 15v6h-6');
                }
            });
        }

        function setWebFullscreen(active) {
            webFullscreenActive = !!active;
            document.documentElement.classList.toggle(WEB_FULLSCREEN_CLASS, webFullscreenActive);
            document.body.classList.toggle(WEB_FULLSCREEN_CLASS, webFullscreenActive);
            syncWebFullscreenButtons();
        }

        function ensureWebFullscreenControl(container) {
            const controlBar = container?.querySelector('.vjs-control-bar');
            if (!controlBar) return;
            if (!controlBar.querySelector('.ae-webfs-btn')) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'vjs-webfs-control vjs-control vjs-button ae-webfs-btn';
                btn.innerHTML = `
                    <svg class="ae-webfs-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M21 15v6h-6"></path>
                        <circle class="ae-webfs-dot" cx="12" cy="12" r="1.45"></circle>
                    </svg>
                    <span class="vjs-control-text">网页全屏</span>
                `;
                btn.addEventListener('click', () => setWebFullscreen(!webFullscreenActive));
                const nativeFullscreen = controlBar.querySelector('.vjs-fullscreen-control');
                if (nativeFullscreen && nativeFullscreen.parentElement === controlBar) {
                    controlBar.insertBefore(btn, nativeFullscreen);
                } else {
                    controlBar.appendChild(btn);
                }
            }
            syncWebFullscreenButtons();
        }

        function bindWebFullscreenShortcut() {
            if (webFullscreenShortcutBound) return;

            const speedIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M13 12l-3-2v4l3-2z"/><path d="M17 12l-3-2v4l3-2z"/></svg>';

            const onKeydown = (e) => {
                const target = e.target;
                const isEditable = !!(target && (
                    target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable
                ));
                if (isEditable) return;

                const video = document.querySelector('.video-js video');

                // Track S key state
                if (e.key === 's' || e.key === 'S') {
                    isSDown = true;
                    // Cycling speeds logic (only if not a repeat keydown event)
                    if (!e.repeat && video) {
                        const rates = [1.0, 1.25, 1.5, 2.0, 0.75, 0.5];
                        let next = rates[0];
                        const current = video.playbackRate;
                        for (let i = 0; i < rates.length; i++) {
                            if (Math.abs(current - rates[i]) < 0.01) {
                                next = rates[(i + 1) % rates.length];
                                break;
                            }
                        }
                        video.playbackRate = next;
                        showToast(`速度: ${next}x`, speedIcon);
                    }
                }

                if (!video) return;

                // S + Up/Down for fine speed adjustment
                if (isSDown && e.key === 'ArrowUp') {
                    e.preventDefault();
                    video.playbackRate = Math.min(4.0, Math.round((video.playbackRate + 0.1) * 10) / 10);
                    showToast(`速度: ${video.playbackRate}x`, speedIcon);
                    return;
                }
                if (isSDown && e.key === 'ArrowDown') {
                    e.preventDefault();
                    video.playbackRate = Math.max(0.1, Math.round((video.playbackRate - 0.1) * 10) / 10);
                    showToast(`速度: ${video.playbackRate}x`, speedIcon);
                    return;
                }

                // Web Fullscreen W key
                if ((e.key === 'w' || e.key === 'W') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    e.preventDefault();
                    const active = !webFullscreenActive;
                    setWebFullscreen(active);
                    showToast(active ? '進入網頁全屏' : '退出網頁全屏',
                        `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 15v6h-6M3 9V3h6"/></svg>`);
                    return;
                }

                // Escape key
                if (e.key === 'Escape' && webFullscreenActive) {
                    e.preventDefault();
                    setWebFullscreen(false);
                    showToast('退出網頁全屏', `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 15v6h-6M3 9V3h6"/></svg>`);
                    return;
                }

                // Normal Arrow/Space/M hotkeys
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    setTimeout(() => {
                        const vol = Math.round(video.volume * 100);
                        const icon = vol === 0 ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>' : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>';
                        showToast(`音量: ${vol}%`, icon);
                    }, 50);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    setTimeout(() => {
                        showToast(`進度: ${formatTime(video.currentTime)} / ${formatTime(video.duration)}`,
                            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>');
                    }, 50);
                } else if (e.key === ' ') { // Space
                    setTimeout(() => {
                        const isPaused = video.paused;
                        showToast(isPaused ? '暫停' : '播放',
                            isPaused ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>');
                    }, 50);
                } else if (e.key === 'm' || e.key === 'M') {
                    setTimeout(() => {
                        const isMuted = video.muted;
                        showToast(isMuted ? '靜音: 開' : '靜音: 關',
                            isMuted ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>' : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 010 7.07"/></svg>');
                    }, 50);
                }
            };

            const onKeyup = (e) => {
                if (e.key === 's' || e.key === 'S') isSDown = false;
            };

            document.addEventListener('keydown', onKeydown);
            document.addEventListener('keyup', onKeyup);
            webFullscreenShortcutBound = true;
        }

        // Apply web fullscreen control and poster to current player
        if (vjsContainer) {
            ensureWebFullscreenControl(vjsContainer);
        }
        bindWebFullscreenShortcut();

        // Progress tracking for current video
        let trackedVideo = null;
        let saveHandlers = null;
        let lastProgressSaveAt = 0;
        let lastProgressSec = -1;

        function persistPlaybackProgress(force = false) {
            const video = vjsContainer?.querySelector('video');
            if (!video) return;
            const now = Date.now();
            const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
            const duration = Number.isFinite(video.duration) ? video.duration : null;
            const sec = Math.max(0, Math.floor(currentTime));
            if (!force) {
                if (sec === lastProgressSec) return;
                if (now - lastProgressSaveAt < 5000) return;
            }
            saveWatchProgress({
                catId: playCatId,
                animeName: animeName,
                epNum: currentEpNum || 1,
                epTitle: entryTitle,
                postUrl: currentPostUrl,
                positionSec: sec,
                durationSec: duration
            });
            lastProgressSaveAt = now;
            lastProgressSec = sec;
        }

        function bindVideoProgress(video) {
            if (!video || trackedVideo === video) return;
            if (trackedVideo && saveHandlers) {
                trackedVideo.removeEventListener('timeupdate', saveHandlers.onTimeUpdate);
                trackedVideo.removeEventListener('pause', saveHandlers.onPause);
                trackedVideo.removeEventListener('ended', saveHandlers.onEnded);
                trackedVideo.removeEventListener('seeking', saveHandlers.onSeeking);
            }
            saveHandlers = {
                onTimeUpdate: () => persistPlaybackProgress(false),
                onPause: () => persistPlaybackProgress(true),
                onEnded: () => persistPlaybackProgress(true),
                onSeeking: () => persistPlaybackProgress(true)
            };
            trackedVideo = video;
            video.addEventListener('timeupdate', saveHandlers.onTimeUpdate);
            video.addEventListener('pause', saveHandlers.onPause);
            video.addEventListener('ended', saveHandlers.onEnded);
            video.addEventListener('seeking', saveHandlers.onSeeking);
        }

        function restorePlaybackTime(video, seconds) {
            if (!video || !Number.isFinite(seconds) || seconds <= 1) return;
            const seek = () => {
                const duration = Number.isFinite(video.duration) ? video.duration : null;
                const target = duration ? Math.min(seconds, Math.max(0, duration - 1.5)) : seconds;
                if (target <= 0) return;
                try { video.currentTime = target; } catch { /* ignore */ }
            };
            if (video.readyState >= 1) {
                seek();
            } else {
                video.addEventListener('loadedmetadata', seek, { once: true });
            }
        }

        // Bind progress tracking and restore playback position
        const videoEl = vjsContainer?.querySelector('video');
        if (videoEl) {
            bindVideoProgress(videoEl);
            const storedProgress = getWatchProgressForAnime({ catId: playCatId, name: animeName });
            if (storedProgress && Number.isFinite(storedProgress.positionSec) && storedProgress.postUrl === currentPostUrl) {
                restorePlaybackTime(videoEl, storedProgress.positionSec);
            }
        }

        // Save initial progress record
        saveWatchProgress({
            catId: playCatId,
            animeName: animeName,
            epNum: currentEpNum || 1,
            epTitle: entryTitle,
            postUrl: currentPostUrl
        });

        window.addEventListener('beforeunload', () => persistPlaybackProgress(true));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') persistPlaybackProgress(true);
        });

        // Scroll player into view
        requestAnimationFrame(() => {
            setTimeout(() => {
                const w = document.getElementById('ap-video-wrapper');
                if (!w) return;
                const rect = w.getBoundingClientRect();
                const targetY = window.scrollY + rect.top - Math.max(0, (window.innerHeight - rect.height) / 2);
                window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
            }, 60);
        });

        // Make comments section visible and styled
        const commentsSection = document.getElementById('comments') || document.querySelector('.comments-area');
        if (commentsSection) {
            commentsSection.style.display = '';
            // Move comments after the player section if needed
            const playerSection = document.querySelector('.ap-player-section');
            if (playerSection && commentsSection.parentElement === article) {
                // Detach from hidden article and place after player
                playerSection.parentElement.insertBefore(commentsSection, playerSection.nextSibling);
            }
        }

        // Fetch Bangumi banner/poster
        if (animeName) {
            searchBangumi(animeName).then(data => {
                const heroImage = data?.poster || null;
                if (heroImage && vjsContainer) {
                    const videoJsRoot = vjsContainer.querySelector('.video-js');
                    const vid = vjsContainer.querySelector('video');
                    const posterEl = vjsContainer.querySelector('.vjs-poster');
                    if (videoJsRoot) videoJsRoot.setAttribute('poster', heroImage);
                    if (vid) vid.setAttribute('poster', heroImage);
                    if (posterEl) posterEl.style.backgroundImage = `url("${heroImage}")`;
                }
            }).catch(() => { });
        }

        // ---- Fetch all episodes from category in background ----
        if (playCatId) {
            fetchAllCategoryEpisodes(playCatId).then(episodes => {
                const epGrid = document.getElementById('ap-ep-grid');
                const epCount = document.getElementById('ap-ep-count');
                if (!epGrid) return;

                epGrid.innerHTML = '';
                if (epCount) epCount.textContent = `共 ${episodes.length} 集`;

                episodes.forEach((ep) => {
                    const isCurrent = ep.postUrl === currentPostUrl ||
                        (ep.postId && ep.postId === currentPostId) ||
                        (Number.isFinite(ep.epNum) && ep.epNum === currentEpNum);

                    const btn = document.createElement('button');
                    btn.className = 'ap-ep-btn' + (isCurrent ? ' active' : '');
                    btn.textContent = Number.isFinite(ep.epNum) ? String(ep.epNum).padStart(2, '0') : '??';
                    btn.title = ep.title;
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        if (isCurrent) return; // Already on this episode
                        // Save progress before navigating away
                        persistPlaybackProgress(true);
                        location.href = ep.postUrl;
                    });
                    epGrid.appendChild(btn);
                });

                // Scroll active button into view
                const activeBtn = epGrid.querySelector('.ap-ep-btn.active');
                if (activeBtn) {
                    requestAnimationFrame(() => {
                        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    });
                }
            });
        }
    }

    const PLAYPAGE_CSS = `
        #masthead {
            position: relative !important;
            background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%) !important;
            box-shadow: 0 4px 30px rgba(0,0,0,0.3) !important;
            border-bottom: 1px solid var(--ae-border-primary) !important;
        }
        #masthead .header-content { padding: 8px 14px !important; min-height: 56px !important; }

        /* Web Fullscreen */
        html.ae-web-fullscreen, body.ae-web-fullscreen { overflow: hidden !important; }
        body.ae-web-fullscreen #masthead, body.ae-web-fullscreen #colophon { display: none !important; }
        body.ae-web-fullscreen .ap-player-section { position: fixed !important; inset: 0 !important; z-index: 2147483000 !important; margin: 0 !important; width: 100vw !important; max-width: none !important; background: #000 !important; }
        body.ae-web-fullscreen .ap-main-layout, body.ae-web-fullscreen .ap-player-column, body.ae-web-fullscreen .ap-content-row, body.ae-web-fullscreen .ap-left-stack { height: 100% !important; min-height: 0 !important; background: #000 !important; border: none !important; border-radius: 0 !important; }
        body.ae-web-fullscreen .ap-episode-section { display: none !important; }
        body.ae-web-fullscreen #ap-video-wrapper { position: relative !important; width: 100% !important; height: 100vh !important; background: #000 !important; }
        body.ae-web-fullscreen #ap-video-wrapper::before { display: none !important; }
        body.ae-web-fullscreen #ap-video-wrapper .vjscontainer, body.ae-web-fullscreen #ap-video-wrapper .video-js, body.ae-web-fullscreen #ap-video-wrapper .video-js .vjs-tech, body.ae-web-fullscreen #ap-video-wrapper .video-js video { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; background: #000 !important; }

        .page-header { display: none !important; }

        /* Play Page Layout Resets */
        body.archive.category, body.archive.category #page, body.archive.category #content, body.archive.category .site-content, body.archive.category #primary, body.archive.category #main, body.archive.category #colophon { background: var(--ae-bg-base) !important; }
        body.archive.category #colophon .scroll-top { display: none !important; }
        .ap-player-section { margin: 0 auto; max-width: 100%; display: block !important; clear: both !important; position: relative !important; z-index: 1 !important; }
        .ap-main-layout { display: block; }
        body.archive.category #masthead .site-title, body.archive.category #masthead #site-branding { display: none !important; }
        body.archive.category #masthead .header-content { padding: 10px 16px !important; min-height: auto !important; display: flex !important; align-items: center !important; }

        /* Header Panel */
        #ap-play-header-panel { display: flex; align-items: center; justify-content: space-between; gap: 14px; width: 100%; padding: 0; min-height: 38px; }
        .ap-header-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .ap-player-column { min-width: 0; background: var(--ae-bg-panel); border: 1px solid var(--ae-border-primary); border-radius: 0 0 12px 12px; backdrop-filter: blur(12px); overflow: hidden; }
        .ap-content-row { display: flex; flex-direction: column; min-height: 100%; }
        .ap-left-stack { min-width: 0; }

        /* Prevent nested scroll containers */
        html, body, #page, #content, .site-content, #primary, #main { overflow-x: hidden !important; }
        #content, .site-content, #primary, #main { overflow-y: visible !important; height: auto !important; max-height: none !important; }

        .ap-anime-title { font-size: 22px!important; font-weight: 700!important; margin: 0!important; color: var(--ae-text-primary)!important; line-height: 1.3!important; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        @supports (-webkit-background-clip: text) { .ap-anime-title { background: var(--ae-primary-grad); -webkit-background-clip: text; -webkit-text-fill-color: transparent; } }
        .ap-now-playing { display: flex; align-items: center; gap: 8px; }
        .ap-now-label { font-size: 12px; padding: 3px 10px; background: rgba(var(--ae-primary-rgb),0.2); border-radius: 999px; color: var(--ae-primary); font-weight: 500; border: 1px solid var(--ae-border-primary); }
        .ap-now-ep { font-size: 14px; color: var(--ae-text-secondary); }
        .ap-back-link { display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border-radius: 999px; height: 34px; box-sizing: border-box; background: var(--ae-bg-input); border: 1px solid var(--ae-border-light); color: var(--ae-text-primary)!important; text-decoration: none!important; font-size: 13px; transition: all 0.25s ease; white-space: nowrap; }
        .ap-back-link:hover { background: var(--ae-bg-hover); border-color: var(--ae-primary); }

        .ap-header-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .ap-fav-btn { position: static; height: 32px; padding: 0 12px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 999px; background: var(--ae-bg-input); border: 1px solid var(--ae-border-light); color: var(--ae-text-primary); cursor: pointer; font-size: 13px; font-family: inherit; transition: all 0.25s ease; }
        .ap-fav-btn:hover { background: var(--ae-bg-hover); border-color: rgba(var(--ae-primary-rgb),0.55); color: var(--ae-gold); }
        .ap-fav-btn.is-favorited { color: var(--ae-gold); background: rgba(var(--ae-gold-rgb),0.15); border-color: rgba(var(--ae-gold-rgb),0.35); }
        .ap-fav-btn.is-favorited:hover { background: rgba(var(--ae-gold-rgb),0.25); border-color: rgba(var(--ae-gold-rgb),0.5); }
        .ap-fav-btn svg { fill: none; stroke: currentColor; stroke-width: 1.8; transition: all 0.25s ease; width: 14px; height: 14px; }
        .ap-fav-btn.is-favorited svg { fill: currentColor; stroke: currentColor; }

        /* Video Wrapper */
        .ap-video-wrapper { background: #000; position: relative !important; overflow: hidden !important; width: 100% !important; border-radius: 0 !important; }
        .ap-video-wrapper::before { content: ''; display: block; width: 100%; padding-top: 56.25%; }
        .ap-video-wrapper .vjscontainer { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; display: block !important; max-width: none !important; overflow: hidden !important; }
        .ap-video-wrapper .video-js { display: block !important; width: 100% !important; height: 100% !important; max-width: none !important; }
        .ap-video-wrapper .video-js.vjs-fluid { padding-top: 0 !important; }
        .ap-video-wrapper .video-js:not(.vjs-fluid), .ap-video-wrapper .video-js .vjs-tech, .ap-video-wrapper .video-js video { width: 100% !important; height: 100% !important; }
        .ap-video-wrapper .video-js .vjs-control-bar { z-index: 30 !important; }
        .vjs-webfs-control { width: 3em !important; min-width: 3em !important; padding: 0 !important; }
        .vjs-webfs-control .vjs-control-text { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0,0,0,0) !important; white-space: nowrap !important; border: 0 !important; }
        .vjs-webfs-control .ae-webfs-icon { width: 15px; height: 15px; display: block; margin: 0 auto; color: var(--ae-text-primary); pointer-events: none; transition: 0.2s ease; }
        .vjs-webfs-control .ae-webfs-icon path { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .vjs-webfs-control .ae-webfs-icon .ae-webfs-dot { fill: currentColor; opacity: 0.9; }
        .ae-webfs-btn.is-active .ae-webfs-icon { color: var(--ae-primary); }

        /* Episode Section */
        .ap-episode-section { width: 100%; padding: 20px 24px 28px; background: rgba(15,12,41,0.6); border-top: 1px solid var(--ae-border-primary); position: static !important; overflow: visible !important; z-index: auto !important; margin-top: 0 !important; max-height: none; overflow-y: visible !important; }
        .ap-ep-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .ap-ep-title { display: flex; align-items: center; gap: 8px; font-size: 16px!important; font-weight: 600!important; color: var(--ae-text-primary)!important; margin: 0!important; }
        .ap-ep-title svg { color: var(--ae-primary); }
        .ap-ep-count { font-size: 13px; color: var(--ae-text-muted); }

        .ap-ep-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 8px; }
        .ap-ep-loading { grid-column: 1 / -1; text-align: center; padding: 20px; color: var(--ae-text-muted); font-size: 14px; animation: ap-pulse 1.5s ease-in-out infinite; }
        @keyframes ap-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        .ap-ep-btn { width: 100%; min-width: 0; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 10px; border: 1px solid var(--ae-border-light); background: var(--ae-bg-surface); color: var(--ae-text-secondary); cursor: pointer; transition: 0.25s ease; font-family: inherit; padding: 0 12px; font-size: 14px; font-weight: 500; }
        .ap-ep-btn:hover:not(.active) { background: rgba(var(--ae-primary-rgb),0.15); border-color: rgba(var(--ae-primary-rgb),0.35); transform: translateY(-2px); }
        .ap-ep-btn.active { background: var(--ae-primary-grad); border-color: transparent; color: #fff; font-weight: 600; box-shadow: 0 4px 15px rgba(var(--ae-primary-rgb),0.4); transform: scale(1.05); cursor: default; }

        /* Comments */
        .single-post .comments-area { max-width: 1100px; margin: 20px auto; padding: 0 16px; }

        @media (max-width: 1024px) {
            .ap-video-wrapper, .ap-episode-section { border-radius: 0; }
            .ap-ep-grid { grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); }
        }

        @media (max-width: 640px) {
            body.archive.category, body.archive.category #page, body.archive.category #content, body.archive.category .site-content, body.archive.category #primary, body.archive.category #main, body.archive.category .ap-player-section, body.archive.category .ap-main-layout, body.archive.category .ap-player-column,
            body.single.single-post, body.single.single-post #page, body.single.single-post #content, body.single.single-post .site-content, body.single.single-post #primary, body.single.single-post #main, body.single.single-post .ap-player-section, body.single.single-post .ap-main-layout, body.single.single-post .ap-player-column {
                width: 100% !important; max-width: 100% !important; margin-left: 0 !important; margin-right: 0 !important; padding-left: 0 !important; padding-right: 0 !important;
            }
            body.archive.category .site-content, body.single.single-post .site-content { padding-left: 0 !important; padding-right: 0 !important; }
            .ap-title-bar { display: none !important; }
            .ap-player-column { border-left: none !important; border-right: none !important; border-radius: 0 !important; }
            #ap-play-header-panel { border-radius: 0 !important; padding: 0; padding-right: 0; }
            .ap-anime-title { font-size: 18px!important; }
            .ap-episode-section { padding: 14px 16px 20px; }
            .ap-ep-grid { grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); }
            .ap-ep-btn { height: 36px; font-size: 13px; }
            .single-post .comments-area { padding: 0 8px; }
        }
    `;

    // ===================== INIT =====================
    mountSettingsFloatingButton();
    setTimeout(mountSettingsFloatingButton, 120);
    initForcedDarkMode();

    if (isHomePage()) {
        enhanceHomePage();
    } else if (isPlayPage()) {
        enhancePlayPage();
    }

})();
