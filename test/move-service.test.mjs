import {describe, it, expect, vi} from "vitest";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const Plugin = require("../MoveServerToTop.plugin.js");

const {__private} = Plugin;

describe("move service", () => {
    it("prefers guildActions.move(sourceId,targetId) over raw dispatcher fallback", async () => {
        let order = ["g1", "g2", "g3"];
        const move = vi.fn((sourceId, targetId) => {
            if (typeof sourceId !== "string" || typeof targetId !== "string") return;
            const sourceIndex = order.indexOf(sourceId);
            const targetIndex = order.indexOf(targetId);
            if (sourceIndex === -1 || targetIndex === -1) return;

            const [moved] = order.splice(sourceIndex, 1);
            const insertTargetIndex = order.indexOf(targetId);
            order.splice(insertTargetIndex, 0, moved);
        });
        const dispatchGuildMoveById = vi.fn();

        const result = await __private.moveGuildToTop("g3", {
            guildActions: {move},
            dispatchGuildMoveById,
            getGuildOrder: () => order
        }, {pollIntervalMs: 1, pollTimeoutMs: 20});

        expect(result.status).toBe("moved");
        expect(move).toHaveBeenCalledWith("g3", "g1");
        expect(dispatchGuildMoveById).not.toHaveBeenCalled();
        expect(order).toEqual(["g3", "g1", "g2"]);
    });

    it("moves a guild to the top using dispatchGuildMoveById strategy", async () => {
        let order = ["g1", "g2", "g3"];
        const dispatchGuildMoveById = vi.fn((sourceId, targetId, options = {}) => {
            const sourceIndex = order.indexOf(sourceId);
            const targetIndex = order.indexOf(targetId);
            if (sourceIndex === -1 || targetIndex === -1) return;

            const [moved] = order.splice(sourceIndex, 1);
            const insertTargetIndex = order.indexOf(targetId);
            const offset = options.moveToBelow ? 1 : 0;
            order.splice(insertTargetIndex + offset, 0, moved);
        });

        const result = await __private.moveGuildToTop("g3", {
            dispatchGuildMoveById,
            guildActions: {},
            getGuildOrder: () => order
        }, {pollIntervalMs: 1, pollTimeoutMs: 20});

        expect(result.status).toBe("moved");
        expect(dispatchGuildMoveById).toHaveBeenCalledWith("g3", "g1");
        expect(order).toEqual(["g3", "g1", "g2"]);
    });

    it("moves a guild to the top using move(fromIndex, toIndex)", async () => {
        let order = ["g1", "g2", "g3"];
        const move = vi.fn((from, to) => {
            const [item] = order.splice(from, 1);
            order.splice(to, 0, item);
        });

        const result = await __private.moveGuildToTop("g3", {
            guildActions: {move},
            getGuildOrder: () => order
        }, {pollIntervalMs: 1, pollTimeoutMs: 20});

        expect(result.status).toBe("moved");
        expect(move).toHaveBeenCalledWith(2, 0);
        expect(order).toEqual(["g3", "g1", "g2"]);
    });

    it("returns noop when guild is already at top", async () => {
        const move = vi.fn();
        const result = await __private.moveGuildToTop("g1", {
            guildActions: {move},
            getGuildOrder: () => ["g1", "g2", "g3"]
        });

        expect(result.status).toBe("noop");
        expect(move).not.toHaveBeenCalled();
    });

    it("returns error when guild does not exist in current order", async () => {
        const move = vi.fn();
        const result = await __private.moveGuildToTop("g9", {
            guildActions: {move},
            getGuildOrder: () => ["g1", "g2", "g3"]
        });

        expect(result.status).toBe("error");
        expect(result.reason).toContain("not found");
        expect(move).not.toHaveBeenCalled();
    });

    it("falls back to move(guildId, toIndex) signature", async () => {
        let order = ["g1", "g2", "g3"];
        const move = vi.fn((firstArg, secondArg) => {
            if (typeof firstArg !== "string") return;
            const fromIndex = order.indexOf(firstArg);
            if (fromIndex === -1) return;
            const [item] = order.splice(fromIndex, 1);
            order.splice(secondArg, 0, item);
        });

        const result = await __private.moveGuildToTop("g3", {
            guildActions: {move},
            getGuildOrder: () => order
        }, {pollIntervalMs: 1, pollTimeoutMs: 20});

        expect(result.status).toBe("moved");
        expect(move).toHaveBeenCalled();
        expect(order[0]).toBe("g3");
    });

    it("returns error when no usable move function exists", async () => {
        const result = await __private.moveGuildToTop("g3", {
            guildActions: {},
            getGuildOrder: () => ["g1", "g2", "g3"]
        });

        expect(result.status).toBe("error");
        expect(result.reason).toContain("move function");
    });

    it("moves guild to absolute top using saveGuildFolders strategy", async () => {
        let folders = [
            {guildIds: ["g1", "g2"], folderId: "f1"},
            {guildIds: ["g3"]}
        ];

        const saveGuildFolders = vi.fn((nextFolders) => {
            folders = nextFolders;
        });

        const result = await __private.moveGuildToTop("g2", {
            guildActions: {},
            folderSettings: {saveGuildFolders},
            getGuildFolders: () => folders,
            getGuildOrder: () => folders.flatMap((f) => f.guildIds)
        }, {pollIntervalMs: 1, pollTimeoutMs: 20});

        expect(result.status).toBe("moved");
        expect(saveGuildFolders).toHaveBeenCalledTimes(1);
        expect(folders[0].guildIds).toEqual(["g2"]);
        expect(folders.flatMap((f) => f.guildIds)[0]).toBe("g2");
    });

    it("uses top-level saveGuildFolders dependency when folderSettings wrapper is absent", async () => {
        let folders = [
            {guildIds: ["g1", "g2"], folderId: "f1"},
            {guildIds: ["g3"]}
        ];

        const saveGuildFolders = vi.fn((nextFolders) => {
            folders = nextFolders;
        });

        const result = await __private.moveGuildToTop("g2", {
            guildActions: {},
            saveGuildFolders,
            getGuildFolders: () => folders,
            getGuildOrder: () => folders.flatMap((f) => f.guildIds)
        }, {pollIntervalMs: 1, pollTimeoutMs: 20});

        expect(result.status).toBe("moved");
        expect(saveGuildFolders).toHaveBeenCalledTimes(1);
        expect(folders.flatMap((f) => f.guildIds)[0]).toBe("g2");
    });

    it("prefers dispatch strategy over saveGuildFolders when both are available", async () => {
        let order = ["g1", "g2", "g3"];
        const saveGuildFolders = vi.fn(() => {
            throw new TypeError("Cannot read properties of undefined (reading 'split')");
        });
        const dispatchGuildMoveById = vi.fn((sourceId, targetId, options = {}) => {
            const sourceIndex = order.indexOf(sourceId);
            const targetIndex = order.indexOf(targetId);
            if (sourceIndex === -1 || targetIndex === -1) return;

            const [moved] = order.splice(sourceIndex, 1);
            const insertTargetIndex = order.indexOf(targetId);
            const offset = options.moveToBelow ? 1 : 0;
            order.splice(insertTargetIndex + offset, 0, moved);
        });

        const deps = {
            saveGuildFolders,
            dispatchGuildMoveById,
            getGuildFolders: () => [{guildIds: [...order]}],
            getGuildOrder: () => [...order]
        };

        const first = await __private.moveGuildToTop("g3", deps, {pollIntervalMs: 1, pollTimeoutMs: 20});
        expect(first.status).toBe("moved");
        expect(saveGuildFolders).toHaveBeenCalledTimes(1);
        expect(dispatchGuildMoveById).toHaveBeenCalledTimes(1);
        expect(order).toEqual(["g3", "g1", "g2"]);
        expect(deps._saveGuildFoldersDisabled).toBe(true);
    });

    it("persists current folder order after successful dispatch move", async () => {
        let order = ["g1", "g2", "g3"];
        const savedPayloads = [];
        const saveGuildFolders = vi.fn((folders) => {
            savedPayloads.push(folders);
        });
        const dispatchGuildMoveById = vi.fn((sourceId, targetId) => {
            const sourceIndex = order.indexOf(sourceId);
            const targetIndex = order.indexOf(targetId);
            if (sourceIndex === -1 || targetIndex === -1) return;

            const [moved] = order.splice(sourceIndex, 1);
            const insertTargetIndex = order.indexOf(targetId);
            order.splice(insertTargetIndex, 0, moved);
        });

        const deps = {
            saveGuildFolders,
            dispatchGuildMoveById,
            getGuildFolders: () => order.map((id) => ({folderId: null, guildIds: [id]})),
            getGuildOrder: () => [...order]
        };

        const result = await __private.moveGuildToTop("g3", deps, {pollIntervalMs: 1, pollTimeoutMs: 20});
        expect(result.status).toBe("moved");
        expect(dispatchGuildMoveById).toHaveBeenCalledTimes(1);
        expect(saveGuildFolders).toHaveBeenCalledTimes(1);
        expect(savedPayloads[0].map((folder) => folder.guildIds[0])).toEqual(["g3", "g1", "g2"]);
    });

    it("waits for folder store to settle before persisting after dispatch move", async () => {
        let order = ["g1", "g2", "g3"];
        let folders = [
            {folderId: null, guildIds: ["g1"]},
            {folderId: null, guildIds: ["g2"]},
            {folderId: null, guildIds: ["g3"]}
        ];
        const savedPayloads = [];

        const saveGuildFolders = vi.fn((nextFolders) => {
            savedPayloads.push(nextFolders);
        });
        const dispatchGuildMoveById = vi.fn((sourceId, targetId) => {
            const sourceIndex = order.indexOf(sourceId);
            const targetIndex = order.indexOf(targetId);
            if (sourceIndex === -1 || targetIndex === -1) return;

            const [moved] = order.splice(sourceIndex, 1);
            const insertTargetIndex = order.indexOf(targetId);
            order.splice(insertTargetIndex, 0, moved);

            // Simulate a lagging folder store that settles shortly after the order store.
            setTimeout(() => {
                folders = order.map((id) => ({folderId: null, guildIds: [id]}));
            }, 40);
        });

        const deps = {
            saveGuildFolders,
            saveGuildFoldersConfidence: 3,
            dispatchGuildMoveById,
            getGuildFolders: () => folders,
            getGuildOrder: () => [...order]
        };

        const result = await __private.moveGuildToTop("g3", deps, {pollIntervalMs: 5, pollTimeoutMs: 300});
        expect(result.status).toBe("moved");
        expect(saveGuildFolders).toHaveBeenCalledTimes(1);
        expect(savedPayloads[0].map((folder) => folder.guildIds[0])).toEqual(["g3", "g1", "g2"]);
    });

    it("awaits async saveGuildFolders completion before returning moved result", async () => {
        let order = ["g1", "g2", "g3"];
        let saveFinished = false;
        const saveGuildFolders = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            saveFinished = true;
        });
        const dispatchGuildMoveById = vi.fn((sourceId, targetId) => {
            const sourceIndex = order.indexOf(sourceId);
            const targetIndex = order.indexOf(targetId);
            if (sourceIndex === -1 || targetIndex === -1) return;

            const [moved] = order.splice(sourceIndex, 1);
            const insertTargetIndex = order.indexOf(targetId);
            order.splice(insertTargetIndex, 0, moved);
        });

        const deps = {
            saveGuildFolders,
            saveGuildFoldersConfidence: 3,
            dispatchGuildMoveById,
            getGuildFolders: () => order.map((id) => ({folderId: null, guildIds: [id]})),
            getGuildOrder: () => [...order]
        };

        const result = await __private.moveGuildToTop("g3", deps, {pollIntervalMs: 1, pollTimeoutMs: 100});
        expect(result.status).toBe("moved");
        expect(saveGuildFolders).toHaveBeenCalledTimes(1);
        expect(saveFinished).toBe(true);
    });

    it("disables invalid saveGuildFolders strategy after split TypeError and uses move fallback", async () => {
        let order = ["g1", "g2", "g3"];
        const saveGuildFolders = vi.fn(() => {
            throw new TypeError("Cannot read properties of undefined (reading 'split')");
        });
        const move = vi.fn((from, to) => {
            const [item] = order.splice(from, 1);
            order.splice(to, 0, item);
        });

        const deps = {
            saveGuildFolders,
            guildActions: {move},
            getGuildFolders: () => [{guildIds: [...order]}],
            getGuildOrder: () => [...order]
        };

        const first = await __private.moveGuildToTop("g3", deps, {pollIntervalMs: 1, pollTimeoutMs: 20});
        expect(first.status).toBe("moved");
        expect(saveGuildFolders).toHaveBeenCalledTimes(1);
        expect(order).toEqual(["g3", "g1", "g2"]);
        expect(move).toHaveBeenCalledWith(2, 0);
        expect(deps._saveGuildFoldersDisabled).toBe(true);
        expect(deps.saveGuildFolders).toBeNull();

        const second = await __private.moveGuildToTop("g1", deps, {pollIntervalMs: 1, pollTimeoutMs: 20});
        expect(second.status).toBe("moved");
        expect(saveGuildFolders).toHaveBeenCalledTimes(1);
        expect(order).toEqual(["g1", "g3", "g2"]);
        expect(move).toHaveBeenCalledWith(1, 0);
    });

    it("disables invalid saveGuildFolders strategy after React #321 hook error", async () => {
        let order = ["g1", "g2", "g3"];
        const saveGuildFolders = vi.fn(() => {
            throw new Error("Minified React error #321; visit https://react.dev/errors/321");
        });
        const move = vi.fn((from, to) => {
            const [item] = order.splice(from, 1);
            order.splice(to, 0, item);
        });

        const deps = {
            saveGuildFolders,
            saveGuildFoldersConfidence: 2,
            guildActions: {move},
            getGuildFolders: () => [{guildIds: [...order]}],
            getGuildOrder: () => [...order]
        };

        const first = await __private.moveGuildToTop("g3", deps, {pollIntervalMs: 1, pollTimeoutMs: 20});
        expect(first.status).toBe("moved");
        expect(saveGuildFolders).toHaveBeenCalledTimes(1);
        expect(deps._saveGuildFoldersDisabled).toBe(true);
        expect(deps.saveGuildFolders).toBeNull();
    });
});
