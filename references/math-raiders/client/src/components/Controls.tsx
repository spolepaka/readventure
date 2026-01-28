import type { InitStatus } from './Status'

interface ExitButtonProps {
    status: InitStatus
    isExitedStandalone: boolean
    onClick: () => void
    disabled: boolean
}

export function ExitButton({ status, isExitedStandalone, onClick, disabled }: ExitButtonProps) {
    const isButtonDisabled = status !== 'success' || isExitedStandalone || disabled

    return (
        <button onClick={onClick} disabled={isButtonDisabled}>
            Exit Game
        </button>
    )
}
