import { useCoreStore } from '@/store/core.ts'
import { hash } from '@/gateway/serialization.ts'
import { getRtdb, rtdbRef, rtdbGet, rtdbRemove, rtdbSet } from '@/gateway/realtime.ts'
import { User } from '@/multiplayer/types.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'

const AVATARS_KEY = 'avatars'
export type AvatarId = string

function avatarRef(roomName: string) {
    return rtdbRef(getRtdb(), `${AVATARS_KEY}/${roomName}`)
}

export async function storeAvatar() {
    const profile = useCoreStore().userProfile

    if (!profile.avatar) {
        return
    }

    const avatarId = `${profile.permanentId}-${hash(profile.avatar)}`

    // No change, nothing to do
    if (profile.avatarFirebaseId == avatarId) {
        return
    }

    // Remove old avatar if there was one
    if (profile.avatarFirebaseId) {
        await rtdbRemove(avatarRef(profile.avatarFirebaseId))
    }

    await rtdbSet(avatarRef(avatarId), profile.avatar)
    profile.avatarFirebaseId = avatarId
    await profile.save()
}

export async function fetchAvatar(user: User) {
    const multiplayer = useMultiplayerStore()
    const core = useCoreStore()

    // No avatar, or avatar is already fetched, do nothing
    if (!user.avatarId || user.avatarId in multiplayer.avatars) {
        return
    }

    let avatar

    if (user.permId == multiplayer.selfUser.permId) {
        avatar = core.userProfile.avatar
    } else {
        avatar = (await rtdbGet(avatarRef(user.avatarId))).val() as string
    }

    if (user.avatarId && avatar) {
        multiplayer.avatars[user.avatarId] = avatar
    }

    // TODO? : store in local storage/indexed DB as well, to avoid fetching each time
}
