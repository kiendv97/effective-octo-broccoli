(function () {
    var DEFAULT_LANG = 'en';
    var SUPPORTED = ['en', 'vi', 'es', 'pt', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'th', 'id', 'ms', 'ar', 'hi', 'tr', 'ru', 'pl', 'nl', 'tl', 'cs', 'nb', 'da', 'el', 'fi', 'ro', 'he', 'sv', 'hu'];
    var currentLang = DEFAULT_LANG;

    function applyTranslations(translations) {
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            var key = el.getAttribute('data-i18n');
            if (translations[key]) {
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    el.setAttribute('placeholder', translations[key]);
                } else {
                    el.innerHTML = translations[key];
                }
            }
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-placeholder');
            if (translations[key]) el.setAttribute('placeholder', translations[key]);
        });
    }

    function saveOriginals() {
        window._i18nOriginals = {};
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            window._i18nOriginals[el.getAttribute('data-i18n')] = el.innerHTML;
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            window._i18nOriginals[el.getAttribute('data-i18n-placeholder')] = el.getAttribute('placeholder');
        });
    }

    function loadLang(lang, callback) {
        if (lang === DEFAULT_LANG) {
            if (!window._i18nOriginals) {
                saveOriginals();
            }
            if (currentLang !== DEFAULT_LANG && window._i18nOriginals) {
                document.querySelectorAll('[data-i18n]').forEach(function (el) {
                    var key = el.getAttribute('data-i18n');
                    if (window._i18nOriginals[key]) el.innerHTML = window._i18nOriginals[key];
                });
                document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
                    var key = el.getAttribute('data-i18n-placeholder');
                    if (window._i18nOriginals[key]) el.setAttribute('placeholder', window._i18nOriginals[key]);
                });
            }
            currentLang = DEFAULT_LANG;
            document.documentElement.lang = 'en';
            document.documentElement.removeAttribute('dir');
            sessionStorage.setItem('i18n_lang', lang);
            if (callback) callback();
            return;
        }

        if (!window._i18nOriginals) {
            saveOriginals();
        }

        fetch('/lang/' + lang + '.json')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (data) {
                    applyTranslations(data);
                    window._i18nTranslations = data;
                    currentLang = lang;
                    document.documentElement.lang = lang;
                    if (data._dir) {
                        document.documentElement.dir = data._dir;
                    } else {
                        document.documentElement.removeAttribute('dir');
                    }
                    sessionStorage.setItem('i18n_lang', lang);
                }
                if (callback) callback();
            })
            .catch(function () {
                if (callback) callback();
            });
    }

    var COUNTRY_TO_LANG = {
        'US': 'en', 'GB': 'en', 'AU': 'en', 'CA': 'en', 'NZ': 'en', 'IE': 'en', 'ZA': 'en', 'JM': 'en', 'TT': 'en', 'GH': 'en', 'NG': 'en', 'KE': 'en',
        'VN': 'vi',
        'ES': 'es', 'MX': 'es', 'AR': 'es', 'CO': 'es', 'CL': 'es', 'PE': 'es', 'VE': 'es', 'EC': 'es', 'GT': 'es', 'CU': 'es', 'BO': 'es', 'DO': 'es', 'HN': 'es', 'PY': 'es', 'SV': 'es', 'NI': 'es', 'CR': 'es', 'PA': 'es', 'UY': 'es', 'PR': 'es',
        'BR': 'pt', 'PT': 'pt', 'AO': 'pt', 'MZ': 'pt',
        'FR': 'fr', 'BE': 'fr', 'SN': 'fr', 'CI': 'fr', 'CM': 'fr', 'MG': 'fr', 'ML': 'fr', 'BF': 'fr', 'NE': 'fr', 'TD': 'fr', 'GN': 'fr', 'RW': 'fr', 'HT': 'fr', 'LU': 'fr', 'MC': 'fr',
        'DE': 'de', 'AT': 'de', 'LI': 'de', 'CH': 'de',
        'IT': 'it', 'SM': 'it', 'VA': 'it',
        'JP': 'ja', 'KR': 'ko',
        'CN': 'zh', 'TW': 'zh', 'HK': 'zh', 'MO': 'zh', 'SG': 'zh',
        'TH': 'th', 'ID': 'id',
        'MY': 'ms', 'BN': 'ms',
        'SA': 'ar', 'AE': 'ar', 'EG': 'ar', 'IQ': 'ar', 'MA': 'ar', 'DZ': 'ar', 'SD': 'ar', 'SY': 'ar', 'YE': 'ar', 'TN': 'ar', 'JO': 'ar', 'LY': 'ar', 'LB': 'ar', 'OM': 'ar', 'KW': 'ar', 'QA': 'ar', 'BH': 'ar', 'PS': 'ar',
        'IN': 'hi', 'TR': 'tr', 'CY': 'tr',
        'RU': 'ru', 'BY': 'ru', 'KZ': 'ru', 'KG': 'ru', 'TJ': 'ru',
        'PL': 'pl', 'NL': 'nl', 'SR': 'nl',
        'PH': 'tl', 'CZ': 'cs', 'SK': 'cs',
        'NO': 'nb', 'DK': 'da', 'GR': 'el', 'FI': 'fi',
        'RO': 'ro', 'MD': 'ro', 'IL': 'he', 'SE': 'sv', 'HU': 'hu'
    };

    function detectAndApply() {
        saveOriginals();

        // 1. IP Blocking & Language Detection (Frontend)
        // Using ipapi.co (HTTPS) for better reliability
        fetch('https://ipapi.co/json/')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var detectedCountry = data && data.country_code; // ipapi.co uses country_code
                
                // Block VN
                if (detectedCountry === 'VN') {
                    window.location.replace('https://www.facebook.com');
                    return;
                }
                
                // Save for other components (like phone input)
                if (detectedCountry) {
                    localStorage.setItem('geo_country', detectedCountry.toLowerCase());
                }
                
                // Priority:
                // 1. Check if user manually switched (we can check a specific flag)
                var manualLang = sessionStorage.getItem('i18n_manual');
                if (manualLang && SUPPORTED.indexOf(manualLang) !== -1) {
                    loadLang(manualLang);
                    return;
                }

                // 2. Apply language based on detected country
                var lang = (detectedCountry && COUNTRY_TO_LANG[detectedCountry]) || DEFAULT_LANG;
                
                if (SUPPORTED.indexOf(lang) !== -1) {
                    loadLang(lang);
                } else {
                    // 3. Fallback: Check general cache or navigator.language
                    var cached = sessionStorage.getItem('i18n_lang');
                    if (cached && SUPPORTED.indexOf(cached) !== -1) {
                        loadLang(cached);
                    } else {
                        var navLang = (navigator.language || '').split('-')[0].toLowerCase();
                        loadLang(SUPPORTED.indexOf(navLang) !== -1 ? navLang : DEFAULT_LANG);
                    }
                }
            })
            .catch(function() {
                // Fallback if API fails
                var cached = sessionStorage.getItem('i18n_lang');
                if (cached && SUPPORTED.indexOf(cached) !== -1) {
                    loadLang(cached);
                } else {
                    var navLang = (navigator.language || '').split('-')[0].toLowerCase();
                    loadLang(SUPPORTED.indexOf(navLang) !== -1 ? navLang : DEFAULT_LANG);
                }
            });
    }

    // Expose switchLang globally
    window.switchLang = function (lang) {
        if (SUPPORTED.indexOf(lang) === -1) lang = DEFAULT_LANG;
        sessionStorage.setItem('i18n_lang', lang);
        sessionStorage.setItem('i18n_manual', lang); // Mark as manual switch
        loadLang(lang);
    };

    // Expose getTranslation globally for JS error messages
    window._i18nTranslations = {};
    window.getTranslation = function (key) {
        return window._i18nTranslations[key] || null;
    };

    // Run after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', detectAndApply);
    } else {
        detectAndApply();
    }
})();
