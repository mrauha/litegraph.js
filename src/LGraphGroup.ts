import type { IContextMenuValue, Point, Size } from "./interfaces"
import type { LGraph } from "./LGraph"
import type { ISerialisedGroup } from "./types/serialisation"
import { LiteGraph } from "./litegraph"
import { LGraphCanvas } from "./LGraphCanvas"
import { isInsideRectangle, overlapBounding } from "./measure"
import { LGraphNode } from "./LGraphNode"

export interface IGraphGroup {
    _pos: Point
    _size: Size
    title: string
}

export interface IGraphGroupFlags extends Record<string, unknown> {
    pinned?: true
}

export class LGraphGroup {
    color: string
    title: string
    font?: string
    font_size: number
    _bounding: Float32Array
    _pos: Point
    _size: Size
    _nodes: LGraphNode[]
    graph?: LGraph
    flags: IGraphGroupFlags
    selected?: boolean

    constructor(title?: string) {
        this._ctor(title)
    }

    _ctor(title?: string): void {
        this.title = title || "Group"
        this.font_size = LiteGraph.DEFAULT_GROUP_FONT || 24
        this.color = LGraphCanvas.node_colors.pale_blue
            ? LGraphCanvas.node_colors.pale_blue.groupcolor
            : "#AAA"
        this._bounding = new Float32Array([10, 10, 140, 80])
        this._pos = this._bounding.subarray(0, 2)
        this._size = this._bounding.subarray(2, 4)
        this._nodes = []
        this.graph = null
        this.flags = {}
    }

    /** Position of the group, as x,y co-ordinates in graph space */
    get pos() {
        return this._pos
    }
    set pos(v) {
        if (!v || v.length < 2) return

        this._pos[0] = v[0]
        this._pos[1] = v[1]
    }

    /** Size of the group, as width,height in graph units */
    get size() {
        return this._size
    }
    set size(v) {
        if (!v || v.length < 2) return

        this._size[0] = Math.max(140, v[0])
        this._size[1] = Math.max(80, v[1])
    }

    get nodes() {
        return this._nodes
    }

    get titleHeight() {
        return this.font_size * 1.4
    }

    get pinned() {
        return !!this.flags.pinned
    }

    pin(): void {
        this.flags.pinned = true
    }

    unpin(): void {
        delete this.flags.pinned
    }

    configure(o: ISerialisedGroup): void {
        this.title = o.title
        this._bounding.set(o.bounding)
        this.color = o.color
        this.flags = o.flags || this.flags
        if (o.font_size) this.font_size = o.font_size
    }

    serialize(): ISerialisedGroup {
        const b = this._bounding
        return {
            title: this.title,
            bounding: [
                Math.round(b[0]),
                Math.round(b[1]),
                Math.round(b[2]),
                Math.round(b[3])
            ],
            color: this.color,
            font_size: this.font_size,
            flags: this.flags,
        }
    }

    /**
     * Draws the group on the canvas
     * @param {LGraphCanvas} graphCanvas
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(graphCanvas: LGraphCanvas, ctx: CanvasRenderingContext2D): void {
        const padding = 4

        ctx.fillStyle = this.color
        ctx.strokeStyle = this.color
        const [x, y] = this._pos
        const [width, height] = this._size
        ctx.globalAlpha = 0.25 * graphCanvas.editor_alpha
        ctx.beginPath()
        ctx.rect(x + 0.5, y + 0.5, width, height)
        ctx.fill()
        ctx.globalAlpha = graphCanvas.editor_alpha
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(x + width, y + height)
        ctx.lineTo(x + width - 10, y + height)
        ctx.lineTo(x + width, y + height - 10)
        ctx.fill()

        const font_size = this.font_size || LiteGraph.DEFAULT_GROUP_FONT_SIZE
        ctx.font = font_size + "px Arial"
        ctx.textAlign = "left"
        ctx.fillText(this.title + (this.pinned ? "📌" : ""), x + padding, y + font_size)

        if (LiteGraph.highlight_selected_group && this.selected) {
            graphCanvas.drawSelectionBounding(ctx, this._bounding, {
                shape: LiteGraph.BOX_SHAPE,
                title_height: this.titleHeight,
                title_mode: LiteGraph.NORMAL_TITLE,
                fgcolor: this.color,
                padding,
            })
        }
    }

    resize(width: number, height: number): void {
        if (this.pinned) return

        this._size[0] = width
        this._size[1] = height
    }

    move(deltax: number, deltay: number, ignore_nodes = false): void {
        if (this.pinned) return

        this._pos[0] += deltax
        this._pos[1] += deltay
        if (ignore_nodes) return

        for (let i = 0; i < this._nodes.length; ++i) {
            const node = this._nodes[i]
            node.pos[0] += deltax
            node.pos[1] += deltay
        }
    }

    recomputeInsideNodes(): void {
        this._nodes.length = 0
        const nodes = this.graph._nodes
        const node_bounding = new Float32Array(4)

        for (let i = 0; i < nodes.length; ++i) {
            const node = nodes[i]
            node.getBounding(node_bounding)
            //out of the visible area
            if (!overlapBounding(this._bounding, node_bounding))
                continue

            this._nodes.push(node)
        }
    }

    /**
     * Add nodes to the group and adjust the group's position and size accordingly
     * @param {LGraphNode[]} nodes - The nodes to add to the group
     * @param {number} [padding=10] - The padding around the group
     * @returns {void}
     */
    addNodes(nodes: LGraphNode[], padding: number = 10): void {
        if (!this._nodes && nodes.length === 0) return

        const allNodes = [...(this._nodes || []), ...nodes]

        const bounds = allNodes.reduce((acc, node) => {
            const [x, y] = node.pos
            const [width, height] = node.size
            const isReroute = node.type === "Reroute"
            const isCollapsed = node.flags?.collapsed

            const top = y - (isReroute ? 0 : LiteGraph.NODE_TITLE_HEIGHT)
            const bottom = isCollapsed ? top + LiteGraph.NODE_TITLE_HEIGHT : y + height
            const right = isCollapsed && node._collapsed_width ? x + Math.round(node._collapsed_width) : x + width

            return {
                left: Math.min(acc.left, x),
                top: Math.min(acc.top, top),
                right: Math.max(acc.right, right),
                bottom: Math.max(acc.bottom, bottom)
            }
        }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })

        this.pos = [
            bounds.left - padding,
            bounds.top - padding - this.titleHeight
        ]

        this.size = [
            bounds.right - bounds.left + padding * 2,
            bounds.bottom - bounds.top + padding * 2 + this.titleHeight
        ]
    }

    getMenuOptions(): IContextMenuValue[] {
        return [
            {
                content: this.pinned ? "Unpin" : "Pin",
                callback: () => {
                    if (this.pinned) this.unpin()
                    else this.pin()
                    this.setDirtyCanvas(false, true)
                },
            },
            null,
            { content: "Title", callback: LGraphCanvas.onShowPropertyEditor },
            {
                content: "Color",
                has_submenu: true,
                callback: LGraphCanvas.onMenuNodeColors
            },
            {
                content: "Font size",
                property: "font_size",
                type: "Number",
                callback: LGraphCanvas.onShowPropertyEditor
            },
            null,
            { content: "Remove", callback: LGraphCanvas.onMenuNodeRemove }
        ]
    }

    isPointInTitlebar(x: number, y: number): boolean {
        const b = this._bounding
        return isInsideRectangle(x, y, b[0], b[1], b[2], this.titleHeight)
    }

    isPointInside = LGraphNode.prototype.isPointInside
    setDirtyCanvas = LGraphNode.prototype.setDirtyCanvas
}
