import { useCoreStore } from '@/store/core.ts'
import { hash } from '@/gateway/serialization.ts'
import {
    getFirestore,
    fsCollection,
    fsSetDoc,
    fsDoc,
    fsGetDoc,
    fsDeleteDoc,
} from '@/gateway/realtime.ts'
import { User } from '@/multiplayer/types.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { DbUserProfile } from '@/gateway/db.ts'

export type AvatarId = string
type AvatarDoc = {
    imageData: string
}
const avatarCollection = fsCollection(getFirestore(), 'avatars')

export async function storeAvatar(profile: DbUserProfile) {
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
        await fsDeleteDoc(fsDoc(avatarCollection, profile.avatarFirebaseId))
    }

    const avatarDoc: AvatarDoc = {
        imageData: profile.avatar,
    }
    await fsSetDoc(fsDoc(avatarCollection, avatarId), avatarDoc)
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
        const avatarDoc = await fsGetDoc(fsDoc(avatarCollection, user.avatarId))
        if (avatarDoc.exists()) {
            avatar = (avatarDoc.data() as AvatarDoc).imageData
        }
    }

    if (user.avatarId && avatar) {
        multiplayer.avatars[user.avatarId] = avatar
    }

    // TODO? : store in local storage/indexed DB as well, to avoid fetching each time ?
}
