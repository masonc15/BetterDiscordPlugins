import {describe, it, expect, vi} from "vitest";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const Plugin = require("../MoveServerToTop.plugin.js");

const {__private} = Plugin;

describe("dependency resolution", () => {
    it("gets guild order from SortedGuildStore.getGuildIds", () => {
        const move = () => {};
        const bdApi = {
            Webpack: {
                getByKeys: (a, b) => (a === "move" && b === "toggleGuildFolderExpand" ? {move} : null),
                getStore: (name) => {
                    if (name === "SortedGuildStore") return {getGuildIds: () => ["g1", "g2", "g3"]};
                    return null;
                }
            }
        };

        const deps = __private.resolveMoveDependencies(bdApi);
        expect(deps.guildActions.move).toBe(move);
        expect(deps.getGuildOrder()).toEqual(["g1", "g2", "g3"]);
    });

    it("falls back to flatten getGuildFolders when getGuildIds is unavailable", () => {
        const move = () => {};
        const bdApi = {
            Webpack: {
                getByKeys: (a, b) => (a === "move" && b === "createGuildFolder" ? {move} : null),
                getStore: (name) => {
                    if (name === "SortedGuildStore") {
                        return {
                            getGuildFolders: () => [
                                {guildIds: ["g2", "g3"]},
                                {guildIds: ["g1"]}
                            ]
                        };
                    }
                    return null;
                }
            }
        };

        const deps = __private.resolveMoveDependencies(bdApi);
        expect(deps.getGuildOrder()).toEqual(["g2", "g3", "g1"]);
    });

    it("falls back to UserGuildSettingsStore guild positions when SortedGuildStore is empty", () => {
        const move = () => {};
        const bdApi = {
            Webpack: {
                getByKeys: (a, b) => {
                    if (a === "move" && b === "createGuildFolder") return {move};
                    if (a === "guildPositions" && b === "isMuted") return {guildPositions: ["g9", "g8"]};
                    return null;
                },
                getStore: (name) => {
                    if (name === "SortedGuildStore") return {getGuildIds: () => []};
                    if (name === "UserGuildSettingsStore") return {getGuildPositions: () => ["g4", "g5", "g6"]};
                    return null;
                }
            }
        };

        const deps = __private.resolveMoveDependencies(bdApi);
        expect(deps.getGuildOrder()).toEqual(["g4", "g5", "g6"]);
    });

    it("resolves dispatchGuildMoveById when dispatcher is available", () => {
        const move = () => {};
        const dispatch = vi.fn();

        const bdApi = {
            Webpack: {
                getByKeys: (a, b) => {
                    if (a === "move" && b === "toggleGuildFolderExpand") return {move};
                    if (a === "dispatch" && b === "subscribe") {
                        return {dispatch, subscribe: () => {}, unsubscribe: () => {}};
                    }
                    return null;
                },
                getStore: (name) => {
                    if (name === "SortedGuildStore") return {getGuildIds: () => ["g1", "g2", "g3"]};
                    return null;
                }
            }
        };

        const deps = __private.resolveMoveDependencies(bdApi);
        expect(typeof deps.dispatchGuildMoveById).toBe("function");
        deps.dispatchGuildMoveById("g3", "g1");
        expect(dispatch).toHaveBeenCalledWith({
            type: "GUILD_MOVE_BY_ID",
            sourceId: "g3",
            targetId: "g1"
        });
    });

    it("resolves saveGuildFolders when it is nested under a wrapped export", () => {
        const move = () => {};
        const saveGuildFolders = (nextFolders) => {
            const marker = ".folderColor,clientThemeSettings:";
            return {nextFolders, marker};
        };
        const wrappedModule = {default: {saveGuildFolders}};

        const bdApi = {
            Webpack: {
                getByKeys: (a, b) => {
                    if (a === "move" && b === "toggleGuildFolderExpand") return {move};
                    return null;
                },
                getStore: (name) => {
                    if (name === "SortedGuildStore") return {getGuildIds: () => ["g1", "g2"]};
                    return null;
                },
                getModule: (filter) => {
                    if (typeof filter === "function" && filter(wrappedModule)) return wrappedModule;
                    return null;
                }
            }
        };

        const deps = __private.resolveMoveDependencies(bdApi);
        expect(typeof deps.saveGuildFolders).toBe("function");
    });

    it("resolves saveGuildFolders through BdApi.Webpack even when global library objects exist", () => {
        const move = () => {};
        let webpackSaveCalls = 0;
        let globalSaveCalls = 0;

        function webpackSaveGuildFolders(guildFolders) {
            webpackSaveCalls += 1;
            return guildFolders;
        }

        const oldBdfdb = globalThis.BDFDB;
        globalThis.BDFDB = {
            LibraryModules: {
                FolderSettingsUtils: {
                    saveGuildFolders: () => {
                        globalSaveCalls += 1;
                    }
                }
            }
        };

        try {
            const bdApi = {
                Webpack: {
                    getByKeys: (a, b) => {
                        if (a === "move" && b === "toggleGuildFolderExpand") return {move};
                        if (a === "saveGuildFolders") return {saveGuildFolders: webpackSaveGuildFolders};
                        return null;
                    },
                    getStore: (name) => {
                        if (name === "SortedGuildStore") return {getGuildIds: () => ["g1", "g2"]};
                        return null;
                    }
                }
            };

            const deps = __private.resolveMoveDependencies(bdApi);
            expect(typeof deps.saveGuildFolders).toBe("function");
            deps.saveGuildFolders([{guildIds: ["g1"]}]);
            expect(webpackSaveCalls).toBe(1);
            expect(globalSaveCalls).toBe(0);
        }
        finally {
            globalThis.BDFDB = oldBdfdb;
        }
    });

    it("uses direct-function getBySource candidate before fallback getModule heuristic", () => {
        const move = () => {};
        let directSaveCalls = 0;
        function directSaveGuildFolders(nextFolders) {
            const marker = ".folderColor,clientThemeSettings:";
            directSaveCalls += 1;
            return [marker, nextFolders];
        }
        const invalidHeuristicModule = {
            action: vi.fn(() => {
                const marker = ".folderColor,clientThemeSettings:";
                return marker.split(",");
            })
        };

        const bdApi = {
            Webpack: {
                getByKeys: (a, b) => (a === "move" && b === "toggleGuildFolderExpand" ? {move} : null),
                getBySource: () => directSaveGuildFolders,
                getModule: () => invalidHeuristicModule,
                getStore: (name) => {
                    if (name === "SortedGuildStore") return {getGuildIds: () => ["g1", "g2"]};
                    return null;
                }
            }
        };

        const deps = __private.resolveMoveDependencies(bdApi);
        expect(typeof deps.saveGuildFolders).toBe("function");
        deps.saveGuildFolders([{guildIds: ["g1"]}]);
        expect(directSaveCalls).toBe(1);
        expect(invalidHeuristicModule.action).not.toHaveBeenCalled();
    });

    it("resolves mangled save function via source heuristics", () => {
        const move = () => {};
        const mangledModule = {
            xY: (nextFolders) => {
                const marker = ".folderColor,clientThemeSettings:";
                return [marker, nextFolders];
            }
        };

        const bdApi = {
            Webpack: {
                getByKeys: (a, b) => {
                    if (a === "move" && b === "toggleGuildFolderExpand") return {move};
                    return null;
                },
                getStore: (name) => {
                    if (name === "SortedGuildStore") return {getGuildIds: () => ["g1", "g2"]};
                    return null;
                },
                getBySource: () => mangledModule,
                getModule: () => null
            }
        };

        const deps = __private.resolveMoveDependencies(bdApi);
        expect(typeof deps.saveGuildFolders).toBe("function");
    });

    it("rejects localization-like saveGuildFolders functions", () => {
        const move = () => {};
        const localizedModule = {
            saveGuildFolders(locale) {
                return `Requested message saveGuildFolders locale ${locale}`;
            },
            saveClientTheme(locale) {
                return `Requested message saveClientTheme locale ${locale}`;
            }
        };

        const bdApi = {
            Webpack: {
                getByKeys: (a, b) => {
                    if (a === "move" && b === "toggleGuildFolderExpand") return {move};
                    if (a === "saveGuildFolders") return localizedModule;
                    return null;
                },
                getStore: (name) => {
                    if (name === "SortedGuildStore") return {getGuildIds: () => ["g1", "g2"]};
                    return null;
                },
                getModule: () => null
            }
        };

        const deps = __private.resolveMoveDependencies(bdApi);
        expect(deps.saveGuildFolders).toBeNull();
    });

    it("rejects proxy-like modules that fake any property as a function", () => {
        const move = () => {};
        const fakeProxy = new Proxy({}, {
            get: () => vi.fn()
        });

        const bdApi = {
            Webpack: {
                getByKeys: (a, b) => {
                    if (a === "move" && b === "toggleGuildFolderExpand") return {move};
                    return null;
                },
                getStore: (name) => {
                    if (name === "SortedGuildStore") return {getGuildIds: () => ["g1", "g2"]};
                    return null;
                },
                getModule: (filter) => {
                    if (typeof filter === "function" && filter(fakeProxy)) return fakeProxy;
                    return null;
                }
            }
        };

        const deps = __private.resolveMoveDependencies(bdApi);
        expect(deps.saveGuildFolders).toBeNull();
    });

    it("skips pre-move dependency refresh when dispatch strategy is already available", () => {
        expect(__private.shouldRefreshDependenciesBeforeMove({
            dispatchGuildMoveById: () => {},
            saveGuildFolders: null
        })).toBe(false);
    });

    it("requests pre-move dependency refresh when neither save nor dispatch strategies are available", () => {
        expect(__private.shouldRefreshDependenciesBeforeMove({
            dispatchGuildMoveById: null,
            saveGuildFolders: null
        })).toBe(true);
    });

    it("requests pre-move dependency refresh when saveGuildFolders source confidence is low", () => {
        expect(__private.shouldRefreshDependenciesBeforeMove({
            dispatchGuildMoveById: () => {},
            saveGuildFolders: () => {},
            saveGuildFoldersConfidence: 0
        })).toBe(true);
    });

    it("prefers refreshed dependencies when saveGuildFolders confidence improves", () => {
        expect(__private.shouldPreferDependencies(
            {saveGuildFolders: () => {}, saveGuildFoldersConfidence: 0},
            {saveGuildFolders: () => {}, saveGuildFoldersConfidence: 3}
        )).toBe(true);
    });
});
