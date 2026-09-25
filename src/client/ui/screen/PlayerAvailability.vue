<template>
    <TopBar />

    <div class="availability-container main-content">
        <div class="availability-content">
            <div class="availability-header">
                <div class="availability-header-left">
                    <button
                        class="back-link"
                        @click="goBack"
                    >
                        {{ backLabel }}
                    </button>
                    <h2 class="screen-title">Player Availability</h2>
                </div>

                <span class="active-language">{{ languageLabel }} : {{ activeLanguageName }}</span>

                <!-- Language selection, sharing the lobby chat preference -->
                <div class="language-tabs">
                    <button
                        v-for="language in CHAT_LANGUAGES"
                        :key="language.code"
                        class="language-tab"
                        :class="{
                            'language-tab-active': languagePreference.language === language.code,
                        }"
                        :title="language.fullName"
                        @click="languagePreference.setLanguage(language.code)"
                    >
                        {{ language.shortName }}
                    </button>
                </div>
            </div>

            <p class="timezone-caption">
                Times are shown in your timezone : <strong>{{ timezone }}</strong>
            </p>

            <!-- The current player's own slots : add / edit / remove. -->
            <div class="my-availability">
                <div class="my-availability-header">
                    <button
                        class="collapse-toggle"
                        :aria-expanded="myAvailabilityOpen"
                        @click="myAvailabilityOpen = !myAvailabilityOpen"
                    >
                        <span class="collapse-caret">{{ myAvailabilityOpen ? '▾' : '▸' }}</span>
                        <h3 class="section-title">My availability</h3>
                    </button>
                    <button
                        v-if="myAvailabilityOpen"
                        class="add-slot-btn"
                        @click="openAdd"
                    >
                        + Add a slot
                    </button>
                </div>

                <template v-if="myAvailabilityOpen">
                    <div
                        v-if="mySlots.length === 0"
                        class="no-slots-message"
                    >
                        You haven't set any availability yet.
                    </div>

                    <div
                        v-else
                        class="my-slot-list"
                    >
                        <div
                            v-for="slot in mySlots"
                            :key="slot.id"
                            class="my-slot-item"
                        >
                            <span class="my-slot-label">{{
                                formatSlotLabel(slot, languagePreference.language)
                            }}</span>
                            <span class="my-slot-categories">
                                <span
                                    v-for="label in categoryLabels(slot.category)"
                                    :key="label"
                                    class="teal-badge"
                                >
                                    {{ label }}
                                </span>
                            </span>
                            <div class="my-slot-actions">
                                <button
                                    class="slot-share-btn"
                                    @click="openShare(slot)"
                                >
                                    Share
                                </button>
                                <button
                                    class="slot-edit-btn"
                                    @click="openEdit(slot)"
                                >
                                    Edit
                                </button>
                                <button
                                    class="slot-delete-btn"
                                    @click="onDeleteSlot(slot)"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </template>
            </div>

            <!-- Week navigation + category filter -->
            <div class="calendar-controls">
                <div class="week-nav">
                    <button
                        class="nav-btn"
                        @click="weekOffset--"
                    >
                        ‹ Prev
                    </button>
                    <span class="week-range">{{ weekRangeLabel }}</span>
                    <button
                        class="nav-btn"
                        @click="weekOffset++"
                    >
                        Next ›
                    </button>
                    <button
                        v-if="weekOffset !== 0"
                        class="nav-btn today-btn"
                        @click="weekOffset = 0"
                    >
                        This week
                    </button>
                </div>

                <div class="category-filter">
                    <button
                        v-for="option in filterOptions"
                        :key="option.value"
                        class="filter-btn"
                        :class="{ 'filter-btn-active': filter === option.value }"
                        @click="filter = option.value"
                    >
                        {{ option.label }}
                    </button>
                </div>
            </div>

            <!-- Heatmap : 7 local-day columns, one row per hour. Cells shade by how many
            players are free ; click a populated cell for its roster. -->
            <div class="week-calendar">
                <div class="calendar-corner" />
                <div
                    v-for="(date, day) in columnDates"
                    :key="day"
                    class="calendar-day-header"
                    :class="{ 'today-column': isToday(date) }"
                >
                    {{ formatColumnDate(date) }}
                </div>

                <template
                    v-for="hour in HOURS"
                    :key="hour"
                >
                    <div class="calendar-hour-label">{{ formatHour(hour) }}</div>
                    <div
                        v-for="day in dayIndices"
                        :key="`${day}-${hour}`"
                        class="calendar-cell"
                        :class="[
                            heatClass(grid[day][hour].count),
                            {
                                'cell-mine': grid[day][hour].mine,
                                'cell-selected': isSelected(day, hour),
                            },
                        ]"
                        :title="cellTooltip(grid[day][hour])"
                        @click="onCellClick(day, hour)"
                    >
                        <span
                            v-if="grid[day][hour].count > 0"
                            class="cell-count"
                        >
                            {{ grid[day][hour].count }}
                        </span>
                    </div>
                </template>
            </div>
        </div>

        <!-- Detail of the selected cell : who is available, and their type. -->
        <dialog
            ref="detailDialog"
            class="detail-dialog"
            @cancel.prevent="closeDetail"
            @click="onDetailDialogClick"
        >
            <div
                v-if="selectedCellDetail"
                class="detail-dialog-content"
            >
                <div class="cell-detail-header">
                    <h3 class="section-title">{{ selectedCellDetail.title }}</h3>
                    <button
                        class="detail-close-btn"
                        @click="closeDetail"
                    >
                        ×
                    </button>
                </div>
                <span class="active-language">{{ languageLabel }} : {{ activeLanguageName }}</span>
                <div class="cell-detail-roster">
                    <div
                        v-for="entry in selectedCellDetail.roster"
                        :key="entry.uid"
                        class="roster-entry"
                    >
                        <span class="roster-name">{{ entry.name }}</span>
                        <span class="roster-categories">
                            <span
                                v-for="label in categoryLabels(entry.category)"
                                :key="label"
                                class="teal-badge"
                            >
                                {{ label }}
                            </span>
                        </span>
                    </div>
                </div>
                <div class="detail-actions">
                    <button
                        class="im-in-btn"
                        :disabled="selectedCellDetail.mine"
                        :title="selectedCellDetail.mine ? 'You are already listed here' : ''"
                        @click="onCountMeIn"
                    >
                        {{ selectedCellDetail.mine ? "You're Already In" : 'Count Me In !' }}
                    </button>
                </div>
            </div>
        </dialog>

        <!-- Add / edit slot, floated over the calendar. -->
        <dialog
            ref="formDialog"
            class="slot-form-dialog"
            @cancel.prevent="closeForm"
            @click="onDialogClick"
        >
            <div class="slot-dialog-content">
                <div class="cell-detail-header">
                    <h3 class="section-title">
                        {{ editingExisting ? 'Edit availability' : 'Add availability' }}
                    </h3>
                    <button
                        class="detail-close-btn"
                        @click="closeForm"
                    >
                        ×
                    </button>
                </div>
                <AvailabilitySlotForm
                    v-if="formOpen"
                    :initial-slot="editingSlot"
                    :language-name="activeLanguageName"
                    @save="onSaveSlot"
                    @cancel="closeForm"
                />
            </div>
        </dialog>

        <!-- Share a slot : self-contained link + WhatsApp intent. -->
        <dialog
            ref="shareDialog"
            class="share-dialog"
            @cancel.prevent="closeShare"
            @click="onShareDialogClick"
        >
            <div class="share-dialog-content">
                <div class="cell-detail-header">
                    <h3 class="section-title">Share this slot</h3>
                    <button
                        class="detail-close-btn"
                        @click="closeShare"
                    >
                        ×
                    </button>
                </div>
                <p class="share-hint">
                    Anyone who opens this link can add themselves at this time.
                </p>
                <input
                    class="share-url-input"
                    :value="shareUrl"
                    readonly
                    @focus="selectShareUrl"
                />
                <div class="share-actions">
                    <button
                        class="share-copy-btn"
                        @click="copyShareLink"
                    >
                        {{ copied ? 'Copied !' : 'Copy link' }}
                    </button>
                    <a
                        class="share-whatsapp-btn"
                        :href="whatsappUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        WhatsApp
                    </a>
                    <button
                        class="share-discord-btn"
                        :title="'Copy the link, then paste it in Discord'"
                        @click="copyForDiscord"
                    >
                        {{ discordCopied ? 'Copied - paste in Discord !' : 'Discord' }}
                    </button>
                </div>
            </div>
        </dialog>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import TopBar from '@/client/ui/components/TopBar.vue'
import AvailabilitySlotForm from '@/client/ui/components/AvailabilitySlotForm.vue'
import { useLanguagePreferenceStore } from '@/client/store/languagePreference.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { CHAT_LANGUAGES } from '@/shared/const/languages.ts'
import {
    AvailabilitySlot,
    PlayerAvailability,
    SlotCategory,
    SlotRecurrence,
} from '@/shared/types/availability.ts'
import {
    savePlayerAvailability,
    subscribePlayerAvailability,
    warmUpAvailabilityAuth,
} from '@/client/gateway/playerAvailability.ts'
import { ensureAnonymousAuth } from '@/client/gateway/realtime.ts'
import {
    DEFAULT_SLOT_DURATION_HOURS,
    formatColumnDate,
    formatNextOccurrenceLabel,
    formatSlotLabel,
    localCellForEpoch,
    localTimezone,
    localWeekStart,
    toLocalDateIso,
    weekdayDate,
} from '@/client/gateway/availabilityTime.ts'
import { nextOccurrenceStartUtc } from '@/shared/availability/recurrence.mjs'
import { getTranslations } from '@/shared/availability/shareLabel.mjs'
import {
    buildAvailabilityGrid,
    CategoryFilter,
    GridCell,
} from '@/client/gateway/availabilityGrid.ts'
import {
    buildShareMessage,
    buildShareUrl,
    parseSharedSlot,
} from '@/client/gateway/availabilityShare.ts'
import router, { ROUTES } from '@/client/ui/router.ts'
import * as logging from '@/client/logging.ts'

const languagePreference = useLanguagePreferenceStore()
const core = useCoreStore()
const multiplayer = useMultiplayerStore()

// This screen is reachable both from inside a joined lobby and standalone ( a shared
// link ). Send the player back to the lobby when they are in one ; otherwise the lobby
// route would just bounce to the main menu, so we point there directly and label it so.
const backToLobby = computed(() => multiplayer.hasJoinedLobby)
const backLabel = computed(() => (backToLobby.value ? '‹ Back to Lobby' : '‹ Back to Menu'))

function goBack() {
    router
        .push({ name: backToLobby.value ? ROUTES.Lobby : ROUTES.MainMenu })
        .catch(logging.captureException)
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const dayIndices = Array.from({ length: 7 }, (_, day) => day)

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

const players = ref<PlayerAvailability[]>([])
const myUid = ref<string | null>(null)
const editingSlot = ref<AvailabilitySlot | null>(null)
const editingExisting = ref(false)
const formOpen = ref(false)
const formDialog = ref<HTMLDialogElement | null>(null)
const detailDialog = ref<HTMLDialogElement | null>(null)
let unsubscribe: (() => void) | null = null

// Share state.
const shareDialog = ref<HTMLDialogElement | null>(null)
const shareUrl = ref('')
const shareMessage = ref('')
const copied = ref(false)
const discordCopied = ref(false)

// A slot opened from a shared link, waiting for the availability data to load before we
// can show its roster.
const pendingShared = ref<{ day: number; hour: number; slot: AvailabilitySlot } | null>(null)

// Calendar view state.
const weekOffset = ref(0)
const filter = ref<CategoryFilter>('all')
// Whether the "My availability" panel is expanded ; collapsed leaves only its title + toggle.
const myAvailabilityOpen = ref(true)
const selectedCell = ref<{ day: number; hour: number } | null>(null)

const filterOptions: { value: CategoryFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'casual', label: 'Casual' },
    { value: 'competitive', label: 'Competitive' },
]

const activeLanguageName = computed(() => {
    const language = CHAT_LANGUAGES.find(entry => entry.code === languagePreference.language)
    return language ? language.fullName : ''
})

const languageLabel = computed(() => getTranslations(languagePreference.language).language)

// The current player's own slots, resolved from the aggregate by matching the uid.
const mySlots = computed(() => {
    const me = players.value.find(player => player.uid === myUid.value)
    return me ? me.slots : []
})

const weekStart = computed(() => localWeekStart(weekOffset.value))
const columnDates = computed(() =>
    Array.from({ length: 7 }, (_, day) => weekdayDate(weekStart.value, day)),
)
const grid = computed(() =>
    buildAvailabilityGrid(players.value, weekStart.value, filter.value, myUid.value),
)

const weekRangeLabel = computed(() => {
    const dates = columnDates.value
    return `${formatDayMonth(dates[0])} - ${formatDayMonth(dates[6])}`
})

const whatsappUrl = computed(() => `https://wa.me/?text=${encodeURIComponent(shareMessage.value)}`)

const selectedCellDetail = computed(() => {
    if (!selectedCell.value) {
        return null
    }
    const { day, hour } = selectedCell.value
    const cell = grid.value[day][hour]
    if (cell.count === 0) {
        return null
    }
    const title = `${formatColumnDate(columnDates.value[day])} - ${formatHour(hour)} - ${formatHour(
        (hour + 1) % 24,
    )}`
    return { title, roster: cell.roster, mine: cell.mine }
})

function formatHour(hour: number): string {
    return `${hour.toString().padStart(2, '0')}:00`
}

function formatDayMonth(date: Date): string {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date)
}

function isToday(date: Date): boolean {
    const now = new Date()
    return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
    )
}

function heatClass(count: number): string {
    return count <= 0 ? '' : `heat-${Math.min(count, 5)}`
}

function isSelected(day: number, hour: number): boolean {
    return selectedCell.value?.day === day && selectedCell.value?.hour === hour
}

function cellTooltip(cell: GridCell): string {
    return cell.count > 0 ? cell.roster.map(entry => entry.name).join(', ') : ''
}

// A populated cell opens its roster in a modal ; an empty cell opens the form,
// prefilled with a weekly slot at that weekday and hour.
function onCellClick(day: number, hour: number) {
    if (grid.value[day][hour].count > 0) {
        selectedCell.value = { day, hour }
        detailDialog.value?.showModal()
        return
    }
    selectedCell.value = null
    openForm(
        {
            id: crypto.randomUUID(),
            recurrence: SlotRecurrence.Weekly,
            category: SlotCategory.Both,
            timezone: localTimezone(),
            weekday: day,
            startHour: hour,
            durationHours: DEFAULT_SLOT_DURATION_HOURS,
        },
        false,
    )
}

function closeDetail() {
    detailDialog.value?.close()
    selectedCell.value = null
}

function onDetailDialogClick(event: MouseEvent) {
    if (event.target === detailDialog.value) {
        closeDetail()
    }
}

// If the selected cell empties out ( a player removed their slot while the modal was
// open ), close the now-stale detail.
watch(selectedCellDetail, detail => {
    if (!detail) {
        detailDialog.value?.close()
    }
})

// "Count Me In !" : add yourself to the shown slot with a one-time slot on that exact date,
// same start hour, two hours long. Opens the form prefilled so the player can confirm
// or tweak before saving.
function onCountMeIn() {
    if (!selectedCell.value) {
        return
    }
    const { day, hour } = selectedCell.value
    closeDetail()
    openForm(
        {
            id: crypto.randomUUID(),
            recurrence: SlotRecurrence.Once,
            category: SlotCategory.Both,
            timezone: localTimezone(),
            date: toLocalDateIso(columnDates.value[day]),
            startHour: hour,
            durationHours: DEFAULT_SLOT_DURATION_HOURS,
        },
        false,
    )
}

// One badge per category. Both expands to the two individual labels ( no "&" ).
function categoryLabels(category: SlotCategory): string[] {
    if (category === SlotCategory.Casual) {
        return ['Casual']
    }
    if (category === SlotCategory.Competitive) {
        return ['Competitive']
    }
    return ['Casual', 'Competitive']
}

function subscribeToActiveLanguage() {
    unsubscribe?.()
    players.value = []
    selectedCell.value = null
    unsubscribe = subscribePlayerAvailability(languagePreference.language, list => {
        players.value = list
        resolvePendingShared()
    })
}

// Where a shared slot's start falls in the local calendar. A recurring slot lands on its
// next occurrence's week ( the epoch stamped in the link, or recomputed if it is absent
// or has slipped into a past week ) ; a one-time slot on the week that contains its date.
function locateSharedCell(
    slot: AvailabilitySlot,
    occurrenceUtc: number | null,
): {
    weekOffset: number
    day: number
    hour: number
} {
    if (slot.recurrence === SlotRecurrence.Once) {
        const located = localCellForEpoch(nextOccurrenceStartUtc(slot, Date.now()))
        return { weekOffset: located.weekOffset, day: located.weekday, hour: located.hour }
    }
    const stamped =
        occurrenceUtc !== null ? occurrenceUtc : nextOccurrenceStartUtc(slot, Date.now())
    let located = localCellForEpoch(stamped)
    if (located.weekOffset < 0) {
        located = localCellForEpoch(nextOccurrenceStartUtc(slot, Date.now()))
    }
    return { weekOffset: located.weekOffset, day: located.weekday, hour: located.hour }
}

// Once the data is in, open the shared slot's roster so the visitor sees who else is
// there. If that slot is gone ( empty cell ), fall back to the prefilled add form.
function resolvePendingShared() {
    if (!pendingShared.value) {
        return
    }
    const { day, hour, slot } = pendingShared.value
    pendingShared.value = null
    if (grid.value[day][hour].count > 0) {
        selectedCell.value = { day, hour }
        detailDialog.value?.showModal()
    } else {
        openForm(slot, false)
    }
}

watch(() => languagePreference.language, subscribeToActiveLanguage)

// Changing the week or the filter can invalidate the current selection.
watch([weekOffset, filter], () => {
    selectedCell.value = null
})

onMounted(() => {
    // Landing from a shared link : switch to the shared language, navigate to the slot's
    // week, and queue it to open on its roster once the data loads. Strip the params so a
    // refresh doesn't reopen it.
    const shared = parseSharedSlot(new URLSearchParams(window.location.search))
    if (shared) {
        languagePreference.setLanguage(shared.languageCode)
        router.replace({ name: ROUTES.PlayerAvailability }).catch(logging.captureException)
        const located = locateSharedCell(shared.slot, shared.occurrenceUtc)
        weekOffset.value = located.weekOffset
        pendingShared.value = { day: located.day, hour: located.hour, slot: shared.slot }
    }

    warmUpAvailabilityAuth()
    ensureAnonymousAuth()
        .then(uid => {
            myUid.value = uid
        })
        .catch(logging.captureException)
    subscribeToActiveLanguage()
})

onUnmounted(() => {
    unsubscribe?.()
    unsubscribe = null
})

// Open the modal form. `existing` marks whether the slot already belongs to the player
// ( edit ) versus a fresh one ( add ), which only affects the title. `formOpen` toggles
// the form's presence so it re-reads its prefill on every open.
function openForm(slot: AvailabilitySlot | null, existing: boolean) {
    editingSlot.value = slot
    editingExisting.value = existing
    formOpen.value = true
    formDialog.value?.showModal()
}

function openAdd() {
    openForm(null, false)
}

function openEdit(slot: AvailabilitySlot) {
    openForm(slot, true)
}

function closeForm() {
    formDialog.value?.close()
    formOpen.value = false
    editingSlot.value = null
    editingExisting.value = false
}

// Close when the backdrop ( the dialog element itself, outside its content ) is clicked.
function onDialogClick(event: MouseEvent) {
    if (event.target === formDialog.value) {
        closeForm()
    }
}

// Overwrite the whole slot list ( the gateway saves the player's full document ). The
// subscription then echoes the change back into `players`, updating the display.
function persist(slots: AvailabilitySlot[]) {
    savePlayerAvailability(
        languagePreference.language,
        core.userProfile.permanentId,
        core.userProfile.playerName,
        slots,
    )
}

function onSaveSlot(slot: AvailabilitySlot) {
    const slots = mySlots.value.slice()
    const index = slots.findIndex(entry => entry.id === slot.id)
    const isNew = index < 0
    if (index >= 0) {
        slots[index] = slot
    } else {
        slots.push(slot)
    }
    persist(slots)
    closeForm()
    // A freshly added slot flows straight into sharing : close the form and open the
    // share panel so the player can invite others without an extra step.
    if (isNew) {
        openShare(slot)
    }
}

function onDeleteSlot(slot: AvailabilitySlot) {
    persist(mySlots.value.filter(entry => entry.id !== slot.id))
}

// Build a shareable link to this slot and open the share modal. The link is
// self-contained, so anyone who opens it lands on a prefilled add form.
function openShare(slot: AvailabilitySlot) {
    shareUrl.value = buildShareUrl(slot, languagePreference.language)
    shareMessage.value = buildShareMessage(
        languagePreference.language,
        formatNextOccurrenceLabel(slot),
        shareUrl.value,
    )
    copied.value = false
    discordCopied.value = false
    shareDialog.value?.showModal()
}

function closeShare() {
    shareDialog.value?.close()
}

function onShareDialogClick(event: MouseEvent) {
    if (event.target === shareDialog.value) {
        closeShare()
    }
}

function selectShareUrl(event: FocusEvent) {
    ;(event.target as HTMLInputElement).select()
}

async function copyShareLink() {
    try {
        await navigator.clipboard.writeText(shareUrl.value)
        copied.value = true
        setTimeout(() => {
            copied.value = false
        }, 2000)
    } catch (error) {
        logging.captureException(error)
    }
}

// Discord has no share-intent URL like WhatsApp's wa.me, so the shortcut copies the link :
// pasted into any Discord channel it unfurls into the rich preview served by /share.
async function copyForDiscord() {
    try {
        await navigator.clipboard.writeText(shareUrl.value)
        discordCopied.value = true
        setTimeout(() => {
            discordCopied.value = false
        }, 2000)
    } catch (error) {
        logging.captureException(error)
    }
}
</script>

<style lang="scss" scoped>
.availability-container {
    background: black;
}

.availability-content {
    @include screen-page;
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.availability-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
}

.availability-header-left {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.back-link {
    @include button-dark-grey;
    padding: 0.35rem 0.8rem;
    font-size: 0.9rem;
    white-space: nowrap;
}

.screen-title {
    @include serif-heading(1.5rem);
}

.active-language {
    @include active-language;
    font-size: 1.4em;
    vertical-align: middle;
    text-align: center;
}

.language-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
}

.language-tab {
    @include tab-button;
    font-family: serif;
    letter-spacing: 0.5px;

    &.language-tab-active {
        @include tab-button-active;
    }
}

.timezone-caption {
    margin: 0;
    color: $silver-grey;
    font-size: 0.9rem;

    strong {
        color: $pearl-grey;
    }
}

.my-availability {
    @include panel;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.my-availability-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.collapse-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
}

.collapse-caret {
    color: $silver-grey;
    font-size: 0.9rem;
    line-height: 1;
}

.section-title {
    @include serif-heading(1.15rem);
    color: $pearl-grey;
}

.add-slot-btn {
    @include button-purple;
    padding: 0.4rem 1rem;
}

.no-slots-message {
    color: $silver-grey;
    font-style: italic;
    font-size: 0.9rem;
}

.my-slot-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.my-slot-item {
    @include list-item;
    justify-content: flex-start;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
}

.my-slot-label {
    flex: 1;
    color: $pearl-grey;
    font-size: 0.9rem;
}

.my-slot-categories {
    display: flex;
    gap: 0.25rem;
}

.my-slot-actions {
    display: flex;
    gap: 0.5rem;
}

.slot-share-btn,
.slot-edit-btn {
    @include button-dark-grey;
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
}

.slot-delete-btn {
    @include button-red;
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
    border-radius: 0;
}

/**
 *  Calendar controls
 */

.calendar-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
}

.week-nav {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.nav-btn {
    @include button-dark-grey;
    padding: 0.35rem 0.8rem;
    font-size: 0.9rem;
}

.today-btn {
    @include button-grey;
    padding: 0.35rem 0.8rem;
    font-size: 0.9rem;
}

.week-range {
    min-width: 9rem;
    text-align: center;
    color: $pearl-grey;
    font-family: serif;
    font-size: 1rem;
}

.category-filter {
    display: flex;
    gap: 0.25rem;
}

.filter-btn {
    @include tab-button;

    &.filter-btn-active {
        @include tab-button-active;
    }
}

/**
 *  Heatmap grid
 */

.week-calendar {
    display: grid;
    grid-template-columns: auto repeat(7, 1fr);
    border-top: 1px solid $ash-grey;
    border-left: 1px solid $ash-grey;
}

.calendar-corner,
.calendar-day-header,
.calendar-hour-label,
.calendar-cell {
    border-right: 1px solid $ash-grey;
    border-bottom: 1px solid $ash-grey;
}

.calendar-day-header {
    padding: 0.4rem 0.5rem;
    text-align: center;
    font-family: serif;
    font-size: 0.9rem;
    color: $silver-grey;
    background: rgba(black, 0.2);

    &.today-column {
        color: $pearl-grey;
        background: rgba($light-teal, 0.15);
    }
}

.calendar-hour-label {
    padding: 0.2rem 0.6rem;
    text-align: right;
    font-size: 0.8rem;
    color: $silver-grey;
    white-space: nowrap;
    background: rgba(black, 0.2);
}

.calendar-cell {
    min-height: 1.5rem;
    position: relative;
    cursor: pointer;

    &.heat-1 {
        background: rgba($light-teal, 0.16);
    }
    &.heat-2 {
        background: rgba($light-teal, 0.32);
    }
    &.heat-3 {
        background: rgba($light-teal, 0.48);
    }
    &.heat-4 {
        background: rgba($light-teal, 0.64);
    }
    &.heat-5 {
        background: rgba($light-teal, 0.82);
    }

    // Hover highlight layered over any background, so both empty and populated cells
    // signal that they are clickable.
    &:hover::before {
        content: '';
        position: absolute;
        inset: 0;
        background: rgba(white, 0.09);
        pointer-events: none;
    }

    &.cell-selected {
        outline: 2px solid $lighter-teal;
        outline-offset: -2px;
    }

    // A small marker in cells the current player is part of.
    &.cell-mine::after {
        content: '';
        position: absolute;
        top: 2px;
        right: 2px;
        width: 6px;
        height: 6px;
        background: $lighter-teal;
    }
}

.cell-count {
    @include flex-center;
    position: absolute;
    inset: 0;
    font-size: 0.7rem;
    color: rgba(white, 0.9);
}

/**
 *  Cell detail modal
 */

.detail-dialog {
    @include modal-dialog;
}

.detail-dialog-content {
    @include modal-content($shadow-grey, 1.5rem);
    gap: 0.75rem;
    min-width: 24rem;
    max-width: 32rem;
}

.cell-detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.detail-close-btn {
    @include button-grey;
    font-size: 1.1rem;
    padding: 0.25rem 0.6rem;
}

.cell-detail-roster {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.roster-entry {
    @include list-item;
    gap: 1rem;
    padding: 0.4rem 0.6rem;
}

.roster-name {
    color: $pearl-grey;
    font-size: 0.9rem;
}

.roster-categories {
    color: $ghost-white;
    display: flex;
    gap: 0.25rem;
}

.detail-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.25rem;
}

.im-in-btn {
    @include button-purple;
    padding: 0.5rem 1.25rem;
}

/**
 *  Slot form modal
 */

.slot-form-dialog {
    @include modal-dialog;
}

.slot-dialog-content {
    @include modal-content($shadow-grey, 1.5rem);
    gap: 1rem;
    min-width: 30rem;
}

/**
 *  Share modal
 */

.share-dialog {
    @include modal-dialog;
}

.share-dialog-content {
    @include modal-content($shadow-grey, 1.5rem);
    gap: 0.75rem;
    min-width: 26rem;
    max-width: 36rem;
}

.share-hint {
    margin: 0;
    color: $silver-grey;
    font-size: 0.9rem;
}

.share-url-input {
    @include input-base;
}

.share-actions {
    display: flex;
    gap: 0.75rem;
}

.share-copy-btn {
    @include button-purple;
    padding: 0.5rem 1.25rem;
}

.share-whatsapp-btn {
    @include button-dark-grey;
    padding: 0.5rem 1.25rem;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
}

.share-discord-btn {
    @include button-dark-grey;
    padding: 0.5rem 1.25rem;
}

/**
 *  Mobile ( smartphone ) layout. This screen is the one deliberate exception to the
 *  app's desktop-only rule : shared availability links are meant to be opened on a
 *  phone, so everything below keeps the calendar and its modals usable on a small
 *  screen.
 */
@media (max-width: 640px) {
    .availability-content {
        padding: 0.75rem;
        gap: 0.85rem;
    }

    .availability-header {
        gap: 0.6rem;
    }

    // On a phone the screen is for consulting shared availability, not managing your
    // own slots, so the "My availability" panel and the roster's "Count Me In" action
    // are hidden.
    .my-availability {
        display: none;
    }

    .detail-actions {
        display: none;
    }

    .availability-header-left {
        flex-wrap: wrap;
        gap: 0.5rem;
    }

    .screen-title {
        font-size: 1.15rem;
    }

    // Each own-slot row stacks so its label and its three action buttons each get
    // the full width instead of being crushed onto one line.
    .my-slot-item {
        flex-direction: column;
        align-items: stretch;
        gap: 0.5rem;
    }

    .my-slot-actions {
        justify-content: flex-end;
    }

    // Let the week navigation and category filter wrap rather than overflow.
    .week-nav {
        flex-wrap: wrap;
        width: 100%;
    }

    .week-range {
        min-width: 0;
        flex: 1;
    }

    // Tighten the heatmap so all seven day columns stay visible without scrolling
    // sideways, while keeping the cells tall enough to tap.
    .week-calendar {
        grid-template-columns: 2.2rem repeat(7, 1fr);
    }

    .calendar-day-header {
        padding: 0.3rem 0.1rem;
        font-size: 0.6rem;
        line-height: 1.15;
    }

    .calendar-hour-label {
        padding: 0.2rem 0.15rem;
        font-size: 0.6rem;
    }

    .calendar-cell {
        min-height: 2rem;
    }

    .cell-count {
        font-size: 0.65rem;
    }

    // The three modals drop their fixed desktop min-widths and fill the viewport
    // ( minus a small gutter ) instead of overflowing off-screen.
    .detail-dialog,
    .slot-form-dialog,
    .share-dialog {
        width: calc(100vw - 1.5rem);
        max-width: calc(100vw - 1.5rem);
        margin: auto;
    }

    .detail-dialog-content,
    .slot-dialog-content,
    .share-dialog-content {
        box-sizing: border-box;
        min-width: 0;
        width: 100%;
        max-width: none;
        padding: 1rem;
    }

    .share-actions {
        flex-wrap: wrap;
    }
}
</style>
