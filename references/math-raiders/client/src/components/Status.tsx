export type InitStatus = 'idle' | 'loading' | 'success' | 'error'

export interface StatusDisplayProps {
    status: InitStatus
    error: string | null
    isExitedStandalone: boolean
    isStandalone: boolean
}

export function StatusDisplay({
    status,
    error,
    isExitedStandalone,
    isStandalone,
}: StatusDisplayProps) {
    const getStatusText = () => {
        if (status === 'loading') {
            return 'Initializing Playcademy SDK...'
        }
        if (status === 'error') {
            return `Error initializing Cademy: ${error}`
        }
        if (status === 'success') {
            if (isExitedStandalone) {
                return 'Exited [Standalone Mode]'
            }
            return `Playcademy SDK Initialized!${isStandalone ? ' [Standalone Mode]' : ''}`
        }
        return 'Idle' // Should not happen
    }

    const statusClassName =
        `status-text ${status === 'error' ? 'error' : ''} ${isExitedStandalone ? 'exited' : ''}`.trim()

    return (
        <div className="status-container">
            <p className={statusClassName}>{getStatusText()}</p>
        </div>
    )
}
