import {describe, it, expect} from "vitest";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const Plugin = require("../MoveServerToTop.plugin.js");
const {__private} = Plugin;

describe("drag trace helpers", () => {
    it("detects guild reorder-like action types", () => {
        expect(__private.looksLikeGuildListAction({type: "GUILD_FOLDER_MOVE"})).toBe(true);
        expect(__private.looksLikeGuildListAction({type: "SIDEBAR_GUILD_DRAG_END"})).toBe(true);
        expect(__private.looksLikeGuildListAction({type: "MESSAGE_CREATE"})).toBe(false);
    });

    it("detects guild reorder-like payload keys even without strong type", () => {
        expect(__private.looksLikeGuildListAction({type: "UNKNOWN", guildId: "123"})).toBe(true);
        expect(__private.looksLikeGuildListAction({type: "UNKNOWN", from: 1, to: 0})).toBe(true);
        expect(__private.looksLikeGuildListAction({type: "UNKNOWN", foo: "bar"})).toBe(false);
    });

    it("builds compact action snapshots", () => {
        const snapshot = __private.toTraceActionSnapshot({
            type: "GUILD_FOLDER_MOVE",
            guildId: "123",
            guildIds: ["123", "456", "789", "000"],
            from: 3,
            to: 0,
            extra: {deep: true}
        });

        expect(snapshot.type).toBe("GUILD_FOLDER_MOVE");
        expect(snapshot.guildId).toBe("123");
        expect(snapshot.guildIds).toEqual(["123", "456", "789", "...(+1 more)"]);
        expect(snapshot.from).toBe(3);
        expect(snapshot.to).toBe(0);
        expect(Array.isArray(snapshot.keys)).toBe(true);
    });
});

