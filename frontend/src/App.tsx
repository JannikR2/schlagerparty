import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)
  const [backendStatus, setBackendStatus] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)

  const callBackend = async () => {
    setLoading(true)
    try {
      const response = await fetch('http://localhost:3001/api/health')
      const data = await response.json()
      setBackendStatus(`Backend Status: ${data.status}`)
    } catch (error) {
      setBackendStatus('Error: Failed to connect to backend')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <br />
        <button onClick={callBackend} disabled={loading}>
          {loading ? 'Calling Backend...' : 'Call Backend'}
        </button>
        {backendStatus && <p>{backendStatus}</p>}
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
