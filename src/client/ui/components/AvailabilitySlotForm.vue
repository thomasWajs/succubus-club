<template>
    <div class="slot-form">
        <div class="form-row">
            <span class="form-label">When</span>
            <div class="segment">
                <button
                    class="segment-btn"
                    :class="{ 'segment-btn-active': recurrence === SlotRecurrence.Weekly }"
                    @click="recurrence = SlotRecurrence.Weekly"
                >
                    Every week
                </button>
                <button
                    class="segment-btn"
                    :class="{ 'segment-btn-active': recurrence === SlotRecurrence.Once }"
                    @click="recurrence = SlotRecurrence.Once"
                >
                    Once
                </button>
            </div>
        </div>

        <div class="form-row">
            <span class="form-label">Day</span>
            <select
                v-if="recurrence === SlotRecurrence.Weekly"
                v-model.number="weekday"
                class="form-select"
            >
                <option
                    v-for="(name, index) in WEEKDAY_NAMES"
                    :key="index"
                    :value="index"
                >
                    {{ name }}
                </option>
            </select>
            <input
                v-else
                v-model="dateIso"
                type="date"
                class="form-input"
                :min="todayLocalDateIso()"
            />
        </div>

        <div class="form-row">
            <span class="form-label">Start</span>
            <input
                v-model="startTime"
                type="time"
                step="3600"
                class="form-time"
                @change="onStartChange"
            />
        </div>

        <div class="form-row">
            <span class="form-label">End</span>
            <input
                v-model="endTime"
                type="time"
                step="3600"
                class="form-time"
            />
            <span
                v-if="endNextDay"
                class="next-day-hint"
                >next day</span
            >
        </div>

        <div class="form-row">
            <span class="form-label">Type</span>
            <div class="segment">
                <button
                    v-for="option in categoryOptions"
                    :key="option.value"
                    class="segment-btn"
                    :class="{ 'segment-btn-active': category === option.value }"
                    @click="category = option.value"
                >
                    {{ option.label }}
                </button>
            </div>
        </div>

        <div class="form-actions">
            <button
                class="cancel-btn"
                @click="emit('cancel')"
            >
                Cancel
            </button>
            <button
                class="save-btn"
                @click="onSave"
            >
                Save
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { AvailabilitySlot, SlotCategory, SlotRecurrence } from '@/shared/types/availability.ts'
import {
    addHoursToMinuteOfWeek,
    DEFAULT_SLOT_DURATION_HOURS,
    localDateHourToUtc,
    localWeekdayHourToMinuteOfWeekUtc,
    minuteOfWeekUtcToLocal,
    onceDurationHours,
    todayLocalDateIso,
    utcToLocalDateHour,
    WEEKDAY_NAMES,
    weeklyDurationHours,
} from '@/client/gateway/availabilityTime.ts'

const props = defineProps<{
    // Prefill values for the form. May be an existing slot ( edit ), a provisional slot
    // built from a clicked cell, or a shared slot ; whether it becomes a new slot or an
    // update is decided by the caller from its id. Absent means a blank new slot.
    initialSlot?: AvailabilitySlot | null
}>()

const emit = defineEmits<{
    save: [slot: AvailabilitySlot]
    cancel: []
}>()

const categoryOptions = [
    { value: SlotCategory.Casual, label: 'Casual' },
    { value: SlotCategory.Competitive, label: 'Competitive' },
    { value: SlotCategory.Both, label: 'Both' },
]

// Local weekday of today, so a fresh weekly slot defaults to a sensible day.
function todayWeekday(): number {
    return (new Date().getDay() + 6) % 7
}

const recurrence = ref<SlotRecurrence>(SlotRecurrence.Weekly)
const weekday = ref(todayWeekday())
const dateIso = ref(todayLocalDateIso())
const startHour = ref(21)
const endHour = ref((21 + DEFAULT_SLOT_DURATION_HOURS) % 24)
const category = ref<SlotCategory>(SlotCategory.Both)

// Prefill from the provided slot, converting its stored UTC form back to local values.
if (props.initialSlot) {
    const existing = props.initialSlot
    category.value = existing.category
    recurrence.value = existing.recurrence
    if (existing.recurrence === SlotRecurrence.Weekly) {
        const local = minuteOfWeekUtcToLocal(existing.startMinuteOfWeekUtc)
        weekday.value = local.weekday
        startHour.value = local.hour
        const duration = weeklyDurationHours(
            existing.startMinuteOfWeekUtc,
            existing.endMinuteOfWeekUtc,
        )
        endHour.value = (local.hour + duration) % 24
    } else {
        const local = utcToLocalDateHour(existing.startUtc)
        dateIso.value = local.dateIso
        startHour.value = local.hour
        const duration = onceDurationHours(existing.startUtc, existing.endUtc)
        endHour.value = (local.hour + duration) % 24
    }
}

// Bind the native time inputs ( which speak "HH:MM" strings ) to the hour numbers.
function hourToTime(hour: number): string {
    return `${hour.toString().padStart(2, '0')}:00`
}

function timeToHour(value: string): number {
    const hour = Number.parseInt(value.slice(0, 2), 10)
    return Number.isFinite(hour) ? hour : 0
}

const startTime = computed({
    get: () => hourToTime(startHour.value),
    set: value => {
        startHour.value = timeToHour(value)
    },
})

const endTime = computed({
    get: () => hourToTime(endHour.value),
    set: value => {
        endHour.value = timeToHour(value)
    },
})

// When the start moves, snap the end to the default two-hour duration. Only fires on
// user interaction, so it never overrides the prefilled end of an edited slot.
function onStartChange() {
    endHour.value = (startHour.value + DEFAULT_SLOT_DURATION_HOURS) % 24
}

// The slot spills into the next day when the end hour is at or before the start.
const endNextDay = computed(() => endHour.value <= startHour.value)

function durationHours(): number {
    return (endHour.value - startHour.value + 24) % 24 || 24
}

function onSave() {
    const id = props.initialSlot?.id ?? crypto.randomUUID()
    const duration = durationHours()

    if (recurrence.value === SlotRecurrence.Weekly) {
        const startMinute = localWeekdayHourToMinuteOfWeekUtc(weekday.value, startHour.value)
        emit('save', {
            id,
            recurrence: SlotRecurrence.Weekly,
            category: category.value,
            startMinuteOfWeekUtc: startMinute,
            endMinuteOfWeekUtc: addHoursToMinuteOfWeek(startMinute, duration),
        })
        return
    }

    const startUtc = localDateHourToUtc(dateIso.value, startHour.value)
    emit('save', {
        id,
        recurrence: SlotRecurrence.Once,
        category: category.value,
        startUtc,
        endUtc: startUtc + duration * 3600000,
    })
}
</script>

<style lang="scss" scoped>
@use '../../styles/base' as *;

.slot-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(black, 0.2);
    border: 1px solid $ash-grey;
}

.form-row {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.form-label {
    width: 5rem;
    flex-shrink: 0;
    color: $silver-grey;
    font-size: 0.9rem;
}

.form-select,
.form-input {
    @include input-base;
    width: auto;
    min-width: 12rem;
}

.form-time {
    @include input-base;
    width: auto;
}

.next-day-hint {
    color: $silver-grey;
    font-size: 0.8rem;
    font-style: italic;
}

.segment {
    display: flex;
    gap: 0.25rem;
}

.segment-btn {
    padding: 0.4rem 0.9rem;
    background: $shadow-grey;
    border: 1px solid $bone-grey;
    color: $pearl-grey;
    cursor: pointer;
    font-size: 0.9rem;

    &:hover {
        background: rgba($bone-grey, 0.65);
        border-color: $mist-grey;
    }

    &.segment-btn-active {
        background: rgba($shadow-purple, 0.5);
        border-color: $mist-grey;
    }
}

.form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.25rem;
}

.cancel-btn {
    @include button-dark-grey;
    padding: 0.5rem 1rem;
}

.save-btn {
    @include button-purple;
    padding: 0.5rem 1.25rem;
}
</style>
