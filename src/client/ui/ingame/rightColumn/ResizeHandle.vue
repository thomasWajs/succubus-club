<template>
    <div
        class="resize-handle"
        :class="orientation"
        title="Drag to resize · Double-click to reset"
        @pointerdown="onPointerDown"
        @dblclick="emit('reset')"
    />
</template>

<script setup lang="ts">
const props = defineProps<{
    orientation: 'vertical' | 'horizontal'
}>()

// Emits the pointer movement (in px) along the handle's axis since the last
// event. Positive means rightward (vertical) or downward (horizontal).
const emit = defineEmits<{
    resize: [delta: number]
    reset: []
}>()

let lastPos = 0

function axisPos(event: PointerEvent) {
    return props.orientation === 'vertical' ? event.clientX : event.clientY
}

function onPointerMove(event: PointerEvent) {
    const pos = axisPos(event)
    emit('resize', pos - lastPos)
    lastPos = pos
}

function onPointerUp(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement
    target.releasePointerCapture(event.pointerId)
    target.removeEventListener('pointermove', onPointerMove)
    target.removeEventListener('pointerup', onPointerUp)
}

function onPointerDown(event: PointerEvent) {
    event.preventDefault()
    const target = event.currentTarget as HTMLElement
    // Pointer capture routes all subsequent move/up events to this element,
    // even when the cursor leaves it during the drag.
    target.setPointerCapture(event.pointerId)
    lastPos = axisPos(event)
    target.addEventListener('pointermove', onPointerMove)
    target.addEventListener('pointerup', onPointerUp)
}
</script>

<style lang="scss" scoped>
.resize-handle {
    z-index: 5;
    user-select: none;
    touch-action: none;
    background: transparent;

    &:hover,
    &:active {
        background: rgba($lighter-teal, 0.6);
    }

    // The vertical handle overlays the column's left border (the divider with
    // the play area).
    &.vertical {
        position: absolute;
        top: 0;
        bottom: 0;
        left: -3px;
        width: 8px;
        cursor: ew-resize;
    }

    // The horizontal handle is an absolute overlay straddling the boundary
    // between the close-up zone and the players list, so it consumes no layout
    // space (the visible gap stays at the players' 4px margin). Its `top` is set
    // inline to the close-up height by the parent.
    &.horizontal {
        position: absolute;
        left: 0;
        right: 0;
        margin-top: -4px;
        height: 8px;
        cursor: ns-resize;
    }
}
</style>
