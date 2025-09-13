<template>
    <div
        class="avatar-circle"
        :class="{ 'can-edit': canEdit }"
        :style="{
            width,
            height,
            fontSize,
        }"
        @click="emit('click')"
    >
        <template v-if="avatar">
            <img
                :src="avatar"
                :alt="playerName"
                class="avatar-image"
            />
        </template>
        <template v-else>
            {{ playerName.charAt(0).toUpperCase() }}
        </template>

        <div
            v-if="canEdit"
            class="avatar-overlay"
        >
            <svg
                class="pen-icon"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path
                    d="M3 17.25V21H6.75L17.81 9.94L14.06 6.19L3 17.25ZM20.71 7.04C21.1 6.65 21.1 6.02 20.71 5.63L18.37 3.29C17.98 2.9 17.35 2.9 16.96 3.29L15.13 5.12L18.88 8.87L20.71 7.04Z"
                    fill="currentColor"
                />
            </svg>
        </div>
    </div>
</template>

<script setup lang="ts">
const { avatar, playerName, width, height, fontSize, canEdit } = defineProps<{
    avatar: string | null
    playerName: string
    width: string
    height: string
    fontSize: string
    canEdit?: boolean
}>()

interface Emits {
    (e: 'click'): void
}
const emit = defineEmits<Emits>()
</script>

<style lang="scss">
.avatar-circle {
    @include flex-center;

    border-radius: 50%;
    font-weight: bold;
    overflow: hidden;
    border: 2px solid $mist-grey;

    background: linear-gradient(135deg, $ash-grey 0%, $bone-grey 100%);
    color: $pearl-grey;

    position: relative;
    transition: transform 0.2s ease;

    &.can-edit {
        cursor: pointer;
    }

    &:hover {
        .avatar-overlay {
            opacity: 1;
        }
    }
}

.avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.avatar-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(black, 0.5);
    border-radius: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease;
}

.pen-icon {
    color: white;
    width: 24px;
    height: 24px;
}
</style>
