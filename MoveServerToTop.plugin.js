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

function findSaveGuildFoldersTarget(candidate, maxDepth = 3, depth = 0, visited = new Set()) {
    if (!isObjectLike(candidate)) return null;
    if (visited.has(candidate)) return null;
    visited.add(candidate);

    if (typeof candidate === "function" && isLikelySaveGuildFoldersFunction(candidate, "direct")) {
        return {
            target: null,
            saveGuildFolders: candidate,
            hasSaveClientTheme: false,
            resolvedBy: "direct-function"
        };
    }

    let saveGuildFolders =
        getOwnFunction(candidate, "saveGuildFolders", {evaluateGetter: false}) ??
        getOwnFunction(candidate, "saveGuildFolders", {evaluateGetter: true});
    if (!saveGuildFolders) {
        const directSaveGuildFolders = tryGet(() => candidate.saveGuildFolders);
        if (typeof directSaveGuildFolders === "function") saveGuildFolders = directSaveGuildFolders;
    }
    if (isLikelySaveGuildFoldersFunction(saveGuildFolders, "saveGuildFolders")) {
        let saveClientTheme =
            getOwnFunction(candidate, "saveClientTheme", {evaluateGetter: false}) ??
            getOwnFunction(candidate, "saveClientTheme", {evaluateGetter: true});
        if (!saveClientTheme) {
            const directSaveClientTheme = tryGet(() => candidate.saveClientTheme);
            if (typeof directSaveClientTheme === "function") saveClientTheme = directSaveClientTheme;
        }
        return {
            target: candidate,
            saveGuildFolders,
            hasSaveClientTheme: !!saveClientTheme,
            resolvedBy: "named-saveGuildFolders"
        };
    }

    const descriptors = tryGet(() => Object.getOwnPropertyDescriptors(candidate)) ?? {};
    const descriptorEntries = Object.entries(descriptors).slice(0, 48);
    for (const [key, descriptor] of descriptorEntries) {
        if (SAVE_GUILD_FOLDERS_BLOCKED_KEYS.has(String(key).toLowerCase())) continue;
        if (!descriptor || !("value" in descriptor)) continue;
        const value = descriptor.value;
        if (!isLikelySaveGuildFoldersFunction(value, key)) continue;

        const saveClientTheme = getOwnFunction(candidate, "saveClientTheme", {evaluateGetter: false});
        return {
            target: candidate,
            saveGuildFolders: value,
            hasSaveClientTheme: !!saveClientTheme,
            resolvedBy: `source-heuristic:${key}`
        };
    }

    if (depth >= maxDepth) return null;

    const libraryModules = getOwnObject(candidate, "LibraryModules", {evaluateGetter: true});
    const knownBranches = [
        getOwnObject(candidate, "default", {evaluateGetter: true}),
        getOwnObject(candidate, "Z", {evaluateGetter: true}),
        getOwnObject(candidate, "ZP", {evaluateGetter: true}),
        getOwnObject(candidate, "exports", {evaluateGetter: true}),
        getOwnObject(candidate, "FolderSettingsUtils", {evaluateGetter: true}),
        libraryModules,
        getOwnObject(libraryModules, "FolderSettingsUtils", {evaluateGetter: true})
    ];

    for (const branch of knownBranches) {
        if (!branch) continue;
        const found = findSaveGuildFoldersTarget(branch, maxDepth, depth + 1, visited);
        if (found) return found;
    }

    const keys = tryGet(() => Object.keys(candidate)) ?? [];
    for (const key of keys.slice(0, 24)) {
        const value = getOwnObject(candidate, key, {evaluateGetter: false});
        if (!value) continue;
        const found = findSaveGuildFoldersTarget(value, maxDepth, depth + 1, visited);
        if (found) return found;
    }

    return null;
}

function resolveFolderSettingsDependencies(bdApi, logger = null) {
    const webpack = bdApi?.Webpack;
    const candidates = [
        {
            name: "window.BDFDB.LibraryModules.FolderSettingsUtils",
            get: () => globalThis.BDFDB?.LibraryModules?.FolderSettingsUtils
        },
        {
            name: "window.BDFDB_Global.BDFDB.LibraryModules.FolderSettingsUtils",
            get: () => globalThis.BDFDB_Global?.BDFDB?.LibraryModules?.FolderSettingsUtils
        },
        {
            name: "window.BDFDB_Global.PluginUtils.buildPlugin(...).LibraryModules.FolderSettingsUtils",
            get: () => {
                const buildPlugin = globalThis.BDFDB_Global?.PluginUtils?.buildPlugin;
                if (typeof buildPlugin !== "function") return null;
                const built = buildPlugin({});
                const bdfdb = Array.isArray(built) ? built[1] : null;
                return bdfdb?.LibraryModules?.FolderSettingsUtils ?? null;
            }
        },
        {
            name: "getByKeys(saveGuildFolders)",
            get: () => webpack?.getByKeys?.("saveGuildFolders")
        },
        {
            name: "getByKeys(saveGuildFolders,updateGuildFolders)",
            get: () => webpack?.getByKeys?.("saveGuildFolders", "updateGuildFolders")
        },
        {
            name: "getByKeys(saveGuildFolders,saveClientTheme)",
            get: () => webpack?.getByKeys?.("saveGuildFolders", "saveClientTheme")
        },
        {
            name: "getByStrings(.folderColor,clientThemeSettings:)",
            get: () => webpack?.getByStrings?.(".folderColor", "clientThemeSettings:", {searchExports: true})
        },
        {
            name: "getBySource(.folderColor,clientThemeSettings:)",
            get: () => webpack?.getBySource?.(".folderColor", "clientThemeSettings:", {searchExports: true})
        },
        {
            name: "getWithKey(saveGuildFolders source heuristic)",
            get: () => {
                if (typeof webpack?.getWithKey !== "function") return null;
                const result = webpack.getWithKey(
                    (value) => isLikelySaveGuildFoldersFunction(value),
                    {searchExports: true}
                );
                if (!Array.isArray(result) || result.length < 2) return null;

                const [moduleOrExport, key] = result;
                if (typeof moduleOrExport === "function") {
                    return {__directSaveGuildFolders: moduleOrExport};
                }

                if (!isObjectLike(moduleOrExport) || typeof key !== "string") return null;
                const value = getOwnPropertyValue(moduleOrExport, key, {evaluateGetter: true});
                if (typeof value !== "function") return null;
                return {[key]: value};
            }
        },
        {
            name: "getModule(saveGuildFolders predicate)",
            get: () => webpack?.getModule?.((module) => !!findSaveGuildFoldersTarget(module), {searchExports: true})
        }
    ];

    for (const candidateConfig of candidates) {
        const candidate = tryGet(candidateConfig.get);
        const found = findSaveGuildFoldersTarget(candidate);

        logger?.debug("Inspecting saveGuildFolders candidate", candidateConfig.name, {
            found: !!candidate,
            hasSaveGuildFolders: !!found,
            hasSaveClientTheme: !!found?.hasSaveClientTheme
        });

        if (!found) continue;

        const saveGuildFolders = found.target && found.target !== found.saveGuildFolders
            ? found.saveGuildFolders.bind(found.target)
            : found.saveGuildFolders;

        return {
            folderSettings: found.target,
            saveGuildFolders,
            saveGuildFoldersSource: found.resolvedBy ? `${candidateConfig.name} -> ${found.resolvedBy}` : candidateConfig.name,
            saveGuildFoldersConfidence: getSaveGuildFoldersConfidence(candidateConfig.name, found.resolvedBy)
        };
    }

    return {
        folderSettings: null,
        saveGuildFolders: null,
        saveGuildFoldersSource: null,
        saveGuildFoldersConfidence: 0
    };
}

function getSaveGuildFoldersConfidence(candidateSource = "", resolvedBy = "") {
    const source = String(candidateSource || "").toLowerCase();
    const resolver = String(resolvedBy || "").toLowerCase();

    const isBdfdbSource =
        source.includes("window.bdfdb.librarymodules.foldersettingsutils") ||
        source.includes("window.bdfdb_global.bdfdb.librarymodules.foldersettingsutils") ||
        source.includes("window.bdfdb_global.pluginutils.buildplugin");
    if (isBdfdbSource && resolver === "named-saveguildfolders") return 3;

    if (source.includes("getbykeys(saveguildfolders") && resolver === "named-saveguildfolders") return 3;

    const lowConfidenceSource =
        source.includes("getmodule(saveguildfolders predicate)") ||
        source.includes("getbysource(") ||
        source.includes("getbystrings(") ||
        source.includes("getwithkey(");
    if (lowConfidenceSource) return 0;

    if (resolver.includes("source-heuristic") || resolver === "direct-function") return 0;

    if (resolver === "named-saveguildfolders") return 2;
    return 1;
}

function resolveMoveDependencies(bdApi, logger = null) {
    const webpack = bdApi?.Webpack;

    const guildActionsCandidates = [
        {
            name: "getByKeys(move,toggleGuildFolderExpand)",
            get: () => webpack?.getByKeys?.("move", "toggleGuildFolderExpand")
        },
        {
            name: "getByKeys(move,createGuildFolder)",
            get: () => webpack?.getByKeys?.("move", "createGuildFolder")
        },
        {
            name: "getModule(move + folder methods)",
            get: () => webpack?.getModule?.(
            (module) => module && typeof module.move === "function" &&
                (typeof module.toggleGuildFolderExpand === "function" || typeof module.createGuildFolder === "function"),
            {searchExports: true}
            )
        },
        {
            name: "getModule(move + source heuristic)",
            get: () => webpack?.getModule?.(
            (module) => module && typeof module.move === "function" && /guild|folder|position/i.test(String(module.move)),
            {searchExports: true}
            )
        }
    ];

    let guildActions = null;
    let guildActionsSource = null;
    for (const candidateConfig of guildActionsCandidates) {
        const candidate = tryGet(candidateConfig.get);
        logger?.debug("Inspecting guildActions candidate", candidateConfig.name, {
            found: !!candidate,
            hasMove: typeof candidate?.move === "function"
        });
        if (candidate && typeof candidate.move === "function") {
            guildActions = candidate;
            guildActionsSource = candidateConfig.name;
            break;
        }
    }

    const sortedGuildStore = tryGet(() => webpack?.getStore?.("SortedGuildStore")) ??
        tryGet(() => webpack?.getModule?.(webpack?.Filters?.byStoreName?.("SortedGuildStore"), {searchExports: true}));

    const userGuildSettingsStore = tryGet(() => webpack?.getStore?.("UserGuildSettingsStore")) ??
        tryGet(() => webpack?.getModule?.(webpack?.Filters?.byStoreName?.("UserGuildSettingsStore"), {searchExports: true})) ??
        tryGet(() => webpack?.getByKeys?.("guildPositions", "isMuted"));
    const dispatcher = resolveDispatcher(bdApi);

    const folderDeps = resolveFolderSettingsDependencies(bdApi, logger);
    const folderSettings = folderDeps.folderSettings;
    const saveGuildFolders = folderDeps.saveGuildFolders;
    const saveGuildFoldersSource = folderDeps.saveGuildFoldersSource;
    const saveGuildFoldersConfidence = folderDeps.saveGuildFoldersConfidence ?? 0;

    logger?.debug("Dependency resolution summary", {
        hasGuildActions: !!guildActions,
        guildActionsSource,
        hasSortedGuildStore: !!sortedGuildStore,
        hasUserGuildSettingsStore: !!userGuildSettingsStore,
        hasDispatcher: !!dispatcher,
        hasFolderSettings: !!folderSettings,
        hasSaveGuildFolders: typeof saveGuildFolders === "function",
        saveGuildFoldersSource,
        saveGuildFoldersConfidence
    });

    return {
        guildActions,
        guildActionsSource,
        folderSettings,
        saveGuildFolders,
        saveGuildFoldersSource,
        saveGuildFoldersConfidence,
        dispatchGuildMoveById: typeof dispatcher?.dispatch === "function"
            ? (sourceId, targetId, options = {}) => {
                const payload = {
                    type: "GUILD_MOVE_BY_ID",
                    sourceId,
                    targetId
                };

                if (Object.prototype.hasOwnProperty.call(options, "moveToBelow")) {
                    payload.moveToBelow = options.moveToBelow;
                }
                if (Object.prototype.hasOwnProperty.call(options, "combine")) {
                    payload.combine = options.combine;
                }

                dispatcher.dispatch(payload);
            }
            : null,
        getGuildFolders: () => {
            if (typeof sortedGuildStore?.getGuildFolders === "function") return sortedGuildStore.getGuildFolders();
            return [];
        },
        getGuildOrder: () => {
            const fromSorted = normalizeGuildOrder(getOrderFromSortedGuildStore(sortedGuildStore));
            if (fromSorted.length > 0) return fromSorted;

            const fromSettings = normalizeGuildOrder(getOrderFromSettingsStore(userGuildSettingsStore));
            if (fromSettings.length > 0) return fromSettings;

            return [];
        }
    };
}

function hasSaveGuildFoldersCapability(deps) {
    return typeof (deps?.saveGuildFolders ?? deps?.folderSettings?.saveGuildFolders) === "function";
}

function getSaveGuildFoldersConfidenceFromDeps(deps) {
    const confidence = deps?.saveGuildFoldersConfidence;
    if (Number.isFinite(confidence)) return confidence;
    return hasSaveGuildFoldersCapability(deps) ? 2 : 0;
}

function hasDispatchMoveByIdCapability(deps) {
    return typeof deps?.dispatchGuildMoveById === "function";
}

function getDependenciesCapability(deps) {
    return {
        hasMove: typeof deps?.guildActions?.move === "function",
        hasOrderAccessor: typeof deps?.getGuildOrder === "function",
        hasSaveGuildFolders: hasSaveGuildFoldersCapability(deps),
        saveGuildFoldersConfidence: getSaveGuildFoldersConfidenceFromDeps(deps),
        hasDispatchMoveById: hasDispatchMoveByIdCapability(deps)
    };
}

function shouldPreferDependencies(currentDeps, nextDeps) {
    const current = getDependenciesCapability(currentDeps);
    const next = getDependenciesCapability(nextDeps);

    if (
        current.hasSaveGuildFolders &&
        next.hasSaveGuildFolders &&
        next.saveGuildFoldersConfidence > current.saveGuildFoldersConfidence
    ) {
        return true;
    }

    if (next.hasSaveGuildFolders && !current.hasSaveGuildFolders) return true;
    if (next.hasDispatchMoveById && !current.hasDispatchMoveById) return true;
    if (next.hasOrderAccessor && !current.hasOrderAccessor) return true;
    if (next.hasMove && !current.hasMove) return true;
    return false;
}

function shouldRefreshDependenciesBeforeMove(deps) {
    if (hasSaveGuildFoldersCapability(deps) && getSaveGuildFoldersConfidenceFromDeps(deps) <= 0) return true;
    if (hasSaveGuildFoldersCapability(deps)) return false;
    if (hasDispatchMoveByIdCapability(deps)) return false;
    return true;
}

function getDependencyRefreshReason(deps) {
    if (!hasSaveGuildFoldersCapability(deps)) return "saveGuildFolders unavailable";
    if (getSaveGuildFoldersConfidenceFromDeps(deps) <= 0) return "saveGuildFolders confidence is low";
    if (!hasDispatchMoveByIdCapability(deps)) return "dispatchGuildMoveById unavailable";
    return "dependency refresh requested";
}
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function areOrdersEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function flattenGuildFoldersToOrder(folders) {
    if (!Array.isArray(folders)) return [];
    const order = [];
    for (const folder of folders) {
        const guildIds = Array.isArray(folder?.guildIds) ? folder.guildIds : [];
        for (const id of guildIds) {
            if (typeof id === "string" && id.length > 0) order.push(id);
        }
    }
    return order;
}

function isInvalidSaveGuildFoldersError(error) {
    if (!error) return false;
    const name = String(error.name ?? "");
    const message = String(error.message ?? "").toLowerCase();
    if (!message) return false;
    if (message.includes("reading 'split'") || message.includes("reading \"split\"")) return true;
    if (message.includes("requested message")) return true;
    if (message.includes("minified react error #321")) return true;
    if (name === "TypeError") return false;
    return false;
}

function disableSaveGuildFoldersStrategy(deps, attemptedSaveGuildFolders) {
    if (!deps || typeof deps !== "object") return;
    deps._saveGuildFoldersDisabled = true;

    if (deps.saveGuildFolders === attemptedSaveGuildFolders) {
        deps.saveGuildFolders = null;
    }

    if (deps.folderSettings && deps.folderSettings.saveGuildFolders === attemptedSaveGuildFolders) {
        deps.folderSettings.saveGuildFolders = null;
    }
}

function cloneGuildFoldersForSave(folders) {
    if (!Array.isArray(folders)) return null;

    const cloned = [];
    for (const folder of folders) {
        const guildIds = Array.isArray(folder?.guildIds)
            ? folder.guildIds.filter((id) => typeof id === "string" && id.length > 0)
            : [];
        if (guildIds.length === 0) continue;

        const nextFolder = {guildIds: [...guildIds]};
        if (folder && Object.prototype.hasOwnProperty.call(folder, "folderId")) {
            nextFolder.folderId = folder.folderId ?? null;
        }
        if (typeof folder?.folderName === "string") {
            nextFolder.folderName = folder.folderName;
        }
        if (typeof folder?.folderColor === "number") {
            nextFolder.folderColor = folder.folderColor;
        }

        cloned.push(nextFolder);
    }

    return cloned;
}

async function getSettledGuildFoldersForPersistence(deps, options = {}) {
    const getGuildFolders = deps?.getGuildFolders;
    const getGuildOrder = deps?.getGuildOrder;
    if (typeof getGuildFolders !== "function") return null;

    const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    const pollTimeoutMs = options.pollTimeoutMs ?? Math.max(POLL_TIMEOUT_MS, 800);
    const logger = options.logger ?? null;

    if (typeof getGuildOrder !== "function") return tryGet(getGuildFolders);

    const started = Date.now();
    let latestFolders = null;
    let latestFolderOrder = [];
    while (Date.now() - started <= pollTimeoutMs) {
        latestFolders = tryGet(getGuildFolders);
        latestFolderOrder = flattenGuildFoldersToOrder(latestFolders);
        const latestOrder = normalizeGuildOrder(tryGet(getGuildOrder));
        if (latestOrder.length > 0 && areOrdersEqual(latestFolderOrder, latestOrder)) {
            return latestFolders;
        }
        await wait(pollIntervalMs);
    }

    logger?.warn("Timed out waiting for guild folders to settle before persistence", {
        folderOrder: summarizeOrder(latestFolderOrder),
        guildOrder: summarizeOrder(normalizeGuildOrder(tryGet(getGuildOrder)))
    });
    return latestFolders;
}

async function persistCurrentGuildFolders(deps, logger = null) {
    if (!deps || deps._saveGuildFoldersDisabled) return {status: "skipped"};

    const saveConfidence = getSaveGuildFoldersConfidenceFromDeps(deps);
    if (saveConfidence <= 0) {
        logger?.debug("Skipping persistence via low-confidence saveGuildFolders", {
            saveGuildFoldersSource: deps?.saveGuildFoldersSource ?? null,
            saveGuildFoldersConfidence: saveConfidence
        });
        return {status: "skipped"};
    }

    const saveGuildFolders = deps?.saveGuildFolders ?? deps?.folderSettings?.saveGuildFolders;
    if (typeof saveGuildFolders !== "function" || typeof deps?.getGuildFolders !== "function") {
        return {status: "skipped"};
    }

    const currentFolders = await getSettledGuildFoldersForPersistence(deps, {logger});
    const savePayload = cloneGuildFoldersForSave(currentFolders);
    if (!Array.isArray(savePayload) || savePayload.length === 0) {
        return {status: "skipped"};
    }

    try {
        const saveResult = saveGuildFolders(savePayload);
        if (saveResult && typeof saveResult.then === "function") await saveResult;
        logger?.debug("Persisted guild folders after move", {
            folders: summarizeFolders(savePayload)
        });
        return {status: "persisted"};
    }
    catch (error) {
        if (isInvalidSaveGuildFoldersError(error)) {
            disableSaveGuildFoldersStrategy(deps, saveGuildFolders);
            logger?.debug("Persistence saveGuildFolders looked invalid and was disabled", {
                error: String(error?.message ?? error)
            });
            return {status: "disabled"};
        }

        logger?.warn("Persisting guild folders after move threw", error);
        return {status: "error"};
    }
}

async function waitForGuildAtTop(guildId, getGuildOrder, pollIntervalMs, pollTimeoutMs) {
    const started = Date.now();
    while (Date.now() - started <= pollTimeoutMs) {
        const order = normalizeGuildOrder(tryGet(getGuildOrder));
        if (order[0] === guildId) return true;
        await wait(pollIntervalMs);
    }
    return false;
}

function buildGuildFoldersForMoveToTop(currentFolders, guildId) {
    if (!Array.isArray(currentFolders)) return null;

    const nextFolders = [];
    let extracted = false;

    for (const folder of currentFolders) {
        const folderGuildIds = Array.isArray(folder?.guildIds) ? folder.guildIds : [];
        const remainingIds = [];

        for (const id of folderGuildIds) {
            if (id === guildId) {
                extracted = true;
                continue;
            }
            remainingIds.push(id);
        }

        if (remainingIds.length === 0) continue;

        // If a folder has one guild left, normalize it to plain-guild row.
        if (remainingIds.length === 1) {
            nextFolders.push({guildIds: [remainingIds[0]]});
            continue;
        }

        nextFolders.push({
            ...folder,
            guildIds: remainingIds
        });
    }

    if (!extracted) return null;
    nextFolders.unshift({guildIds: [guildId]});
    return nextFolders;
}

