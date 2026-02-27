/**
 * Reddit User Vibe — Options Page Script
 * Loads, displays, and saves extension settings via chrome.storage.local.
 * Depends on config.js being loaded first (provides RUV.DEFAULTS, RUV.SETTINGS_KEY).
 */

'use strict';

const $ = (id) => document.getElementById(id);

const elLimit = $('limit');
const elAfter = $('after');
const elCacheDays = $('cache-days');
const elSubColor = $('sub-color');
const elSubColorHex = $('sub-color-hex');
const elSubText = $('sub-text-color');
const elSubTextHex = $('sub-text-color-hex');
const elCntColor = $('count-color');
const elCntColorHex = $('count-color-hex');
const elCntText = $('count-text-color');
const elCntTextHex = $('count-text-color-hex');
const elToggle = $('toggle-pause');
const elSave = $('save-btn');
const elReset = $('reset-btn');
const elStatus = $('status-msg');

// Preview pill elements
const elPrevSub = $('prev-sub');
const elPrevCnt = $('prev-cnt');
const elPrevSub2 = $('prev-sub2');
const elPrevCnt2 = $('prev-cnt2');

/** @type {number} API limit value at the time of the last save, for change detection. */
let savedLimit = RUV.DEFAULTS.limit;
/** @type {string} API after value at the time of the last save, for change detection. */
let savedAfter = RUV.DEFAULTS.after;

/**
 * Loads saved settings from chrome.storage.local, merging with defaults.
 * @returns {Promise<RUVSettings>}
 */
const loadSettings = () => {
    return new Promise((resolve) => {
        chrome.storage.local.get(RUV.SETTINGS_KEY, (result) => {
            resolve(Object.assign({}, RUV.DEFAULTS, result[RUV.SETTINGS_KEY] || {}));
        });
    });
};

/**
 * Persists settings to chrome.storage.local.
 * @param {RUVSettings} settings
 * @returns {Promise<void>}
 */
const saveSettings = (settings) => {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [RUV.SETTINGS_KEY]: settings }, resolve);
    });
};

/**
 * Binds a colour picker input and its corresponding hex text input together
 * so that changes in either control are reflected in the other.
 * Also calls onUpdate() after each change so the preview refreshes.
 *
 * @param {HTMLInputElement} pickerEl  The <input type="color"> element.
 * @param {HTMLInputElement} hexEl     The <input type="text"> hex element.
 * @param {function(): void} onUpdate  Called after any colour change.
 */
const bindColorPair = (pickerEl, hexEl, onUpdate) => {
    pickerEl.addEventListener('input', () => {
        hexEl.value = pickerEl.value;
        onUpdate();
    });

    hexEl.addEventListener('input', () => {
        const v = hexEl.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) {
            pickerEl.value = v;
            onUpdate();
        }
    });

    hexEl.addEventListener('change', () => {
        // Normalise on blur: add leading # if missing, else revert to picker value
        const v = hexEl.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) {
            pickerEl.value = v;
        } else {
            hexEl.value = pickerEl.value;
        }
        onUpdate();
    });
};

/**
 * Reads the current colour inputs and updates the live preview pills.
 */
const updatePreview = () => {
    const subBg = elSubColor.value;
    const subText = elSubText.value;
    const cntBg = elCntColor.value;
    const cntText = elCntText.value;

    for (const el of [elPrevSub, elPrevSub2]) {
        el.style.background = subBg;
        el.style.color = subText;
    }
    for (const el of [elPrevCnt, elPrevCnt2]) {
        el.style.background = cntBg;
        el.style.color = cntText;
    }
};

/** @type {boolean} Tracks in-memory paused state before saving. */
let paused = false;

/**
 * Updates the toggle button label and class to match the current paused state.
 */
const refreshToggleBtn = () => {
    if (paused) {
        elToggle.textContent = 'Resume';
        elToggle.className = 'paused';
    } else {
        elToggle.textContent = 'Pause';
        elToggle.className = 'running';
    }
}

elToggle.addEventListener('click', () => {
    paused = !paused;
    refreshToggleBtn();
});

/**
 * Populate form from settings
 * @param {RUVSettings} s
 */
const applyToForm = (s) => {
    elLimit.value = s.limit;
    elAfter.value = s.after;
    elCacheDays.value = s.cacheDays;

    elSubColor.value = s.subColor;
    elSubColorHex.value = s.subColor;
    elSubText.value = s.subTextColor;
    elSubTextHex.value = s.subTextColor;
    elCntColor.value = s.countColor;
    elCntColorHex.value = s.countColor;
    elCntText.value = s.countTextColor;
    elCntTextHex.value = s.countTextColor;

    paused = s.paused;
    savedLimit = s.limit;
    savedAfter = s.after;
    refreshToggleBtn();
    updatePreview();
};

/**
 * Reads all form control values and returns a settings object.
 * @returns {RUVSettings}
 */
const readFromForm = () => {
    const limit = Math.max(1, Math.min(100, parseInt(elLimit.value, 10) || RUV.DEFAULTS.limit));
    return {
        limit,
        after: elAfter.value,
        cacheDays: parseInt(elCacheDays.value, 10) || RUV.DEFAULTS.cacheDays,
        subColor: elSubColor.value,
        subTextColor: elSubText.value,
        countColor: elCntColor.value,
        countTextColor: elCntText.value,
        paused,
    };
};

/** @type {number|undefined} Timeout handle for hiding the status message. */
let statusTimer;

/**
 * Briefly displays a status message below the save/reset buttons.
 * @param {string} text
 */
const showStatus = (text) => {
    elStatus.textContent = text;
    elStatus.classList.remove('hidden');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => elStatus.classList.add('hidden'), 2000);
};

elSave.addEventListener('click', async () => {
    const newSettings = readFromForm();
    const apiChanged = newSettings.limit !== savedLimit || newSettings.after !== savedAfter;
    if (apiChanged) { await RUV.clearAllUserCache(); }
    await saveSettings(newSettings);
    savedLimit = newSettings.limit;
    savedAfter = newSettings.after;
    showStatus(apiChanged ? 'Saved! Cache cleared.' : 'Saved!');
});

elReset.addEventListener('click', async () => {
    applyToForm(RUV.DEFAULTS);
    await RUV.clearAllUserCache();
    await saveSettings(RUV.DEFAULTS);
    showStatus('Reset to defaults. Cache cleared.');
});

bindColorPair(elSubColor, elSubColorHex, updatePreview);
bindColorPair(elSubText, elSubTextHex, updatePreview);
bindColorPair(elCntColor, elCntColorHex, updatePreview);
bindColorPair(elCntText, elCntTextHex, updatePreview);

// Load settings and populate form on page ready
loadSettings().then(applyToForm);
