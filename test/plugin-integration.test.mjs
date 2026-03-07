import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);

function makeMenuTree() {
    return {
        props: {
            children: [
                {
                    props: {
                        children: [
                            {props: {id: "mark-as-read", label: "Mark As Read"}}
                        ]
                    }
                }
            ]
        }
    };
}

describe("plugin integration", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        delete global.BdApi;
    });

    it("patches guild-context on start and unpatches on stop", () => {
        const unpatch = vi.fn();
        const patch = vi.fn(() => unpatch);

        global.BdApi = {
            ContextMenu: {
                patch,
                buildItem: vi.fn((props) => ({props}))
            },
            UI: {showToast: vi.fn()},
            Logger: {error: vi.fn(), warn: vi.fn()},
            Webpack: {}
        };

        const Plugin = require("../MoveServerToTop.plugin.js");
        const instance = new Plugin({name: "MoveServerToTop"});

        instance.start();
        expect(patch).toHaveBeenCalledWith("guild-context", expect.any(Function));

        instance.stop();
        expect(unpatch).toHaveBeenCalledTimes(1);
    });

    it("restarting does not leak patchers (unpatches previous before repatching)", () => {
        const firstUnpatch = vi.fn();
        const secondUnpatch = vi.fn();
        const patch = vi.fn()
            .mockReturnValueOnce(firstUnpatch)
            .mockReturnValueOnce(secondUnpatch);

        global.BdApi = {
            ContextMenu: {
                patch,
                buildItem: vi.fn((props) => ({props}))
            },
            UI: {showToast: vi.fn()},
            Logger: {error: vi.fn(), warn: vi.fn()},
            Webpack: {}
        };

        const Plugin = require("../MoveServerToTop.plugin.js");
        const instance = new Plugin({name: "MoveServerToTop"});

        instance.start();
        instance.start();

        expect(firstUnpatch).toHaveBeenCalledTimes(1);
        expect(patch).toHaveBeenCalledTimes(2);

        instance.stop();
        expect(secondUnpatch).toHaveBeenCalledTimes(1);
    });

    it("injected item action triggers move and success toast", async () => {
        let callback;
        const patch = vi.fn((_, cb) => {
            callback = cb;
            return vi.fn();
        });
        const showToast = vi.fn();
        const move = vi.fn((from, to) => {
            const [item] = order.splice(from, 1);
            order.splice(to, 0, item);
        });
        let order = ["g1", "g2", "g3"];

        global.BdApi = {
            ContextMenu: {
                patch,
                buildItem: vi.fn((props) => ({props}))
            },
            UI: {showToast},
            Logger: {error: vi.fn(), warn: vi.fn()},
            Webpack: {}
        };

        const Plugin = require("../MoveServerToTop.plugin.js");
        const instance = new Plugin({name: "MoveServerToTop"});
        instance._deps = {guildActions: {move}, getGuildOrder: () => order};
        instance.start();

        const tree = makeMenuTree();
        callback(tree, {guild: {id: "g3"}});

        const inserted = tree.props.children[0].props.children.find((item) => item?.props?.id === Plugin.__private.MENU_ITEM_ID);
        expect(inserted).toBeTruthy();

        await inserted.props.action();
        expect(move).toHaveBeenCalled();
        expect(order[0]).toBe("g3");
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Moved"), expect.any(Object));
    });

    it("shows noop toast when guild is already at top", async () => {
        let callback;
        const patch = vi.fn((_, cb) => {
            callback = cb;
            return vi.fn();
        });
        const showToast = vi.fn();
        const move = vi.fn();
        const order = ["g1", "g2", "g3"];

        global.BdApi = {
            ContextMenu: {
                patch,
                buildItem: vi.fn((props) => ({props}))
            },
            UI: {showToast},
            Logger: {error: vi.fn(), warn: vi.fn()},
            Webpack: {}
        };

        const Plugin = require("../MoveServerToTop.plugin.js");
        const instance = new Plugin({name: "MoveServerToTop"});
        instance._deps = {guildActions: {move}, getGuildOrder: () => order};
        instance.start();

        const tree = makeMenuTree();
        callback(tree, {guild: {id: "g1"}});
        const inserted = tree.props.children[0].props.children.find((item) => item?.props?.id === Plugin.__private.MENU_ITEM_ID);

        await inserted.props.action();
        expect(move).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining("already"), expect.any(Object));
    });

    it("shows error toast when move dependency is missing", async () => {
        let callback;
        const patch = vi.fn((_, cb) => {
            callback = cb;
            return vi.fn();
        });
        const showToast = vi.fn();
        const order = ["g1", "g2", "g3"];

        global.BdApi = {
            ContextMenu: {
                patch,
                buildItem: vi.fn((props) => ({props}))
            },
            UI: {showToast},
            Logger: {error: vi.fn(), warn: vi.fn()},
            Webpack: {}
        };

        const Plugin = require("../MoveServerToTop.plugin.js");
        const instance = new Plugin({name: "MoveServerToTop"});
        instance._deps = {guildActions: {}, getGuildOrder: () => order};
        instance.start();

        const tree = makeMenuTree();
        callback(tree, {guild: {id: "g3"}});
        const inserted = tree.props.children[0].props.children.find((item) => item?.props?.id === Plugin.__private.MENU_ITEM_ID);

        await inserted.props.action();
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Unable"), expect.any(Object));
    });

    it("refreshes stale dependencies on click and uses saveGuildFolders once available", async () => {
        let stage = 0;
        let folders = [
            {guildIds: ["g1", "g2"], folderId: "f1"},
            {guildIds: ["g3"]}
        ];

        const showToast = vi.fn();
        const move = vi.fn();
        let saveCalls = 0;
        const saveGuildFolders = (nextFolders) => {
            const marker = ".folderColor,clientThemeSettings:";
            void marker;
            saveCalls += 1;
            folders = nextFolders;
        };

        global.BdApi = {
            ContextMenu: {
                patch: vi.fn(() => vi.fn()),
                buildItem: vi.fn((props) => ({props}))
            },
            UI: {showToast},
            Logger: {error: vi.fn(), warn: vi.fn()},
            Webpack: {
                getByKeys: (a, b) => {
                    if (a === "move" && b === "toggleGuildFolderExpand") return {move};
                    if (a === "saveGuildFolders" && stage === 1) return {saveGuildFolders};
                    return null;
                },
                getStore: (name) => {
                    if (name !== "SortedGuildStore") return null;
                    return {
                        getGuildIds: () => folders.flatMap((folder) => folder.guildIds),
                        getGuildFolders: () => folders
                    };
                },
                getModule: () => null
            }
        };

        const Plugin = require("../MoveServerToTop.plugin.js");
        const instance = new Plugin({name: "MoveServerToTop"});
        instance.start();

        // Simulate dependencies becoming available after startup.
        stage = 1;

        const result = await instance._onMoveClick("g2");
        expect(result.status).toBe("moved");
        expect(saveCalls).toBe(1);
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Moved"), expect.any(Object));
    });
});
