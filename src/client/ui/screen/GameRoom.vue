<template>
    <TopBar />

    <div class="game-room-container main-content">
        <div class="game-room-content">
            <CurrentRoom />

            <LobbyChat
                class="room-chat"
                title="Room Chat"
                :messages="history.logEntries"
                :disabled="isStarted"
                disabledMessage="The game has started, room chat is not available. Players and judges can still chat in-game."
                @send="onSendChat"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import TopBar from '@/client/ui/components/TopBar.vue'
import CurrentRoom from '@/client/ui/components/CurrentRoom.vue'
import LobbyChat from '@/client/ui/components/LobbyChat.vue'
import { useHistoryStore } from '@/client/store/history.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { sendChat } from '@/client/multiplayer/room.ts'

const history = useHistoryStore()
const multiplayer = useMultiplayerStore()

// The room chat is only for the pre-game lobby : once the game has started we no
// longer show the game or keep the room history here, so nobody chats from this
// screen. Players and judges chat again from inside the game once they join it.
const isStarted = computed(() => !!multiplayer.currentGameRoom?.isStarted)

// The transport handles echo and delivery ( and, in SCS, the server sets the author ).
function onSendChat(text: string) {
    sendChat({
        text,
        timestamp: new Date(),
        authorName: multiplayer.selfUser.name,
    })
}
</script>

<style lang="scss" scoped>
@use '../../styles/base' as *;

.game-room-container {
    background: black;
}

.game-room-content {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: minmax(380px, auto) minmax(280px, 1fr);
    grid-template-areas:
        'current-room'
        'room-chat';
    max-width: 1400px;
    margin: 0 auto;
    padding: 1.5rem;
    gap: 1.5rem;
    min-height: calc(100vh - $topbar-height - 4rem);
}

.room-chat {
    grid-area: room-chat;
}
</style>
