const isProd = import.meta.env.PROD

type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug'

export function captureException(exception: unknown) {
    if (isProd) {
        // eslint-disable-next-line no-console
        console.error(exception)
    } else {
        throw exception
    }
}

export function captureMessage(message: string, captureContext?: SeverityLevel) {
    /* eslint-disable no-console */
    if (captureContext == 'fatal' || captureContext == 'error') {
        console.error(message)
    } else if (captureContext == 'warning') {
        console.warn(message)
    } else {
        console.log(message)
    }
    /* eslint-enable no-console */
}
