import reactLogo from '../assets/react.svg'
import viteLogo from '/vite.svg'

export function Header() {
    return (
        <>
            <div>
                <a href="https://vitejs.dev" target="_blank">
                    <img src={viteLogo} className="logo" alt="Vite logo" />
                </a>
                <a href="https://react.dev" target="_blank">
                    <img src={reactLogo} className="logo vanilla" alt="React logo" />
                </a>
            </div>
            <h1>Vite + React + Playcademy</h1>
        </>
    )
}
