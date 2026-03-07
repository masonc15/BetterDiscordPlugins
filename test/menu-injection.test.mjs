import {describe, it, expect, vi} from "vitest";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const Plugin = require("../MoveServerToTop.plugin.js");

const {__private} = Plugin;

function makeMenuTree() {
    return {
        props: {
            children: [
                {
                    props: {
                        children: [
                            {props: {id: "mark-as-read", label: "Mark As Read"}},
                            {props: {id: "invite-to-server", label: "Invite to Server"}}
                        ]
                    }
                },
                {
                    props: {
                        children: [
                            {props: {id: "leave", label: "Leave Server"}}
                        ]
                    }
                }
            ]
        }
    };
}

function makeBdApi() {
    return {
        ContextMenu: {
            buildItem: vi.fn((props) => ({props}))
        }
    };
}

function findAllItemsById(menuTree, id) {
    const groups = menuTree.props.children ?? [];
    const items = [];
    for (const group of groups) {
        const groupItems = group?.props?.children ?? [];
        for (const item of groupItems) {
            if (item?.props?.id === id) items.push(item);
        }
    }
    return items;
}

describe("context menu injection", () => {
    it("injects one move item after Mark As Read", () => {
        const bdApi = makeBdApi();
        const menuTree = makeMenuTree();
        const onMove = vi.fn();

        const injected = __private.injectMoveMenuItem(bdApi, menuTree, {guild: {id: "g1"}}, onMove);
        expect(injected).toBe(true);

        const items = findAllItemsById(menuTree, __private.MENU_ITEM_ID);
        expect(items).toHaveLength(1);

        const firstGroup = menuTree.props.children[0].props.children;
        expect(firstGroup[1].props.id).toBe(__private.MENU_ITEM_ID);

        firstGroup[1].props.action();
        expect(onMove).toHaveBeenCalledWith("g1");
    });

    it("does not duplicate the item on repeated injection", () => {
        const bdApi = makeBdApi();
        const menuTree = makeMenuTree();
        const onMove = vi.fn();

        __private.injectMoveMenuItem(bdApi, menuTree, {guild: {id: "g1"}}, onMove);
        __private.injectMoveMenuItem(bdApi, menuTree, {guild: {id: "g1"}}, onMove);

        const items = findAllItemsById(menuTree, __private.MENU_ITEM_ID);
        expect(items).toHaveLength(1);
    });

    it("returns false when guild id is missing", () => {
        const bdApi = makeBdApi();
        const menuTree = makeMenuTree();
        const onMove = vi.fn();

        const injected = __private.injectMoveMenuItem(bdApi, menuTree, {}, onMove);
        expect(injected).toBe(false);
    });

    it("falls back to first group when Mark As Read is missing", () => {
        const bdApi = makeBdApi();
        const onMove = vi.fn();
        const menuTree = {
            props: {
                children: [
                    {
                        props: {
                            children: [
                                {props: {id: "invite-to-server", label: "Invite to Server"}}
                            ]
                        }
                    }
                ]
            }
        };

        const injected = __private.injectMoveMenuItem(bdApi, menuTree, {guild: {id: "g1"}}, onMove);
        expect(injected).toBe(true);
        expect(menuTree.props.children[0].props.children[0].props.id).toBe(__private.MENU_ITEM_ID);
    });

    it("supports wrapped group tree shape used by some context menus", () => {
        const bdApi = makeBdApi();
        const onMove = vi.fn();
        const menuTree = {
            props: {
                children: {
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
                }
            }
        };

        const injected = __private.injectMoveMenuItem(bdApi, menuTree, {guild: {id: "g1"}}, onMove);
        expect(injected).toBe(true);
        expect(menuTree.props.children.props.children[0].props.children[1].props.id).toBe(__private.MENU_ITEM_ID);
    });

    it("inserts correctly when a group has a single child element (non-array children)", () => {
        const bdApi = makeBdApi();
        const onMove = vi.fn();
        const menuTree = {
            props: {
                children: [
                    {
                        props: {
                            children: {props: {id: "mark-as-read", label: "Mark As Read"}}
                        }
                    }
                ]
            }
        };

        const injected = __private.injectMoveMenuItem(bdApi, menuTree, {guild: {id: "g1"}}, onMove);
        expect(injected).toBe(true);

        const firstGroupChildren = menuTree.props.children[0].props.children;
        expect(Array.isArray(firstGroupChildren)).toBe(true);
        expect(firstGroupChildren[1].props.id).toBe(__private.MENU_ITEM_ID);
    });
});
