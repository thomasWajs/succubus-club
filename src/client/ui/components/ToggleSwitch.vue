<template>
    <div class="toggle-switch-container">
        <label
            v-if="label"
            class="toggle-switch-label"
        >
            {{ label }}
        </label>
        <div class="toggle-switch-options">
            <div
                v-for="option in options"
                :key="option.value"
                class="toggle-option"
                :class="{ active: modelValue === option.value }"
                @click="handleSelect(option.value)"
            >
                <div class="option-header">
                    <span class="option-label">{{ option.label }}</span>
                    <span
                        v-if="option.tooltip"
                        class="option-info"
                        :title="option.tooltip"
                        >ⓘ</span
                    >
                </div>
                <div class="option-description">{{ option.description }}</div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
export interface ToggleOption {
    value: string
    label: string
    description?: string
    tooltip?: string
}

interface Props {
    label?: string
    options: ToggleOption[]
    modelValue: string
    disabled?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
    'update:modelValue': [value: string]
}>()

function handleSelect(value: string) {
    if (!props.disabled) {
        emit('update:modelValue', value)
    }
}
</script>

<style lang="scss" scoped>
.toggle-switch-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
}

.toggle-switch-label {
    font-size: 0.9rem;
    color: $silver-grey;
    font-weight: 500;
}

.toggle-switch-options {
    display: flex;
    gap: 0.75rem;
    width: 100%;
}

.toggle-option {
    flex: 1;
    padding: 0.5rem 1rem;
    background: rgba($bone-grey, 0.1);
    border: 1px solid $bone-grey;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
        background: rgba($bone-grey, 0.15);
        border-color: $mist-grey;
    }

    &.active {
        background: linear-gradient(
            135deg,
            rgba($shadow-purple, 0.3) 0%,
            rgba($deep-purple, 0.5) 100%
        );
        border-color: $mist-grey;
    }

    &:disabled {
        cursor: not-allowed;
        opacity: 0.5;
    }
}

.option-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.25rem;
}

.option-label {
    font-size: 0.95rem;
    font-weight: 500;
    color: $pearl-grey;
}

.option-info {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    font-size: 1.25rem;
    color: $silver-grey;
    cursor: help;
    opacity: 0.8;
    transition: opacity 0.2s ease;

    &:hover {
        opacity: 1;
    }
}

.option-description {
    font-size: 0.75rem;
    color: $silver-grey;
    opacity: 0.7;
}
</style>
