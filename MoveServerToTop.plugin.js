/**
 * @name MoveServerToTopLocal
 * @author colin
 * @description Adds a guild context menu action that moves a server to the top of the server list.
 * @version 0.1.0
 * @source https://github.com/colin/betterdiscord_MoveServerToTop_plugin
 */

"use strict";

const MENU_NAV_ID = "guild-context";
const MENU_ITEM_ID = "move-server-to-top";
const MENU_LABEL = "Move Server to Top";
const POLL_INTERVAL_MS = 25;
const POLL_TIMEOUT_MS = 400;
const LOGGER_SCOPE = "MoveServerToTopLocal";
const GUILD_DRAG_TRACE_OPTIONS = {
    enabled: false,
    durationMs: 0,
    maxEntries: 1000
};
const GUILD_DRAG_TRACE_TYPE_HINTS = ["GUILD", "FOLDER", "DRAG", "DROP", "MOVE", "POSITION", "ORDER", "SIDEBAR"];
const GUILD_DRAG_TRACE_KEY_HINTS = ["guildId", "guildIds", "folderId", "folderIds", "from", "to", "position", "positions", "targetId", "sourceId", "moveToBelow", "combine"];
const SAVE_GUILD_FOLDERS_SOURCE_HINTS = ["foldercolor", "clientthemesettings", "updateguildfolders", "folderid", "guildids"];
const SAVE_GUILD_FOLDERS_NEGATIVE_HINTS = ["requestedmessage", "formattoplainstring", "languagestore", "messages", "locale"];
const SAVE_GUILD_FOLDERS_BLOCKED_KEYS = new Set(["action"]);

function tryGet(fn) {
    try {
        return fn();
    }
    catch {
        return null;
    }
}

function createLogger(bdApi, scope = LOGGER_SCOPE) {
    const fallback = {
        debug: (...args) => console.debug(`[${scope}]`, ...args),
        log: (...args) => console.log(`[${scope}]`, ...args),
        warn: (...args) => console.warn(`[${scope}]`, ...args),
        error: (...args) => console.error(`[${scope}]`, ...args)
    };

    const logger = bdApi?.Logger;
    if (!logger) return fallback;

    return {
        debug: (...args) => (logger.log ? logger.log(scope, ...args) : fallback.debug(...args)),
        log: (...args) => (logger.log ? logger.log(scope, ...args) : fallback.log(...args)),
        warn: (...args) => (logger.warn ? logger.warn(scope, ...args) : fallback.warn(...args)),
        error: (...args) => (logger.error ? logger.error(scope, ...args) : fallback.error(...args))
    };
}

function summarizeOrder(order, max = 8) {
    if (!Array.isArray(order)) return order;
    if (order.length <= max) return order;
    return [...order.slice(0, max), `...(+${order.length - max} more)`];
}

function summarizeFolders(folders, max = 8) {
    if (!Array.isArray(folders)) return folders;
    const mapped = folders.map((folder) => ({
        folderId: folder?.folderId ?? null,
        guildIds: Array.isArray(folder?.guildIds) ? folder.guildIds : []
    }));
    if (mapped.length <= max) return mapped;
    return [...mapped.slice(0, max), {note: `+${mapped.length - max} more folders`}];
}

function summarizeArray(value, max = 3) {
    if (!Array.isArray(value)) return value;
    if (value.length <= max) return value;
    return [...value.slice(0, max), `...(+${value.length - max} more)`];
}

function sanitizeTraceValue(value, depth = 0) {
    if (value == null) return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;

    if (Array.isArray(value)) {
        const summarized = summarizeArray(value, 3);
        return summarized.map((entry) => sanitizeTraceValue(entry, depth + 1));
    }

    if (typeof value === "object") {
        if (depth >= 1) return `[object:${Object.keys(value).length} keys]`;

        const keys = Object.keys(value).slice(0, 8);
        const out = {};
        for (const key of keys) out[key] = sanitizeTraceValue(value[key], depth + 1);
        if (Object.keys(value).length > keys.length) out.__extraKeys = Object.keys(value).length - keys.length;
        return out;
    }

    return `[${typeof value}]`;
}

function looksLikeGuildListAction(action) {
    if (!action || typeof action !== "object") return false;

    const type = typeof action.type === "string" ? action.type.toUpperCase() : "";
    const typeMatched = GUILD_DRAG_TRACE_TYPE_HINTS.some((hint) => type.includes(hint));
    if (typeMatched) return true;

    return GUILD_DRAG_TRACE_KEY_HINTS.some((key) => Object.prototype.hasOwnProperty.call(action, key));
}

function toTraceActionSnapshot(action) {
    if (!action || typeof action !== "object") return {type: null, valueType: typeof action};

    const snapshot = {
        type: typeof action.type === "string" ? action.type : null
    };

    for (const key of GUILD_DRAG_TRACE_KEY_HINTS) {
        if (!Object.prototype.hasOwnProperty.call(action, key)) continue;
        snapshot[key] = sanitizeTraceValue(action[key]);
    }

    const keys = Object.keys(action);
    snapshot.keys = keys.length <= 16 ? keys : [...keys.slice(0, 16), `...(+${keys.length - 16} more)`];
    return snapshot;
}

function toCompactSource(fn) {
    if (typeof fn !== "function") return "";
    const source = tryGet(() => Function.prototype.toString.call(fn)) ?? "";
    if (typeof source !== "string") return "";
    return source.toLowerCase().replace(/\s+/g, "");
}

function isLikelySaveGuildFoldersFunction(fn, key = "") {
    if (typeof fn !== "function") return false;

    const source = toCompactSource(fn);
    if (!source) return false;

    const hasStrongHint = SAVE_GUILD_FOLDERS_SOURCE_HINTS.some((hint) => source.includes(hint));
    if (hasStrongHint) return true;

    const normalizedKey = String(key || "").toLowerCase();
    if (normalizedKey !== "saveguildfolders") return false;

    const hasNegativeHint = SAVE_GUILD_FOLDERS_NEGATIVE_HINTS.some((hint) => source.includes(hint));
    if (hasNegativeHint) return false;

    return source.includes("guild") && source.includes("folder") && fn.length >= 1;
}

function resolveDispatcher(bdApi) {
    const webpack = bdApi?.Webpack;
    const candidates = [
        () => webpack?.getByKeys?.("dispatch", "subscribe", "unsubscribe"),
        () => webpack?.getByKeys?.("dispatch", "wait"),
        () => webpack?.getModule?.(
            (module) => module && typeof module.dispatch === "function" && typeof module.subscribe === "function",
            {searchExports: true}
        )
    ];

    for (const getCandidate of candidates) {
        const candidate = tryGet(getCandidate);
        if (candidate && typeof candidate.dispatch === "function") return candidate;
    }

    return null;
}

function installGuildListActionTrace(bdApi, patchScope, logger, options = {}) {
    const patcher = bdApi?.Patcher;
    const dispatcher = resolveDispatcher(bdApi);
    if (!patcher || typeof patcher.before !== "function" || typeof patcher.unpatchAll !== "function") {
        logger?.warn("[GuildDragTrace] unavailable: patcher missing");
        return () => {};
    }
    if (!dispatcher) {
        logger?.warn("[GuildDragTrace] unavailable: dispatcher not found");
        return () => {};
    }

    const tracePatchId = `${patchScope}:GuildDragTrace`;
    const durationMs = typeof options.durationMs === "number" ? options.durationMs : 0;
    const maxEntries = typeof options.maxEntries === "number" ? options.maxEntries : 1000;
    const deadline = durationMs > 0 ? Date.now() + durationMs : Number.POSITIVE_INFINITY;
    let captured = 0;

    patcher.before(tracePatchId, dispatcher, "dispatch", (_, args) => {
        if (Date.now() > deadline) return;
        if (captured >= maxEntries) return;

        const action = args?.[0];
        if (!looksLikeGuildListAction(action)) return;

        captured += 1;
        const snapshot = toTraceActionSnapshot(action);
        let serialized = "";
        try {
            serialized = JSON.stringify(snapshot);
        }
        catch {
            serialized = "[unserializable action]";
        }

        logger?.log(`[GuildDragTrace] dispatch #${captured}`, serialized);
    });

    logger?.log("[GuildDragTrace] enabled", {durationMs, maxEntries});
    return () => {
        patcher.unpatchAll(tracePatchId);
        logger?.log("[GuildDragTrace] disabled", {captured});
    };
}

function getGuildIdFromProps(props) {
    return props?.guild?.id ?? props?.guildId ?? props?.id ?? null;
}

function getMenuGroups(menuTree) {
    if (Array.isArray(menuTree?.props?.children)) return menuTree.props.children;

    if (Array.isArray(menuTree?.props?.children?.props?.children)) return menuTree.props.children.props.children;

    const wrappedChildren = menuTree?.props?.children?.props?.children;
    if (wrappedChildren && !Array.isArray(wrappedChildren)) {
        menuTree.props.children.props.children = [wrappedChildren];
        return menuTree.props.children.props.children;
    }

    const directChild = menuTree?.props?.children;
    if (directChild && !Array.isArray(directChild)) {
        menuTree.props.children = [directChild];
        return menuTree.props.children;
    }

    return null;
}

function getGroupItems(group, normalize = false) {
    if (Array.isArray(group?.props?.children)) return group.props.children;

    if (!normalize) return null;
    if (!group?.props) return null;

    const children = group.props.children;
    if (children == null) {
        group.props.children = [];
        return group.props.children;
    }

    group.props.children = [children];
    return group.props.children;
}

function getOrCreateGroupItems(group) {
    return getGroupItems(group, true);
}

function readGroupItems(group) {
    const items = getGroupItems(group, false);
    if (items) return items;

    const singleChild = group?.props?.children;
    if (singleChild == null) return [];
    return [singleChild];
}

function toItemId(item) {
    return item?.props?.id ?? item?.id ?? null;
}

function hasMoveItem(groups) {
    for (const group of groups) {
        const items = readGroupItems(group);
        for (const item of items) {
            if (toItemId(item) === MENU_ITEM_ID) return true;
        }
    }
    return false;
}

function getItemLabel(item) {
    const label = item?.props?.label;
    if (typeof label !== "string") return "";
    return label.trim().toLowerCase();
}

function findMarkAsReadPosition(groups) {
    for (const group of groups) {
        const items = readGroupItems(group);
        if (!items) continue;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const itemId = toItemId(item);
            const itemLabel = getItemLabel(item);
            if (itemId === "mark-as-read" || itemLabel === "mark as read") {
                return {group, index: i};
            }
        }
    }
    return null;
}

function injectMoveMenuItem(bdApi, menuTree, props, onMove) {
    const guildId = getGuildIdFromProps(props);
    if (!guildId) return false;

    const groups = getMenuGroups(menuTree);
    if (!groups || groups.length === 0) return false;
    if (hasMoveItem(groups)) return false;

    const menuItem = bdApi?.ContextMenu?.buildItem?.({
        id: MENU_ITEM_ID,
        label: MENU_LABEL,
        action: () => onMove(guildId)
    });
    if (!menuItem) return false;

    const anchor = findMarkAsReadPosition(groups);
    if (anchor) {
        const items = getOrCreateGroupItems(anchor.group);
        if (!items) return false;
        items.splice(anchor.index + 1, 0, menuItem);
        return true;
    }

    const firstGroupItems = getOrCreateGroupItems(groups[0]);
    if (!firstGroupItems) return false;
    firstGroupItems.unshift(menuItem);
    return true;
}

function getOrderFromSortedGuildStore(sortedGuildStore) {
    if (typeof sortedGuildStore?.getGuildIds === "function") {
        return sortedGuildStore.getGuildIds();
    }

    if (typeof sortedGuildStore?.getGuildFolders === "function") {
        const folders = sortedGuildStore.getGuildFolders() ?? [];
        const ids = [];
        for (const folder of folders) {
            const guildIds = folder?.guildIds;
            if (!Array.isArray(guildIds)) continue;
            for (const id of guildIds) ids.push(id);
        }
        return ids;
    }

    return null;
}

function getOrderFromSettingsStore(userGuildSettingsStore) {
    if (typeof userGuildSettingsStore?.getGuildPositions === "function") {
        return userGuildSettingsStore.getGuildPositions();
    }

    if (Array.isArray(userGuildSettingsStore?.guildPositions)) {
        return userGuildSettingsStore.guildPositions;
    }

    return null;
}

function normalizeGuildOrder(order) {
    if (!Array.isArray(order)) return [];
    return order.filter((id) => typeof id === "string" && id.length > 0);
}

function isObjectLike(candidate) {
    return !!candidate && (typeof candidate === "object" || typeof candidate === "function");
}

function getOwnPropertyValue(candidate, key, options = {}) {
    if (!isObjectLike(candidate)) return undefined;
    const evaluateGetter = options.evaluateGetter === true;
    const descriptor = tryGet(() => Object.getOwnPropertyDescriptor(candidate, key));
    if (!descriptor) return undefined;
    if ("value" in descriptor) return descriptor.value;
    if (evaluateGetter && typeof descriptor.get === "function") return tryGet(() => descriptor.get.call(candidate));
    return undefined;
}

function getOwnFunction(candidate, key, options = {}) {
    const value = getOwnPropertyValue(candidate, key, options);
    return typeof value === "function" ? value : null;
}

function getOwnObject(candidate, key, options = {}) {
    const value = getOwnPropertyValue(candidate, key, options);
    return isObjectLike(value) ? value : null;
}

