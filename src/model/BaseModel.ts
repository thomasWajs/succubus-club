export type ObjectId = number

export class BaseModel {
    constructor(public oid: ObjectId) {}

    get secureName() {
        return ''
    }
}
