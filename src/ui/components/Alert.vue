<template>
    <div
        v-if="bus.alert?.blockInteraction"
        class="interaction-blocker"
    />
    <Transition name="slide-fade">
        <div
            v-if="bus.alert"
            class="alert-container"
        >
            <div
                class="alert"
                :class="bus.alert.type"
            >
                {{ bus.alert.message }}
                <button
                    v-if="bus.alert.dismissible"
                    class="alert-dismiss"
                    title="Dismiss"
                    @click="bus.dismissAlert()"
                >
                    <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <line
                            x1="18"
                            y1="6"
                            x2="6"
                            y2="18"
                        />
                        <line
                            x1="6"
                            y1="6"
                            x2="18"
                            y2="18"
                        />
                    </svg>
                </button>
            </div>
        </div>
    </Transition>
</template>

<script setup lang="ts">
import { useBusStore } from '@/store/bus.ts'

const bus = useBusStore()
</script>

<style lang="scss" scoped>
.interaction-blocker {
    position: fixed;
    inset: 0;
    background: rgba(black, 0.5);
    z-index: 1099;
    cursor: not-allowed;
}

.alert-container {
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1100;
    min-width: 300px;
    max-width: 800px;
}

.alert {
    padding: 15px 45px 15px 20px;
    border-radius: 6px;
    position: relative;
    font-size: 1.05em;
    font-weight: 500;
    z-index: 1101;

    &.error {
        background-color: #2d1a1a;
        border: 1px solid #6b3636;
        color: #e89999;
    }

    &.success {
        background-color: #1a2d1a;
        border: 1px solid #2d5a2d;
        color: #7ad47a;
    }

    &.warning {
        background-color: #2d251a;
        border: 1px solid #5a4d2d;
        color: #d4b47a;
    }
}

.alert-dismiss {
    @include flex-center;
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: inherit;
    opacity: 0.7;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    transition: all 0.2s ease;

    &:hover {
        opacity: 1;
        background-color: rgba(black, 0.1);
    }
}

/* Transition animations */
.slide-fade-enter-active,
.slide-fade-leave-active {
    transition: all 0.3s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
    transform: translateX(-50%) translateY(-20px);
    opacity: 0;
}
</style>
