<template>
    <div
        ref="root"
        class="engine-log"
    >
        <template
            v-for="item in items"
            :key="item.key"
        >
            <EngineLogLine
                v-if="item.entry"
                :entry="item.entry"
                :showTime="showTime"
            />
            <LogLine
                v-else-if="item.logEntry"
                :logEntry="item.logEntry"
                :index="item.index"
                :showTime="showTime"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
/**
 * The log of a game with the rules engine : the engine's lines ( see log.ts ), the chat's among
 * them in their order.
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { EngineLogEntry } from '@/client/engine/log.ts'
import { LogEntry } from '@/shared/types/history.ts'
import { useEngineStore } from '@/client/store/engine.ts'
import EngineLogLine from '@/client/ui/ingame/rightColumn/EngineLogLine.vue'
import LogLine from '@/client/ui/ingame/rightColumn/LogLine.vue'

const { logEntries, showTime } = defineProps<{ logEntries: LogEntry[]; showTime: boolean }>()

const engine = useEngineStore()
const root = ref<HTMLDivElement>()

type Item = { key: string; entry?: EngineLogEntry; logEntry?: LogEntry; index: number }

const items = computed<Item[]>(() => {
    const items: Item[] = []
    let chat = 0
    const chatUntil = (time: Date | null) => {
        while (chat < logEntries.length && (!time || logEntries[chat].timestamp <= time)) {
            items.push({ key: `chat-${chat}`, logEntry: logEntries[chat], index: chat })
            chat++
        }
    }
    for (const entry of engine.log) {
        chatUntil(entry.time)
        items.push({ key: `engine-${entry.id}`, entry, index: -1 })
    }
    chatUntil(null)
    return items
})

// A line added or grown, folded ones included : the log follows it, unless the user scrolled up
watch(
    () => engine.logVersion,
    () => {
        const container = root.value?.parentElement
        if (!container) {
            return
        }
        const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80
        if (atBottom) {
            nextTick(() => {
                container.scrollTop = container.scrollHeight
            })
        }
    },
)
</script>
